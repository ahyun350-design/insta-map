import { createHash } from "node:crypto";

/** Admin user allowed to open /map-preview without e2e token. */
export const MAP_PREVIEW_ADMIN_USER_ID =
  "63772749-e01b-4396-a41c-c17a4d3acfe6";

/**
 * Derive a short e2e query token from server secrets already on Vercel/Railway.
 * Not a public API key — only for Playwright against production /map-preview.
 */
export function mapPreviewE2eTokenFromSecret(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return createHash("sha256")
    .update(`pindmap-map-preview-e2e:v1:${s}`)
    .digest("hex")
    .slice(0, 32);
}

/** Server-side expected e2e token (EXTRACT_INTERNAL_SECRET → service role fallback). */
export function expectedMapPreviewE2eToken(): string | null {
  return mapPreviewE2eTokenFromSecret(
    process.env.EXTRACT_INTERNAL_SECRET?.trim() ||
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      null,
  );
}

export function isMapPreviewE2eTokenValid(
  provided: string | null | undefined,
): boolean {
  const expected = expectedMapPreviewE2eToken();
  const got = String(provided ?? "").trim();
  if (!expected || !got || got.length !== expected.length) return false;
  // Constant-time-ish compare without importing timingSafeEqual for short hex
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  }
  return diff === 0;
}
