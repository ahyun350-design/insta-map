/**
 * /api/extract/start 401 diagnostics — codes only.
 * Never persist Authorization, JWT, URL, or user ids.
 */

import { classifyExtractEntry } from "@/app/api/extract/_entry";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthFailReason =
  | "no_header"
  | "empty_token"
  | "expired"
  | "invalid_signature"
  | "user_not_found"
  | "invalid_session";

export type AuthFailClient = "share_ext" | "webview" | "unknown";

/** Max inserts per minute for the same client+reason (burst protection). */
export const AUTH_FAIL_RATE_LIMIT_PER_MINUTE = 10;

const WINDOW_MS = 60_000;

const rateBuckets = new Map<string, number[]>();

export function resetAuthFailRateLimitForTests(): void {
  rateBuckets.clear();
}

export function classifyAuthFailClient(
  userAgent: string | null | undefined,
): AuthFailClient {
  const entry = classifyExtractEntry(userAgent);
  if (entry === "share") return "share_ext";
  if (entry === "app") return "webview";
  return "unknown";
}

export function classifyAuthFailReason(input: {
  hasBearerHeader: boolean;
  jwtEmpty?: boolean;
  authErrorMessage?: string | null;
  hasUser?: boolean;
}): AuthFailReason {
  if (!input.hasBearerHeader) return "no_header";
  if (input.jwtEmpty) return "empty_token";

  const msg = (input.authErrorMessage ?? "").toLowerCase();
  if (msg.includes("expired")) return "expired";
  if (
    msg.includes("signature") ||
    msg.includes("malformed") ||
    msg.includes("invalid jwt") ||
    msg.includes("unable to parse")
  ) {
    return "invalid_signature";
  }
  if (
    msg.includes("does not exist") ||
    msg.includes("user_not_found") ||
    msg.includes("user not found")
  ) {
    return "user_not_found";
  }
  if (input.hasUser === false) return "user_not_found";
  return "invalid_session";
}

export function allowAuthFailRecord(
  client: AuthFailClient,
  reason: AuthFailReason,
  opts?: { now?: number; limit?: number; windowMs?: number },
): boolean {
  const now = opts?.now ?? Date.now();
  const limit = opts?.limit ?? AUTH_FAIL_RATE_LIMIT_PER_MINUTE;
  const windowMs = opts?.windowMs ?? WINDOW_MS;
  const key = `${client}|${reason}`;
  const cutoff = now - windowMs;
  const prev = rateBuckets.get(key) ?? [];
  const kept = prev.filter((t) => t > cutoff);
  if (kept.length >= limit) {
    rateBuckets.set(key, kept);
    return false;
  }
  kept.push(now);
  rateBuckets.set(key, kept);
  return true;
}

/**
 * Fire-and-forget-safe. user_id null (nullable column). No token/URL in meta.
 * Rate-limited; skipped attempts still log a short server line.
 */
export async function recordExtractStartAuthFail(
  admin: SupabaseClient,
  input: {
    reason: AuthFailReason;
    client: AuthFailClient;
  },
): Promise<void> {
  try {
    if (!allowAuthFailRecord(input.client, input.reason)) {
      console.warn(
        "[extract/start] auth_fail rate_limited",
        input.client,
        input.reason,
      );
      return;
    }
    const { error } = await admin.from("user_events").insert({
      user_id: null,
      event: "extract_start_auth_fail",
      meta: { reason: input.reason, client: input.client },
    });
    if (error) {
      console.warn("[extract/start] auth_fail insert failed", error.message);
    }
  } catch (e) {
    console.warn("[extract/start] auth_fail insert threw", e);
  }
}
