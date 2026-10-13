import { createHash } from "node:crypto";
import { loadEnvLocal } from "./env";

loadEnvLocal();

/** Same derivation as lib/mapPreviewAccess.ts (keep in sync). */
export function computeMapPreviewE2eToken(): string {
  const raw =
    process.env.EXTRACT_INTERNAL_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  if (!raw) {
    throw new Error(
      "EXTRACT_INTERNAL_SECRET or SUPABASE_SERVICE_ROLE_KEY required for /map-preview e2e",
    );
  }
  return createHash("sha256")
    .update(`pindmap-map-preview-e2e:v1:${raw}`)
    .digest("hex")
    .slice(0, 32);
}

/** Append ?e2e=… (or &e2e=…) so production /map-preview allows Playwright. */
export function withMapPreviewE2e(path: string): string {
  const token = computeMapPreviewE2eToken();
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}e2e=${encodeURIComponent(token)}`;
}
