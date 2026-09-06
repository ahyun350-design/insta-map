/**
 * Admin card metrics vs DB (service role). Run: node --env-file=.env.local scripts/verify-admin-status-counts.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function kstTodayStartIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${parts}T00:00:00+09:00`).toISOString();
}

function daysAgoIso(days, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function countExact(table, apply) {
  let q = admin.from(table).select("id", { count: "exact", head: true });
  q = apply(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

const now = new Date();
const todayStart = kstTodayStartIso(now);
const weekAgo = daysAgoIso(7, now);

const [
  totalUsers,
  todayUsers,
  userEvents,
  todaySuccess,
  todayFailed,
  weekSuccess,
  weekFailed,
] = await Promise.all([
  countExact("users", (q) => q),
  countExact("users", (q) => q.gte("created_at", todayStart)),
  countExact("user_events", (q) => q),
  countExact("extract_jobs", (q) => q.eq("status", "completed").gte("created_at", todayStart)),
  countExact("extract_jobs", (q) => q.eq("status", "failed").gte("created_at", todayStart)),
  countExact("extract_jobs", (q) => q.eq("status", "completed").gte("created_at", weekAgo)),
  countExact("extract_jobs", (q) => q.eq("status", "failed").gte("created_at", weekAgo)),
]);

const weekDecided = weekSuccess + weekFailed;
const successRate =
  weekDecided === 0 ? 0 : Math.round((weekSuccess / weekDecided) * 1000) / 10;

console.log(
  JSON.stringify(
    {
      windows: { todayStart, weekAgo },
      signups: { total: totalUsers, today: todayUsers },
      userEventsTotal: userEvents,
      todayExtract: { success: todaySuccess, failed: todayFailed },
      last7Days: {
        success: weekSuccess,
        failed: weekFailed,
        successRate,
        label: `${successRate}% (성공 ${weekSuccess} / 실패 ${weekFailed})`,
      },
    },
    null,
    2,
  ),
);
