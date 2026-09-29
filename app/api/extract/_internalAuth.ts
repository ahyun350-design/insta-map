import { timingSafeEqual } from "node:crypto";

/** Server-to-server only — start → process. Never send from the browser. */
export const EXTRACT_INTERNAL_HEADER = "x-extract-internal-secret";

/**
 * Prefer dedicated EXTRACT_INTERNAL_SECRET; fall back to service role key
 * so Railway needs no new env for the same-commit deploy.
 */
export function getExtractInternalSecret(): string | null {
  return (
    process.env.EXTRACT_INTERNAL_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    null
  );
}

export function isValidExtractInternalSecret(
  provided: string | null | undefined,
  expected: string,
): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
