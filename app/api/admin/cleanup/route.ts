import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_USER_ID = "63772749-e01b-4396-a41c-c17a4d3acfe6";
const EVENTS_RETENTION_DAYS = 90;
const DIAGNOSTICS_RETENTION_DAYS = 30;
const REEL_CACHE_RETENTION_DAYS = 30;

function daysAgoIso(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const jwt = authHeader.slice(7).trim();

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    const authUser = userData?.user;
    if (userErr || !authUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (authUser.id !== ADMIN_USER_ID) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    let admin: ReturnType<typeof getSupabaseAdmin>;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      console.error("[admin/cleanup] admin client", e);
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const now = new Date();
    const eventsCutoff = daysAgoIso(EVENTS_RETENTION_DAYS, now);
    const diagCutoff = daysAgoIso(DIAGNOSTICS_RETENTION_DAYS, now);
    const reelCacheCutoff = daysAgoIso(REEL_CACHE_RETENTION_DAYS, now);

    const eventsDelete = await admin
      .from("user_events")
      .delete({ count: "exact" })
      .lt("created_at", eventsCutoff);

    if (eventsDelete.error) {
      console.error("[admin/cleanup] user_events delete", eventsDelete.error);
      return NextResponse.json({ error: "cleanup_failed" }, { status: 500 });
    }

    const diagClear = await admin
      .from("extract_jobs")
      .update(
        {
          caption: null,
          claude_places: null,
          kakao_misses: null,
        },
        { count: "exact" },
      )
      .lt("created_at", diagCutoff);

    if (diagClear.error) {
      console.error("[admin/cleanup] extract_jobs diagnostics", diagClear.error);
      return NextResponse.json({ error: "cleanup_failed" }, { status: 500 });
    }

    const reelCacheDelete = await admin
      .from("reel_cache")
      .delete({ count: "exact" })
      .lt("created_at", reelCacheCutoff);

    if (reelCacheDelete.error) {
      console.error("[admin/cleanup] reel_cache delete", reelCacheDelete.error);
      return NextResponse.json({ error: "cleanup_failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      deletedEvents: eventsDelete.count ?? 0,
      clearedJobDiagnostics: diagClear.count ?? 0,
      deletedReelCache: reelCacheDelete.count ?? 0,
      eventsCutoff,
      diagnosticsCutoff: diagCutoff,
      reelCacheCutoff,
    });
  } catch (error) {
    console.error("[admin/cleanup]", error);
    return NextResponse.json({ error: "cleanup_failed" }, { status: 500 });
  }
}
