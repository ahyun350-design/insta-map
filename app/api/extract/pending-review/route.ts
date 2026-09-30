/**
 * Latest completed extract job for the bearer user that still needs review UI.
 * Criteria: status=completed, reviewed_at IS NULL, completed_at within 24h,
 * result_places length >= 1.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireBearerClaims } from "@/lib/requireBearerClaims";
import { EXTRACT_REVIEW_MAX_AGE_MS } from "@/lib/extractReviewPending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlaceRow = {
  id?: string;
  name?: string;
  address?: string;
  category?: string;
  subcategory?: string | null;
};

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

    const { data, error } = await admin
      .from("extract_jobs")
      .select("id, result_places, completed_at, progress_step")
      .eq("user_id", userId)
      .eq("status", "completed")
      .is("reviewed_at", null)
      .gte("completed_at", since)
      .order("completed_at", { ascending: false })
      .limit(5);

    if (error) throw error;

    const rows = data ?? [];
    for (const row of rows) {
      const step = String(row.progress_step ?? "");
      if (step.includes("all_saved_already")) continue;
      const raw = Array.isArray(row.result_places)
        ? (row.result_places as PlaceRow[])
        : [];
      const places = raw
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
      if (places.length < 1) continue;

      const atMs = row.completed_at
        ? Date.parse(String(row.completed_at))
        : Date.now();

      // No caption / Instagram URL — only job id, places, count (+ at for 24h freshness)
      return NextResponse.json({
        jobId: row.id,
        places,
        count: places.length,
        at: Number.isFinite(atMs) ? atMs : Date.now(),
      });
    }

    return NextResponse.json({ jobId: null, places: [], count: 0, at: null });
  } catch (e) {
    console.error("[extract/pending-review]", e);
    return NextResponse.json({ error: "pending_review_failed" }, { status: 500 });
  }
}
