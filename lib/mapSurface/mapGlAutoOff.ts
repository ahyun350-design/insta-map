/**
 * Device-local MapLibre auto-off (memory + sessionStorage flag only).
 * Triggers:
 *  - 2× map_gl_fallback in one session, or
 *  - WebGL context lost with remount recovery exhausted
 * Duration: 24h within the session scope (flag carries until expiry or session end).
 * Telemetry: user_events code only — no URL/coords/query in meta.
 */

export const MAP_GL_AUTO_OFF_MS = 24 * 60 * 60 * 1000;
export const MAP_GL_AUTO_OFF_FALLBACK_THRESHOLD = 2;
export const MAP_GL_AUTO_OFF_SESSION_KEY = "pindmap_map_gl_auto_off_until";

export type MapGlAutoOffCode = "fallback_x2" | "webgl_recover_fail";

let memoryUntil = 0;
let fallbackCount = 0;

function readSessionUntil(): number {
  if (typeof sessionStorage === "undefined") return 0;
  try {
    const raw = sessionStorage.getItem(MAP_GL_AUTO_OFF_SESSION_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeSessionUntil(until: number): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (until <= 0) {
      sessionStorage.removeItem(MAP_GL_AUTO_OFF_SESSION_KEY);
    } else {
      sessionStorage.setItem(MAP_GL_AUTO_OFF_SESSION_KEY, String(until));
    }
  } catch {
    /* ignore quota */
  }
}

function activeUntil(): number {
  const fromSession = readSessionUntil();
  const until = Math.max(memoryUntil, fromSession);
  if (until > 0 && until !== memoryUntil) memoryUntil = until;
  return until;
}

/** true while device is pinned to Kakao for MapLibre. */
export function isMapGlAutoOffActive(now = Date.now()): boolean {
  const until = activeUntil();
  if (until <= 0) return false;
  if (now >= until) {
    clearMapGlAutoOff();
    return false;
  }
  return true;
}

export function getMapGlAutoOffUntil(): number {
  return isMapGlAutoOffActive() ? activeUntil() : 0;
}

export function getMapGlFallbackCountForAutoOff(): number {
  return fallbackCount;
}

function activate(code: MapGlAutoOffCode, now = Date.now()): void {
  if (isMapGlAutoOffActive(now)) return;
  const until = now + MAP_GL_AUTO_OFF_MS;
  memoryUntil = until;
  writeSessionUntil(until);
  void import("@/lib/track")
    .then(({ track }) => {
      track("map_gl_auto_off", { code });
    })
    .catch(() => {
      /* ignore */
    });
}

/** Count a map_gl_fallback occurrence; at 2 → auto-off. */
export function noteMapGlFallbackForAutoOff(): void {
  fallbackCount += 1;
  if (fallbackCount >= MAP_GL_AUTO_OFF_FALLBACK_THRESHOLD) {
    activate("fallback_x2");
  }
}

/** WebGL remount exhausted → auto-off. */
export function noteMapGlWebGlRecoverFail(): void {
  activate("webgl_recover_fail");
}

export function clearMapGlAutoOff(): void {
  memoryUntil = 0;
  writeSessionUntil(0);
}

/** Reset counters + flag (unit / e2e). */
export function resetMapGlAutoOffForTests(): void {
  fallbackCount = 0;
  clearMapGlAutoOff();
}

/** E2E: force auto-off active for 24h from now. */
export function activateMapGlAutoOffForTests(code: MapGlAutoOffCode = "fallback_x2"): void {
  activate(code);
}
