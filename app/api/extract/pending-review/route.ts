/**
 * Latest completed extract job(s) for the bearer user that still need review UI.
 * Criteria: status=completed, reviewed_at IS NULL, completed_at within 24h,
 * result_places length >= 1.
 *
 * Backward-compatible fields (unchanged meaning):
 *   jobId, places, count, at — always the newest eligible single job (or empty).
 * Additive:
 *   jobs — up to EXTRACT_REVIEW_BATCH_MAX eligible jobs (newest first), each
 *          { jobId, places, count, at }. Omitted shape never used by old clients.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireBearerClaims } from "@/lib/requireBearerClaims";
import { EXTRACT_REVIEW_MAX_AGE_MS } from "@/lib/extractReviewPending";
import { EXTRACT_REVIEW_BATCH_MAX } from "@/lib/extractReviewBatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlaceRow = {
  id?: string;
  name?: string;
  address?: string;
  category?: string;
  subcategory?: string | null;
};

function normalizePlaces(raw: unknown) {
  const list = Array.isArray(raw) ? (raw as PlaceRow[]) : [];
  return list
    .filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        p.id.trim() &&
        typeof p.name === "string" &&
        typeof p.address === "string" &&
        typeof p.category === "string",
    )
    .map((p) => ({
      id: String(p.id).trim(),
      name: String(p.name),
      address: String(p.address),
      category: String(p.category),
      subcategory:
        typeof p.subcategory === "string"
          ? p.subcategory
          : p.subcategory === null
            ? null
            : null,
    }));
}

export async function GET(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "서버 환경변수 미설정" }, { status: 500 });
    }

    const auth = await requireBearerClaims(req);
    if ("error" in auth) return auth.error;
    const userId = auth.user.id;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const since = new Date(Date.now() - EXTRACT_REVIEW_MAX_AGE_MS).toISOString();

    // Fetch enough rows to fill batch after filtering all_saved_already empties
    const { data, error } = await admin
      .from("extract_jobs")
      .select("id, result_places, completed_at, progress_step")
      .eq("user_id", userId)
      .eq("status", "completed")
      .is("reviewed_at", null)
      .gte("completed_at", since)
      .order("completed_at", { ascending: false })
      .limit(EXTRACT_REVIEW_BATCH_MAX + 10);

    if (error) throw error;

    const jobs: {
      jobId: string;
      places: ReturnType<typeof normalizePlaces>;
      count: number;
      at: number;
    }[] = [];

    for (const row of data ?? []) {
      if (jobs.length >= EXTRACT_REVIEW_BATCH_MAX) break;
      const step = String(row.progress_step ?? "");
      if (step.includes("all_saved_already")) continue;
      const places = normalizePlaces(row.result_places);
      if (places.length < 1) continue;

      const atMs = row.completed_at
        ? Date.parse(String(row.completed_at))
        : Date.now();

      jobs.push({
        jobId: String(row.id),
        places,
        count: places.length,
        at: Number.isFinite(atMs) ? atMs : Date.now(),
      });
    }

    if (jobs.length === 0) {
      return NextResponse.json({
        jobId: null,
        places: [],
        count: 0,
        at: null,
        jobs: [],
      });
    }

    const first = jobs[0]!;
    // Legacy single-job fields unchanged; `jobs` is additive for 모아 보기.
    return NextResponse.json({
      jobId: first.jobId,
      places: first.places,
      count: first.count,
      at: first.at,
      jobs,
    });
  } catch (e) {
    console.error("[extract/pending-review]", e);
    return NextResponse.json({ error: "pending_review_failed" }, { status: 500 });
  }
}
