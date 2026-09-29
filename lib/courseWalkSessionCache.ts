import type { CourseWalkNavigation, LatLng } from "@/lib/courseWalkNavigation";
import { buildCourseWalkNavigationFromTmap } from "@/lib/courseWalkNavigation";

const DEFAULT_MODE = "walk";

const sessionCache = new Map<string, CourseWalkNavigation>();
const inflight = new Map<string, Promise<CourseWalkNavigation>>();

export function courseWalkSessionCacheKey(
  stops: LatLng[],
  mode: string = DEFAULT_MODE,
): string {
  const stopsPart = stops
    .map((s) => `${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}`)
    .join("|");
  return `${mode}:${stopsPart}`;
}

export function getCourseWalkSessionCache(key: string): CourseWalkNavigation | null {
  return sessionCache.get(key) ?? null;
}

export function setCourseWalkSessionCache(
  key: string,
  navigation: CourseWalkNavigation,
): void {
  sessionCache.set(key, navigation);
}

/** Cache hit, shared inflight, or fresh Tmap batch build. */
export function getOrBuildCourseWalkNavigation(
  stops: LatLng[],
  stopNames: string[],
  mode: string = DEFAULT_MODE,
): Promise<CourseWalkNavigation> {
  const key = courseWalkSessionCacheKey(stops, mode);
  const hit = sessionCache.get(key);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = buildCourseWalkNavigationFromTmap(stops, stopNames)
    .then((navigation) => {
      sessionCache.set(key, navigation);
      return navigation;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
