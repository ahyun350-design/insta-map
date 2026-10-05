import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXTRACT_SHARE_NOTIFY_DEDUPE_MS,
  EXTRACT_SHARE_OUTCOME_TYPE,
  decideExtractShareNotify,
  type ExtractShareOutcomeKind,
} from "@/lib/extractShareNotify";

/**
 * Insert share-only outcome notification. Never throws.
 * Dedupe: same user + kind within 1 minute.
 */
export async function notifyExtractShareOutcome(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    jobId: string;
    entry: string | null | undefined;
    outcome: "all_saved" | "failed";
    failCode?: string | null;
  },
): Promise<void> {
  try {
    const decision = decideExtractShareNotify({
      entry: opts.entry,
      outcome: opts.outcome,
      failCode: opts.failCode,
    });
    if (!decision.notify) return;

    const userId = String(opts.userId ?? "").trim();
    const jobId = String(opts.jobId ?? "").trim();
    if (!userId || !jobId) return;

    const kind: ExtractShareOutcomeKind = decision.kind;
    const since = new Date(
      Date.now() - EXTRACT_SHARE_NOTIFY_DEDUPE_MS,
    ).toISOString();

    const { data: recent, error: recentErr } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", EXTRACT_SHARE_OUTCOME_TYPE)
      .eq("actor_username", kind)
      .gte("created_at", since)
      .limit(1);
    if (recentErr) {
      console.warn("[extract] share notify dedupe check failed", recentErr.message);
    } else if (recent && recent.length > 0) {
      return;
    }

    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const { error } = await supabase.from("notifications").insert({
      id,
      user_id: userId,
      type: EXTRACT_SHARE_OUTCOME_TYPE,
      actor_id: userId,
      // kind code for dedupe (not shown in UI — client uses target_text)
      actor_username: kind,
      target_id: jobId,
      // Korean copy for list + push worker body (no URL/caption/address)
      target_text: decision.message,
    });
    if (error) {
      console.warn("[extract] share notify insert failed", error.message);
    }
  } catch (e) {
    console.warn("[extract] share notify threw", e);
  }
}
