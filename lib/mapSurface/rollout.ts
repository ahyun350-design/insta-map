/**
 * MapLibre rollout gate (compact + expanded share the same user bucket).
 *
 * Priority (highest first):
 *  1. Session fallback after tile/style/WebGL failure → Kakao
 *  2. Admin override (force MapLibre / force Kakao)
 *  3. Rollout percent from stable user.id hash
 *
 * Policy:
 *  - Logged-out: always Kakao (no stable id; home map is auth-gated)
 *  - Non-iOS web: same rollout/admin rules as iOS WKWebView when WebGL works
 *  - WebGL unsupported: always Kakao (even admin force MapLibre)
 *
 * This deploy: MAP_GL_ROLLOUT_PERCENT = 0 → general users unchanged.
 * To raise: change MAP_GL_ROLLOUT_PERCENT in this file (line below, 0–100).
 */

import { trackMapGlFallback, type MapGlSurface } from "./mapGlTelemetry";

/** Raise this integer (0–100) to enroll users by stable user.id hash. */
export const MAP_GL_ROLLOUT_PERCENT = 0;

export type AdminMapGlOverride = "force_maplibre" | "force_kakao" | "auto";

export type MapGlDecisionInput = {
  isAdmin: boolean;
  userId: string | null | undefined;
  /** Session-only force Kakao after OpenFreeMap / WebGL failure. */
  sessionForceKakao: boolean;
  adminOverride: AdminMapGlOverride;
  /** For webgl_unsupported telemetry only. */
  surface?: MapGlSurface;
};

/** Stable 0–99 bucket from user id (FNV-1a 32-bit). */
export function userIdRolloutBucket(userId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

export function isInMapGlRollout(
  userId: string | null | undefined,
  percent: number = MAP_GL_ROLLOUT_PERCENT,
): boolean {
  if (!userId) return false;
  const p = Math.max(0, Math.min(100, Math.floor(percent)));
  if (p <= 0) return false;
  if (p >= 100) return true;
  return userIdRolloutBucket(userId) < p;
}

/** Detect WebGL; false → MapLibre must not mount. */
export function isMapLibreWebGlSupported(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext("experimental-webgl", {
        failIfMajorPerformanceCaveat: false,
      });
    return Boolean(gl);
  } catch {
    return false;
  }
}

function mapGlIntentWithoutWebGl(input: MapGlDecisionInput): boolean {
  if (input.sessionForceKakao) return false;
  if (input.isAdmin) {
    if (input.adminOverride === "force_kakao") return false;
    if (input.adminOverride === "force_maplibre") return true;
  }
  return isInMapGlRollout(input.userId, MAP_GL_ROLLOUT_PERCENT);
}

/**
 * Shared decision for compact + expanded MapLibre.
 * Same logged-in user always gets the same rollout bucket.
 */
export function shouldUseMapLibre(input: MapGlDecisionInput): boolean {
  if (!mapGlIntentWithoutWebGl(input)) return false;
  if (!isMapLibreWebGlSupported()) {
    if (input.surface) trackMapGlFallback(input.surface, "webgl_unsupported");
    return false;
  }
  return true;
}

export function cycleAdminMapGlOverride(
  current: AdminMapGlOverride,
): AdminMapGlOverride {
  if (current === "auto") return "force_maplibre";
  if (current === "force_maplibre") return "force_kakao";
  return "auto";
}

export function adminMapGlOverrideLabel(override: AdminMapGlOverride): string {
  if (override === "force_maplibre") return "ON";
  if (override === "force_kakao") return "강제 Kakao";
  return "자동";
}
