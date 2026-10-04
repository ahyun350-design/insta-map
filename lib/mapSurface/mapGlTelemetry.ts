import { track } from "@/lib/track";

export type MapGlSurface = "compact" | "expanded";
export type MapGlFallbackReason =
  | "style_timeout"
  | "tile_timeout"
  | "webgl_unsupported"
  | "error"
  | "webglcontextlost";

const readyFired = new Set<MapGlSurface>();
const fallbackFired = new Set<MapGlSurface>();

/** Session-once: map_gl_ready { surface, ms } — no coords/addresses. */
export function trackMapGlReady(surface: MapGlSurface, ms: number): void {
  if (readyFired.has(surface)) return;
  readyFired.add(surface);
  const safeMs = Math.max(0, Math.round(Number(ms) || 0));
  track("map_gl_ready", { surface, ms: safeMs });
}

/** Session-once: map_gl_fallback { surface, reason } — no coords/addresses. */
export function trackMapGlFallback(
  surface: MapGlSurface,
  reason: MapGlFallbackReason,
): void {
  if (fallbackFired.has(surface)) return;
  fallbackFired.add(surface);
  track("map_gl_fallback", { surface, reason });
}
