import type { MapGlSurface } from "./mapGlTelemetry";

/** Max MapLibre remounts after webglcontextlost per surface per page session. */
export const MAP_GL_REMOUNT_MAX = 2;

const remountAttempts: Record<MapGlSurface, number> = {
  compact: 0,
  expanded: 0,
  // public_list uses one-shot Kakao fallback, not WebGL remount.
  public_list: 0,
};

export function mapGlRemountAttemptsUsed(surface: MapGlSurface): number {
  return remountAttempts[surface];
}

export function canAttemptMapGlRemount(surface: MapGlSurface): boolean {
  return remountAttempts[surface] < MAP_GL_REMOUNT_MAX;
}

/** Consume one remount attempt. Returns new count. */
export function consumeMapGlRemountAttempt(surface: MapGlSurface): number {
  remountAttempts[surface] += 1;
  return remountAttempts[surface];
}

/**
 * At most one live MapLibre WebGL context in the app shell.
 * Preview route registers separately; home compact/expanded share this slot.
 */
type ActiveGl = {
  surface: MapGlSurface | "preview";
  release: () => void;
};

let activeGl: ActiveGl | null = null;

export function claimMapGlSlot(
  surface: MapGlSurface | "preview",
  release: () => void,
): void {
  if (activeGl && activeGl.surface !== surface) {
    const prev = activeGl;
    activeGl = null; // clear first — avoid re-entrant claim during release
    try {
      prev.release();
    } catch {
      /* noop */
    }
  }
  activeGl = { surface, release };
}

export function releaseMapGlSlot(surface: MapGlSurface | "preview"): void {
  if (activeGl?.surface === surface) activeGl = null;
}

export function activeMapGlSlot(): (MapGlSurface | "preview") | null {
  return activeGl?.surface ?? null;
}
