export type CameraPadding = { top: number; right: number; bottom: number; left: number };

export const ZERO_PADDING: CameraPadding = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * easeTo / jumpTo padding for a result camera. No bottom inset → no `padding` key at all:
 * MapLibre reads `'padding' in options`, and an undefined value throws inside easeTo
 * (the camera then never moves).
 */
export function resultCameraPadding(opts?: {
  paddingBottom?: number;
  paddingTop?: number;
}): { padding?: CameraPadding } {
  const bottom = Math.max(0, Math.round(opts?.paddingBottom ?? 0));
  if (bottom <= 0) return {};
  const top = Math.max(48, Math.round(opts?.paddingTop ?? 96));
  return { padding: { top, right: 36, bottom, left: 36 } };
}

/** How much of the map the results sheet covers right now (0 when it is not on screen). */
export function visibleSheetInset(
  map: { top: number; bottom: number } | null,
  sheet: { top: number; bottom: number } | null,
): number {
  if (!map || !sheet) return 0;
  const top = Math.max(map.top, sheet.top);
  const bottom = Math.min(map.bottom, sheet.bottom);
  return bottom > top ? Math.round(map.bottom - top) : 0;
}

const SEARCH_FIT_TOP = 108;
const SEARCH_FIT_SIDE = 28;
const SEARCH_FIT_ABOVE_SHEET = 20;

/** Padding for fitting several results: search chrome on top, the visible sheet (only) below. */
export function searchFitPadding(sheetInsetPx: number): CameraPadding {
  const sheet = Math.max(0, Math.round(sheetInsetPx));
  return {
    top: SEARCH_FIT_TOP,
    right: SEARCH_FIT_SIDE,
    bottom: sheet > 0 ? sheet + SEARCH_FIT_ABOVE_SHEET : SEARCH_FIT_SIDE,
    left: SEARCH_FIT_SIDE,
  };
}

type FitMap = {
  setPadding: (p: CameraPadding) => unknown;
  fitBounds: (
    bounds: [[number, number], [number, number]],
    opts: { padding: CameraPadding; maxZoom: number; duration: number },
  ) => unknown;
};

/**
 * Fit several results. A place card's camera leaves its bottom inset on the map, and MapLibre's
 * fitBounds adds the map's inset to the one passed here — so clear it first; only `padding`
 * (the sheet showing now) counts.
 */
export function fitSearchResultsOn(
  map: FitMap,
  points: Array<{ lat: number; lng: number }>,
  padding: CameraPadding,
  maxZoom = 16,
): boolean {
  if (points.length < 2) return false;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  map.setPadding({ ...ZERO_PADDING });
  map.fitBounds([[w, s], [e, n]], { padding, maxZoom, duration: 0 });
  return true;
}
