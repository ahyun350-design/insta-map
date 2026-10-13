/**
 * 관리자 서비스 상태 카드.
 * 집계는 public.admin_status() 단일 RPC. 45초 인메모리 캐시.
 * Claude 장애 경고는 RPC 외 extract_jobs / user_events로 보강.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { classifyClaudeFailCode } from "@/app/api/extract/_claudeFailCode";
import { extractFailCode } from "@/app/api/extract/_timing";
import { reclaimStaleExtractJobs } from "@/app/api/extract/_reclaim";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  computePipelineWarn,
  type PipelineWarn,
} from "./_pipelineWarn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_USER_ID = "63772749-e01b-4396-a41c-c17a4d3acfe6";
const CACHE_TTL_MS = 45_000;

export type { PipelineWarn };
export { computePipelineWarn };

type AdminStatusBody = {
  today: { attempts: number; success: number; failed: number };
  last7Days: {
    attempts: number;
    success: number;
    failed: number;
    successRate: number;
  };
  lastSuccessAt: string | null;
  stuckJobs: number;
  recentFailures: Array<{ error_message: string | null; at: string | null }>;
  signups: { today: number; total: number };
  activeUsers7d: number;
  userEventsTotal: number;
  userEventsEstimated?: boolean;
  todayPlaces: {
    total: number;
    poi: number;
    poiRate: number | null;
  };
  /** Claude credit/auth in 30m, or ≥7/10 same fail_code */
  pipelineWarn?: PipelineWarn;
  timings?: Record<string, number>;
  cached?: boolean;
};

let cache: { at: number; body: AdminStatusBody } | null = null;

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return fallback;
}

function codeFromFailureMessage(msg: string | null | undefined): string {
  const claude = classifyClaudeFailCode(msg);
  if (claude) return claude;
  return extractFailCode(msg ?? "unknown");
}

async function loadPipelineWarn(
  admin: ReturnType<typeof getSupabaseAdmin>,
): Promise<PipelineWarn> {
  const since30 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const failCodesLast30m: string[] = [];
  const failCodesLast10: string[] = [];

  try {
    const { data: recent30 } = await admin
      .from("extract_jobs")
      .select("error_message,updated_at")
      .eq("status", "failed")
      .gte("updated_at", since30)
      .order("updated_at", { ascending: false })
      .limit(50);
    for (const row of recent30 ?? []) {
      failCodesLast30m.push(codeFromFailureMessage(row.error_message as string | null));
    }
  } catch {
    /* ignore */
  }

  // Prefer normalized fail_code from extract_timing when present
  try {
    const { data: timingRows } = await admin
      .from("user_events")
      .select("meta,created_at")
      .eq("event", "extract_timing")
      .gte("created_at", since30)
      .order("created_at", { ascending: false })
      .limit(80);
    for (const row of timingRows ?? []) {
      const meta = (row.meta && typeof row.meta === "object" ? row.meta : {}) as {
        ok?: boolean;
        fail_code?: string | null;
      };
      if (meta.ok === false && typeof meta.fail_code === "string" && meta.fail_code) {
        failCodesLast30m.push(extractFailCode(meta.fail_code));
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const { data: last10 } = await admin
      .from("extract_jobs")
      .select("error_message")
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(10);
    for (const row of last10 ?? []) {
      failCodesLast10.push(codeFromFailureMessage(row.error_message as string | null));
    }
  } catch {
    /* ignore */
  }

  return computePipelineWarn({ failCodesLast30m, failCodesLast10 });
}

function normalizeRpcPayload(raw: unknown): AdminStatusBody {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const today = (o.today && typeof o.today === "object" ? o.today : {}) as Record<
    string,
    unknown
  >;
  const last7 = (
    o.last7Days && typeof o.last7Days === "object" ? o.last7Days : {}
  ) as Record<string, unknown>;
  const signups = (
    o.signups && typeof o.signups === "object" ? o.signups : {}
  ) as Record<string, unknown>;
  const todayPlaces = (
    o.todayPlaces && typeof o.todayPlaces === "object" ? o.todayPlaces : {}
  ) as Record<string, unknown>;

  const recentRaw = Array.isArray(o.recentFailures) ? o.recentFailures : [];
  const recentFailures = recentRaw.map((row) => {
    const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    return {
      error_message:
        typeof r.error_message === "string" || r.error_message === null
          ? (r.error_message as string | null)
          : null,
      at:
        typeof r.at === "string" || r.at === null ? (r.at as string | null) : null,
    };
  });

  const poiRateRaw = todayPlaces.poiRate;
  const poiRate =
    poiRateRaw === null || poiRateRaw === undefined
      ? null
      : asNumber(poiRateRaw, 0);

  return {
    today: {
      attempts: asNumber(today.attempts),
      success: asNumber(today.success),
      failed: asNumber(today.failed),
    },
    last7Days: {
      attempts: asNumber(last7.attempts),
      success: asNumber(last7.success),
      failed: asNumber(last7.failed),
      successRate: asNumber(last7.successRate),
    },
    lastSuccessAt:
      typeof o.lastSuccessAt === "string" || o.lastSuccessAt === null
        ? (o.lastSuccessAt as string | null)
        : null,
    stuckJobs: asNumber(o.stuckJobs),
    recentFailures,
    signups: {
      today: asNumber(signups.today),
      total: asNumber(signups.total),
    },
    activeUsers7d: asNumber(o.activeUsers7d),
    userEventsTotal: asNumber(o.userEventsTotal),
    userEventsEstimated: o.userEventsEstimated !== false,
    todayPlaces: {
      total: asNumber(todayPlaces.total),
      poi: asNumber(todayPlaces.poi),
      poiRate,
    },
  };
}

export async function GET(req: Request) {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const jwt = authHeader.slice(7).trim();

    const tAuth = Date.now();
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    timings.auth_ms = Date.now() - tAuth;
    const authUser = userData?.user;
    if (userErr || !authUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (authUser.id !== ADMIN_USER_ID) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const bypassCache =
      new URL(req.url).searchParams.get("nocache") === "1" ||
      new URL(req.url).searchParams.get("t") != null;

    if (!bypassCache && cache && Date.now() - cache.at < CACHE_TTL_MS) {
      timings.total_ms = Date.now() - t0;
      timings.cache_hit = 1;
      return NextResponse.json(
        { ...cache.body, timings, cached: true },
        {
          headers: {
            "Cache-Control": `private, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
          },
        },
      );
    }

    let admin: ReturnType<typeof getSupabaseAdmin>;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      console.error("[admin/status] admin client", e);
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const tReclaim = Date.now();
    try {
      await reclaimStaleExtractJobs(admin);
    } catch (e) {
      console.error("[admin/status] reclaim", e);
    }
    timings.reclaim_ms = Date.now() - tReclaim;

    const tRpc = Date.now();
    const { data, error } = await admin.rpc("admin_status");
    timings.admin_status_rpc_ms = Date.now() - tRpc;
    if (error) {
      console.error("[admin/status] rpc", error);
      throw error;
    }

    const body = normalizeRpcPayload(data);
    const tWarn = Date.now();
    const pipelineWarn = await loadPipelineWarn(admin);
    timings.pipeline_warn_ms = Date.now() - tWarn;
    const withWarn: AdminStatusBody = { ...body, pipelineWarn };
    cache = { at: Date.now(), body: withWarn };
    timings.total_ms = Date.now() - t0;

    return NextResponse.json(
      { ...withWarn, timings, cached: false },
      {
        headers: {
          "Cache-Control": `private, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
        },
      },
    );
  } catch (error) {
    console.error("[admin/status]", error);
    return NextResponse.json({ error: "status_failed" }, { status: 500 });
  }
}
