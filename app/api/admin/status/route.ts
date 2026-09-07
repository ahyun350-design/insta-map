import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { reclaimStaleExtractJobs } from "@/app/api/extract/_reclaim";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_USER_ID = "63772749-e01b-4396-a41c-c17a4d3acfe6";

function kstTodayStartIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${parts}T00:00:00+09:00`).toISOString();
}

function daysAgoIso(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

const PAGE_SIZE = 1000;

/** PostgREST 기본 1000행 상한을 넘어 컬럼 값을 모두 읽어 Set에 합친다. */
async function collectColumnIdsPaged(
  admin: ReturnType<typeof getSupabaseAdmin>,
  table: "places" | "courses" | "messages" | "likes",
  column: "user_id" | "sender_id",
  sinceIso: string,
  into: Set<string>,
): Promise<void> {
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(column)
      .gte("created_at", sinceIso)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`[admin/status] ${table} active page`, error);
      return;
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const v = row[column];
      if (typeof v === "string" && v) into.add(v);
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
}

async function collectDistinctUserIds(
  admin: ReturnType<typeof getSupabaseAdmin>,
  sinceIso: string,
): Promise<number> {
  const ids = new Set<string>();
  await Promise.all([
    collectColumnIdsPaged(admin, "places", "user_id", sinceIso, ids),
    collectColumnIdsPaged(admin, "courses", "user_id", sinceIso, ids),
    collectColumnIdsPaged(admin, "messages", "sender_id", sinceIso, ids),
    collectColumnIdsPaged(admin, "likes", "user_id", sinceIso, ids),
  ]);
  return ids.size;
}

export async function GET(req: Request) {
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
      console.error("[admin/status] admin client", e);
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    // Reclaim all users' stuck jobs before status counts (cron substitute)
    try {
      await reclaimStaleExtractJobs(admin);
    } catch (e) {
      console.error("[admin/status] reclaim", e);
    }

    const now = new Date();
    const todayStart = kstTodayStartIso(now);
    const weekAgo = daysAgoIso(7, now);
    const stuckBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    // NOTE: select().gte()로 행을 받아 JS에서 count하면 PostgREST 기본 max(1000)에
    // 잘려 7일 성공률이 왜곡됨. 반드시 count:exact + head로 집계할 것.
    const [
      todaySuccessRes,
      todayFailedRes,
      weekSuccessRes,
      weekFailedRes,
      lastSuccessRes,
      stuckRes,
      recentFailRes,
      todayUsersRes,
      totalUsersRes,
      activeUsers7d,
      userEventsCountRes,
      todayPlacesPoiRes,
      todayPlacesTotalRes,
    ] = await Promise.all([
      admin
        .from("extract_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("created_at", todayStart),
      admin
        .from("extract_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("created_at", todayStart),
      admin
        .from("extract_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("created_at", weekAgo),
      admin
        .from("extract_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("created_at", weekAgo),
      admin
        .from("extract_jobs")
        .select("completed_at, updated_at")
        .eq("status", "completed")
        .order("completed_at", { ascending: false, nullsFirst: false })
        .limit(1),
      admin
        .from("extract_jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "processing"])
        .lt("updated_at", stuckBefore),
      admin
        .from("extract_jobs")
        .select("error_message, updated_at, created_at")
        .eq("status", "failed")
        .order("updated_at", { ascending: false })
        .limit(3),
      admin.from("users").select("id", { count: "exact", head: true }).gte("created_at", todayStart),
      admin.from("users").select("id", { count: "exact", head: true }),
      collectDistinctUserIds(admin, weekAgo),
      admin.from("user_events").select("id", { count: "exact", head: true }),
      admin
        .from("places")
        .select("id", { count: "exact", head: true })
        .eq("source", "poi")
        .gte("created_at", todayStart),
      admin
        .from("places")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayStart),
    ]);

    if (todaySuccessRes.error) throw todaySuccessRes.error;
    if (todayFailedRes.error) throw todayFailedRes.error;
    if (weekSuccessRes.error) throw weekSuccessRes.error;
    if (weekFailedRes.error) throw weekFailedRes.error;
    if (lastSuccessRes.error) throw lastSuccessRes.error;
    if (stuckRes.error) throw stuckRes.error;
    if (recentFailRes.error) throw recentFailRes.error;
    if (todayUsersRes.error) throw todayUsersRes.error;
    if (totalUsersRes.error) throw totalUsersRes.error;
    if (userEventsCountRes.error) throw userEventsCountRes.error;
    if (todayPlacesPoiRes.error) throw todayPlacesPoiRes.error;
    if (todayPlacesTotalRes.error) throw todayPlacesTotalRes.error;

    const todaySuccess = todaySuccessRes.count ?? 0;
    const todayFailed = todayFailedRes.count ?? 0;
    const todayAttempts = todaySuccess + todayFailed;

    const weekSuccess = weekSuccessRes.count ?? 0;
    const weekFailed = weekFailedRes.count ?? 0;
    // 성공률 = completed / (completed + failed). 오늘 추출과 동일 정의.
    const weekDecided = weekSuccess + weekFailed;
    const successRate =
      weekDecided === 0 ? 0 : Math.round((weekSuccess / weekDecided) * 1000) / 10;
    const weekAttempts = weekDecided;

    const lastRow = lastSuccessRes.data?.[0] as
      | { completed_at?: string | null; updated_at?: string | null }
      | undefined;
    const lastSuccessAt = lastRow?.completed_at || lastRow?.updated_at || null;

    const recentFailures = (recentFailRes.data ?? []).map((row) => ({
      error_message: (row as { error_message?: string | null }).error_message ?? null,
      at:
        (row as { updated_at?: string | null }).updated_at ??
        (row as { created_at?: string | null }).created_at ??
        null,
    }));

    const todayPlacesPoi = todayPlacesPoiRes.count ?? 0;
    const todayPlacesTotal = todayPlacesTotalRes.count ?? 0;
    const todayPlacesPoiRate =
      todayPlacesTotal === 0
        ? null
        : Math.round((todayPlacesPoi / todayPlacesTotal) * 1000) / 10;

    return NextResponse.json(
      {
        today: {
          attempts: todayAttempts,
          success: todaySuccess,
          failed: todayFailed,
        },
        last7Days: {
          attempts: weekAttempts,
          success: weekSuccess,
          failed: weekFailed,
          successRate,
        },
        lastSuccessAt,
        stuckJobs: stuckRes.count ?? 0,
        recentFailures,
        signups: {
          today: todayUsersRes.count ?? 0,
          total: totalUsersRes.count ?? 0,
        },
        activeUsers7d,
        userEventsTotal: userEventsCountRes.count ?? 0,
        todayPlaces: {
          total: todayPlacesTotal,
          poi: todayPlacesPoi,
          poiRate: todayPlacesPoiRate,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      },
    );
  } catch (error) {
    console.error("[admin/status]", error);
    return NextResponse.json({ error: "status_failed" }, { status: 500 });
  }
}
