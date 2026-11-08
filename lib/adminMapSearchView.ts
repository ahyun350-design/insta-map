/**
 * Admin expanded MapLibre search: camera after a search and the "이 지역에서 재검색" rule.
 * Pure — shared by the page and unit tests.
 */
type LatLng = { lat: number; lng: number };

/** Results within this distance of the search point count as "nearby". */
export const SEARCH_NEAR_M = 2000;
/** Fit at most this many nearest results. */
export const SEARCH_FIT_MAX = 10;
/** 재검색: map moved this far from the search point, or the zoom changed by a level. */
export const RESEARCH_MOVE_M = 300;
export const RESEARCH_LEVEL_DELTA = 1;

function distanceM(a: LatLng, b: LatLng): number {
  const r = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type SearchCameraPlan =
  | { kind: "fit"; points: LatLng[] }
  | { kind: "goto"; point: LatLng }
  | { kind: "none" };

/**
 * Never fly to #1 by default: when results lie near the search point, only fit the nearest
 * (≤10) of them; jump to #1 only when nothing is nearby.
 */
export function planSearchCamera(rankedPoints: LatLng[], origin: LatLng | null): SearchCameraPlan {
  const pts = rankedPoints.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return { kind: "none" };
  if (!origin) return { kind: "goto", point: pts[0]! };
  const near = pts
    .map((p) => ({ p, d: distanceM(origin, p) }))
    .filter((x) => x.d <= SEARCH_NEAR_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, SEARCH_FIT_MAX)
    .map((x) => x.p);
  if (!near.length) return { kind: "goto", point: pts[0]! };
  return { kind: "fit", points: near };
}

export type ResearchView = { center: LatLng; level: number };

/**
 * Show "이 지역에서 재검색" only while there are results and the map has moved ≥300m from the
 * search view or changed zoom by ≥1 level. Tapping it hides it (the caller re-searches).
 */
export function shouldShowResearch(input: {
  hasResults: boolean;
  searchView: ResearchView | null;
  now: ResearchView;
}): boolean {
  if (!input.hasResults || !input.searchView) return false;
  const moved = distanceM(input.searchView.center, input.now.center) >= RESEARCH_MOVE_M;
  const zoomed = Math.abs(input.now.level - input.searchView.level) >= RESEARCH_LEVEL_DELTA;
  return moved || zoomed;
}

/**
 * After every camera stop: a move the app made (search fit, result / pin pick, card open, resize)
 * becomes the new reference and hides the button; only the user's own drag / pinch can show it.
 */
export function researchOnIdle(input: {
  hasResults: boolean;
  searchView: ResearchView | null;
  now: ResearchView;
  byUser: boolean;
  pendingSearchSync: boolean;
}): { show: boolean; rebase: boolean } {
  if (!input.hasResults || !input.searchView) return { show: false, rebase: false };
  if (input.pendingSearchSync || !input.byUser) return { show: false, rebase: true };
  return { show: shouldShowResearch(input), rebase: false };
}
