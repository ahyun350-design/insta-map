import {
  type MapGlDecisionInput,
  MAP_GL_ROLLOUT_PERCENT,
  isInMapGlRollout,
} from "./rollout";
import { trackMapGlFallback } from "./mapGlTelemetry";

let supported: boolean | null = null;
let probes = 0;

const PROBE_OPTS: WebGLContextAttributes = { failIfMajorPerformanceCaveat: false };

/**
 * WebGL support, probed once per page session; the probe context is released at once.
 * Render paths must use this instead of rollout.ts isMapLibreWebGlSupported(): every call
 * there creates a WebGL context that is never released, and iOS WebKit drops the oldest
 * live context — the map — once a page holds too many.
 */
export function isWebGlSupportedOnce(): boolean {
  if (supported !== null) return supported;
  if (typeof document === "undefined") return false;
  probes += 1;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2", PROBE_OPTS) ||
      canvas.getContext("webgl", PROBE_OPTS) ||
      canvas.getContext("experimental-webgl", PROBE_OPTS)) as WebGLRenderingContext | null;
    supported = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    supported = false;
  }
  return supported;
}

/** Probes run this page session (diagnostics / e2e: must stay ≤ 1). */
export function webGlSupportProbeCount(): number {
  return probes;
}

export function resetWebGlSupportForTests(): void {
  supported = null;
  probes = 0;
}

/**
 * rollout.ts shouldUseMapLibre() with the once-per-session WebGL check.
 * Same priority: session fallback → admin override → rollout percent; then WebGL.
 */
export function shouldUseMapLibreOnce(input: MapGlDecisionInput): boolean {
  if (input.sessionForceKakao) return false;
  const intent = input.isAdmin && input.adminOverride !== "auto"
    ? input.adminOverride === "force_maplibre"
    : isInMapGlRollout(input.userId, MAP_GL_ROLLOUT_PERCENT);
  if (!intent) return false;
  if (!isWebGlSupportedOnce()) {
    if (input.surface) trackMapGlFallback(input.surface, "webgl_unsupported");
    return false;
  }
  return true;
}
