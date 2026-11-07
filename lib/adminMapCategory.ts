/**
 * Admin expanded MapLibre category chips (Kakao category / keyword search).
 * Kakao results are fetched live per request and only displayed — never stored, cached
 * or reused (no server/memory cache). Pure helpers shared by the API route, page and tests.
 */
import type { PoiCategoryId } from "@/lib/mapSurface/poiCategoryIcons";

export type CategoryChipId =
  | "food"
  | "cafe"
  | "bar"
  | "bakery"
  | "convenience"
  | "mart"
  | "pharmacy"
  | "hospital"
  | "bank"
  | "parking"
  | "fuel"
  | "lodging"
  | "attraction";

export type CategoryChip = {
  id: CategoryChipId;
  label: string;
  /** Map icon (same 22-category badge as basemap POIs). */
  icon: PoiCategoryId;
  /** Kakao category_group_code, or keyword queries when Kakao has no such group. */
  kakao: { code: string } | { queries: string[]; code?: string };
};

export const CATEGORY_CHIPS: readonly CategoryChip[] = [
  { id: "food", label: "음식점", icon: "restaurant", kakao: { code: "FD6" } },
  { id: "cafe", label: "카페", icon: "cafe", kakao: { code: "CE7" } },
  { id: "bar", label: "술집", icon: "bar", kakao: { queries: ["술집"], code: "FD6" } },
  { id: "bakery", label: "빵·디저트", icon: "bakery", kakao: { queries: ["베이커리", "디저트"] } },
  { id: "convenience", label: "편의점", icon: "convenience", kakao: { code: "CS2" } },
  { id: "mart", label: "마트·시장", icon: "grocery", kakao: { code: "MT1" } },
  { id: "pharmacy", label: "약국", icon: "pharmacy", kakao: { code: "PM9" } },
  { id: "hospital", label: "병원", icon: "hospital", kakao: { code: "HP8" } },
  { id: "bank", label: "은행", icon: "bank", kakao: { code: "BK9" } },
  { id: "parking", label: "주차장", icon: "parking", kakao: { code: "PK6" } },
  { id: "fuel", label: "주유소", icon: "fuel", kakao: { code: "OL7" } },
  { id: "lodging", label: "숙박", icon: "lodging", kakao: { code: "AD5" } },
  { id: "attraction", label: "관광명소", icon: "landmark", kakao: { code: "AT4" } },
];

export function categoryChip(id: string): CategoryChip | null {
  return CATEGORY_CHIPS.find((c) => c.id === id) ?? null;
}

export const CATEGORY_RESULT_LIMIT = 30;
export const CATEGORY_PAGE_SIZE = 15;
export const CATEGORY_PAGES = 2;
export const CATEGORY_FALLBACK_RADIUS_M = 1000;
/** Viewport wider than this (centre → corner) searches a 1km circle instead. */
export const CATEGORY_RECT_MAX_HALF_DIAGONAL_M = 1500;

export type SortMode = "distance" | "accuracy";

/** Name search opens in relevance order; a category chip in distance order. */
export function defaultSortMode(kind: "name" | "category"): SortMode {
  return kind === "category" ? "distance" : "accuracy";
}

type LatLng = { lat: number; lng: number };

function distanceM(a: LatLng, b: LatLng): number {
  const r = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Visible map (Kakao `rect`) when it is small enough, else a 1km circle around the centre. */
export function categorySearchArea(
  center: LatLng,
  bounds: { sw: LatLng; ne: LatLng } | null,
): { rect: string } | { radius: number } {
  if (bounds) {
    const far = Math.max(distanceM(center, bounds.sw), distanceM(center, bounds.ne));
    if (Number.isFinite(far) && far > 0 && far <= CATEGORY_RECT_MAX_HALF_DIAGONAL_M) {
      return { rect: `${bounds.sw.lng},${bounds.sw.lat},${bounds.ne.lng},${bounds.ne.lat}` };
    }
  }
  return { radius: CATEGORY_FALLBACK_RADIUS_M };
}

export type KakaoPlaceDoc = {
  id: string;
  place_name: string;
  category_name?: string;
  category_group_code?: string;
  road_address_name?: string;
  address_name?: string;
  phone?: string;
  place_url?: string;
  x: string;
  y: string;
  distance?: string;
};

/**
 * Pages of one or more queries → one list: same Kakao id kept once, distance mode sorted by
 * Kakao `distance`, accuracy mode interleaved by rank across queries; capped at the limit.
 */
export function mergeKakaoPages(
  perQuery: KakaoPlaceDoc[][],
  sort: SortMode,
  limit: number = CATEGORY_RESULT_LIMIT,
): KakaoPlaceDoc[] {
  const seen = new Set<string>();
  const out: KakaoPlaceDoc[] = [];
  const push = (d: KakaoPlaceDoc) => {
    if (!d?.id || seen.has(d.id)) return;
    seen.add(d.id);
    out.push(d);
  };
  if (sort === "distance") {
    perQuery
      .flat()
      .map((d, i) => ({ d, i, m: Number(d.distance) }))
      .sort((a, b) => (Number.isFinite(a.m) ? a.m : Infinity) - (Number.isFinite(b.m) ? b.m : Infinity) || a.i - b.i)
      .forEach((x) => push(x.d));
  } else {
    const longest = Math.max(0, ...perQuery.map((q) => q.length));
    for (let i = 0; i < longest; i++) for (const q of perQuery) if (q[i]) push(q[i]!);
  }
  return out.slice(0, limit);
}

/** The user counts as "at" the search point within this distance. */
export const USER_ORIGIN_MAX_M = 1000;

/**
 * One origin for both the distance order and the distance labels: the user when within 1km
 * of the search centre (map centre at search time), otherwise the search centre.
 */
export function resultDistanceOrigin(user: LatLng | null, searchCenter: LatLng | null): LatLng | null {
  if (user && searchCenter && distanceM(user, searchCenter) <= USER_ORIGIN_MAX_M) return user;
  return searchCenter ?? user;
}

/** Client re-order of displayed rows by distance from `origin` (rows without coords last). */
export function sortRowsByDistance<T extends { y?: string | number; x?: string | number }>(
  rows: readonly T[],
  origin: LatLng | null,
): T[] {
  if (!origin) return rows.slice();
  return rows
    .map((r, i) => {
      const lat = parseFloat(String(r.y ?? ""));
      const lng = parseFloat(String(r.x ?? ""));
      const m = Number.isFinite(lat) && Number.isFinite(lng) ? distanceM(origin, { lat, lng }) : Infinity;
      return { r, i, m };
    })
    .sort((a, b) => a.m - b.m || a.i - b.i)
    .map((x) => x.r);
}

/** Rows with no `_pindHit` came from Kakao (display only; credit "카카오" while shown). */
export function hasKakaoRows(rows: readonly { _pindHit?: unknown }[]): boolean {
  return rows.some((r) => !r._pindHit);
}

/** user_events meta: chip id / count / code only. */
export function categoryEventMeta(chip: CategoryChipId, count: number, code: string) {
  return { chip, n: count, code };
}
