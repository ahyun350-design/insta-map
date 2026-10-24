import { supabase } from "@/lib/supabase";
import { track } from "@/lib/track";
import { noteMapGlFallbackForAutoOff } from "./mapGlAutoOff";

export type MapGlSurface = "compact" | "expanded" | "public_list";
export type MapGlFallbackReason =
  | "style_timeout"
  | "style_error"
  | "load_timeout"
  | "tile_timeout"
  | "webgl_unsupported"
  | "error"
  | "webglcontextlost"
  | "self_tiles_error";

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
  /** App start → snapshot or live map first shown in minimap slot */
  first_visible_ms: number;
  /** 1 if last-frame snapshot was shown before live map */
  snapshot_used: 0 | 1;
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

let mapEnvFired = false;

/**
 * Admin MapLibre only — once per page session.
 * meta: origin_domain (hostname only) + scheme. No path/query/coords.
 */
export function trackMapEnv(surface: MapGlSurface): void {
  if (mapEnvFired) return;
  if (surface !== "compact" && surface !== "expanded") return;
  if (typeof window === "undefined" || !window.location) return;
  mapEnvFired = true;
  let origin_domain = "";
  let scheme = "";
  try {
    origin_domain = String(window.location.hostname || "").slice(0, 253);
    scheme = String(window.location.protocol || "")
      .replace(/:$/, "")
      .slice(0, 32);
  } catch {
    return;
  }
  if (!origin_domain && !scheme) return;
  track("map_env", {
    code: "map_env",
    origin_domain,
    scheme,
    surface,
  });
}

/** Session-once telemetry; every call counts toward device auto-off. */
export function trackMapGlFallback(
  surface: MapGlSurface,
  reason: MapGlFallbackReason,
): void {
  noteMapGlFallbackForAutoOff();
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
        first_visible_ms: safeMs(phases.first_visible_ms),
        snapshot_used: phases.snapshot_used === 1 ? 1 : 0,
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
