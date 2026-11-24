/**
 * Admin alert when Apify auth fails (401 / 403 / user-or-token-not-found).
 * Never throws — must not affect extract success/failure paths.
 * Push: reuses extract_share_outcome (swift-worker already sends that type).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_USER_ID } from "@/lib/adminRouteGate";
import { EXTRACT_SHARE_OUTCOME_TYPE } from "@/lib/extractShareNotify";

export const APIFY_AUTH_WARN_CODE = "apify_auth";
export const APIFY_AUTH_WARN_REASON =
  "Apify 키 인증 실패 — Railway APIFY_API_TOKEN 확인 필요";

export const APIFY_AUTH_NOTIFY_KIND = APIFY_AUTH_WARN_CODE;
export const APIFY_AUTH_DEDUPE_MS = 60 * 60 * 1000;

/** Head before `|` (same rule as pipeline warn codes). */
function failHead(raw: string): string {
  return String(raw ?? "").split("|")[0]?.trim() || "";
}

/**
 * Detect Apify auth failures in error_message / fail_code text.
 * Matches 401, 403, user-or-token-not-found, and normalized apify_auth.
 */
export function isApifyAuthFailureText(raw: string | null | undefined): boolean {
  const s = String(raw ?? "");
  if (!s) return false;
  const head = failHead(s);
  if (head === APIFY_AUTH_WARN_CODE) return true;
  if (/user-or-token-not-found/i.test(s)) return true;
  if (/^Apify/i.test(head) || /Apify/i.test(s)) {
    if (/\b401\b/.test(s) || /\b403\b/.test(s)) return true;
    if (/http[_ ]?401/i.test(s) || /http[_ ]?403/i.test(s)) return true;
  }
  return false;
}

/** Pure: skip insert when a same-kind admin alert already exists in the window. */
export function shouldInsertApifyAuthAdminNotify(input: {
  recentSameExists: boolean;
}): boolean {
  return input.recentSameExists !== true;
}

/**
 * Insert one admin notification (dedupe 1h). Returns status; never throws.
 */
export async function notifyAdminApifyAuthFailure(
  supabase: SupabaseClient,
  opts?: { jobId?: string | null; errorText?: string | null },
): Promise<"inserted" | "skipped" | "failed"> {
  try {
    const text = opts?.errorText;
    if (text != null && text !== "" && !isApifyAuthFailureText(text)) {
      return "skipped";
    }

    const adminId = ADMIN_USER_ID;
    if (!adminId) return "failed";

    const since = new Date(Date.now() - APIFY_AUTH_DEDUPE_MS).toISOString();
    const { data: recent, error: recentErr } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", adminId)
      .eq("type", EXTRACT_SHARE_OUTCOME_TYPE)
      .eq("actor_username", APIFY_AUTH_NOTIFY_KIND)
      .gte("created_at", since)
      .limit(1);

    if (recentErr) {
      console.warn("[extract] apify auth notify dedupe check failed", recentErr.message);
    } else if (
      !shouldInsertApifyAuthAdminNotify({
        recentSameExists: Array.isArray(recent) && recent.length > 0,
      })
    ) {
      return "skipped";
    }

    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const jobId = String(opts?.jobId ?? "").trim() || "apify-auth";

    const { error } = await supabase.from("notifications").insert({
      id,
      user_id: adminId,
      type: EXTRACT_SHARE_OUTCOME_TYPE,
      actor_id: adminId,
      actor_username: APIFY_AUTH_NOTIFY_KIND,
      target_id: jobId,
      target_text: APIFY_AUTH_WARN_REASON,
    });
    if (error) {
      console.warn("[extract] apify auth notify insert failed", error.message);
      return "failed";
    }
    return "inserted";
  } catch (e) {
    console.warn("[extract] apify auth notify threw", e);
    return "failed";
  }
}
