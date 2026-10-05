import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractEntry } from "./_entry";

export type ExtractTimingMeta = {
  entry: ExtractEntry;
  ok: boolean;
  fail_code: string | null;
  wait_ms: number | null;
  apify_ms: number | null;
  claude_ms: number | null;
  kakao_ms: number | null;
  poi_ms: number | null;
  save_ms: number | null;
  total_ms: number;
  place_count: number;
};

/** Short fail code only — strip payload after `|`, cap length. */
export function extractFailCode(message: string): string {
  const head = String(message ?? "").split("|")[0].trim();
  if (!head) return "unknown";
  return head.slice(0, 64);
}

/**
 * Fire-and-forget-safe: never throws. Inserts one user_events row.
 * Returns write duration ms for overhead logging (null on skip/fail).
 */
export async function recordExtractTiming(
  supabase: SupabaseClient,
  userId: string,
  meta: ExtractTimingMeta,
): Promise<number | null> {
  const uid = String(userId ?? "").trim();
  if (!uid) return null;
  const t0 = Date.now();
  try {
    const safe: ExtractTimingMeta = {
      entry: meta.entry,
      ok: meta.ok === true,
      fail_code: meta.ok ? null : extractFailCode(meta.fail_code ?? "unknown"),
      wait_ms: numOrNull(meta.wait_ms),
      apify_ms: numOrNull(meta.apify_ms),
      claude_ms: numOrNull(meta.claude_ms),
      kakao_ms: numOrNull(meta.kakao_ms),
      poi_ms: numOrNull(meta.poi_ms),
      save_ms: numOrNull(meta.save_ms),
      total_ms: Math.max(0, Math.round(Number(meta.total_ms) || 0)),
      place_count: Math.max(0, Math.round(Number(meta.place_count) || 0)),
    };
    const { error } = await supabase.from("user_events").insert({
      user_id: uid,
      event: "extract_timing",
      meta: safe,
    });
    if (error) {
      console.warn("[extract] extract_timing insert failed", error.message);
      return null;
    }
    return Date.now() - t0;
  } catch (e) {
    console.warn("[extract] extract_timing insert threw", e);
    return null;
  }
}

function numOrNull(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.round(v));
}
