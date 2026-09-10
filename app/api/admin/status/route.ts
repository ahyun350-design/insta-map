/**
 * 관리자 서비스 상태 카드.
 * 집계는 public.admin_status() 단일 RPC. 45초 인메모리 캐시.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { reclaimStaleExtractJobs } from "@/app/api/extract/_reclaim";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_USER_ID = "63772749-e01b-4396-a41c-c17a4d3acfe6";
const CACHE_TTL_MS = 45_000;

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
    cache = { at: Date.now(), body };
    timings.total_ms = Date.now() - t0;

    return NextResponse.json(
      { ...body, timings, cached: false },
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
