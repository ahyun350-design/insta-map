import { supabase } from "@/lib/supabase";
import { track } from "@/lib/track";

export type MapGlSurface = "compact" | "expanded" | "public_list";
export type MapGlFallbackReason =
  | "style_timeout"
  | "style_error"
  | "load_timeout"
  | "tile_timeout"
  | "webgl_unsupported"
  | "error"
  | "webglcontextlost";

const readyFired = new Set<MapGlSurface>();
const fallbackFired = new Set<MapGlSurface>();

/** Per-surface mount count this page session (1 = cold, 2+ = warm). */
const mountCountBySurface: Partial<Record<MapGlSurface, number>> = {};

export type MapGlTimingMeta = {
  surface: MapGlSurface;
  /** true when this surface already mounted once in the session */
  warm: boolean;
  from_app_start_ms: number;
  js_ms: number;
  create_ms: number;
  style_ms: number;
  idle_ms: number;
  pins_ms: number;
};

function safeMs(v: number): number {
  return Math.max(0, Math.round(Number(v) || 0));
}

/** Session-once: map_gl_ready { surface, ms } — no coords/addresses. */
export function trackMapGlReady(surface: MapGlSurface, ms: number): void {
  if (readyFired.has(surface)) return;
  readyFired.add(surface);
  track("map_gl_ready", { surface, ms: safeMs(ms) });
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

/** After a successful remount following webglcontextlost. */
export function trackMapGlRecovered(surface: MapGlSurface): void {
  track("map_gl_recovered", { surface });
}

/**
 * Admin MapLibre phase timing (compact/expanded only).
 * Fire-and-forget; never throws; must not block the map.
 * Bypasses track()'s 5s event-name dedupe so cold+warm can both record.
 */
export function trackMapGlTiming(
  surface: MapGlSurface,
  phases: Omit<MapGlTimingMeta, "surface" | "warm">,
): void {
  if (surface !== "compact" && surface !== "expanded") return;
  void (async () => {
    try {
      const prev = mountCountBySurface[surface] ?? 0;
      const next = prev + 1;
      mountCountBySurface[surface] = next;
      const warm = next >= 2;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      const meta: MapGlTimingMeta = {
        surface,
        warm,
        from_app_start_ms: safeMs(phases.from_app_start_ms),
        js_ms: safeMs(phases.js_ms),
        create_ms: safeMs(phases.create_ms),
        style_ms: safeMs(phases.style_ms),
        idle_ms: safeMs(phases.idle_ms),
        pins_ms: safeMs(phases.pins_ms),
      };

      const { error } = await supabase.from("user_events").insert({
        user_id: userId,
        event: "map_gl_timing",
        meta,
      });
      if (error) {
        console.warn("[track] map_gl_timing", error.message);
      }
    } catch (err) {
      console.warn("[track] map_gl_timing", err);
    }
  })();
}
