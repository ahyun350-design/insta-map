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

async function collectDistinctUserIds(
  admin: ReturnType<typeof getSupabaseAdmin>,
  sinceIso: string,
): Promise<number> {
  const ids = new Set<string>();

  const pushIds = (rows: Array<Record<string, unknown>> | null, key: string) => {
    for (const row of rows ?? []) {
      const v = row[key];
      if (typeof v === "string" && v) ids.add(v);
    }
  };

  const [places, courses, messages, likes] = await Promise.all([
    admin.from("places").select("user_id").gte("created_at", sinceIso),
    admin.from("courses").select("user_id").gte("created_at", sinceIso),
    admin.from("messages").select("sender_id").gte("created_at", sinceIso),
    admin.from("likes").select("user_id").gte("created_at", sinceIso),
  ]);

  if (places.error) console.error("[admin/status] places active", places.error);
  else pushIds(places.data as Array<Record<string, unknown>> | null, "user_id");

  if (courses.error) console.error("[admin/status] courses active", courses.error);
  else pushIds(courses.data as Array<Record<string, unknown>> | null, "user_id");

  if (messages.error) console.error("[admin/status] messages active", messages.error);
  else pushIds(messages.data as Array<Record<string, unknown>> | null, "sender_id");

  if (likes.error) console.error("[admin/status] likes active", likes.error);
  else pushIds(likes.data as Array<Record<string, unknown>> | null, "user_id");

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

    const [
      todayJobsRes,
      weekJobsRes,
      lastSuccessRes,
      stuckRes,
      recentFailRes,
      todayUsersRes,
      totalUsersRes,
      activeUsers7d,
      userEventsCountRes,
    ] = await Promise.all([
      admin.from("extract_jobs").select("id, status").gte("created_at", todayStart),
      admin.from("extract_jobs").select("id, status").gte("created_at", weekAgo),
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
    ]);

    if (todayJobsRes.error) throw todayJobsRes.error;
    if (weekJobsRes.error) throw weekJobsRes.error;
    if (lastSuccessRes.error) throw lastSuccessRes.error;
    if (stuckRes.error) throw stuckRes.error;
    if (recentFailRes.error) throw recentFailRes.error;
    if (todayUsersRes.error) throw todayUsersRes.error;
    if (totalUsersRes.error) throw totalUsersRes.error;
    if (userEventsCountRes.error) throw userEventsCountRes.error;

    const todayRows = todayJobsRes.data ?? [];
    const todayAttempts = todayRows.length;
    const todaySuccess = todayRows.filter((r) => r.status === "completed").length;
    const todayFailed = todayRows.filter((r) => r.status === "failed").length;

    const weekRows = weekJobsRes.data ?? [];
    const weekAttempts = weekRows.length;
    const weekSuccess = weekRows.filter((r) => r.status === "completed").length;
    const successRate =
      weekAttempts === 0 ? 0 : Math.round((weekSuccess / weekAttempts) * 1000) / 10;

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

    return NextResponse.json({
      today: {
        attempts: todayAttempts,
        success: todaySuccess,
        failed: todayFailed,
      },
      last7Days: {
        attempts: weekAttempts,
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
    });
  } catch (error) {
    console.error("[admin/status]", error);
    return NextResponse.json({ error: "status_failed" }, { status: 500 });
  }
}
