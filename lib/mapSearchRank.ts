/**
 * Kakao Places keyword ranking for expanded MapLibre search (admin).
 *
 * DISTANCE+map-center bias turns destination queries like "전주 한옥마을" into
 * nearby franchise restaurants ("한옥마을 전주비빔밥 …"). Prefer ACCURACY for
 * multi-token / landmark-like queries and re-rank by name·category match.
 *
 * Gate: only when expanded MapLibre is active (admin force / e2e).
 * General Kakao / native paths keep DISTANCE. To open to everyone later, set
 * {@link DESTINATION_SEARCH_RANKING_REQUIRES_MAPLIBRE} to false (one flip).
 */

export type KakaoPlaceHit = {
  id?: string;
  place_name?: string;
  category_name?: string;
  address_name?: string;
  road_address_name?: string;
  y?: string | number;
  x?: string | number;
  [key: string]: unknown;
};

/**
 * When true, destination ACCURACY ranking runs only on expanded MapLibre.
 * Set to false to enable for all keyword-search callers (full public).
 */
export const DESTINATION_SEARCH_RANKING_REQUIRES_MAPLIBRE = true;

/** Single flip point: MapLibre expanded today; all surfaces when flag is false. */
export function shouldApplyDestinationSearchRanking(
  isExpandedMapLibreActive: boolean,
): boolean {
  if (!DESTINATION_SEARCH_RANKING_REQUIRES_MAPLIBRE) return true;
  return isExpandedMapLibreActive;
}

const LANDMARK_HINT =
  /(마을|시장|해수욕장|해변|공원|궁|타워|다리|역|사찰|박물관|미술관|성$|광장|폭포|섬|호수|온천|문화재|유적)/;

const FOOD_CATEGORY = /음식점|카페|간식|술집|치킨|피자|패스트푸드|한식|중식|일식|양식/;

const TOUR_CATEGORY = /여행|관광|명소|문화시설|쇼핑|시장|레포츠|교통|공공기관/;

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, "");
}

/** Destination-style queries should not use SortBy.DISTANCE from map center. */
export function preferAccuracySort(query: string): boolean {
  const s = query.trim();
  if (!s) return false;
  if (/\s/.test(s) && s.length >= 4) return true;
  if (LANDMARK_HINT.test(s)) return true;
  if (s.length >= 6 && /(전주|강릉|부산|제주|경주|여수|속초|인천|대구|광주|대전)/.test(s)) {
    return true;
  }
  return false;
}

function nameScore(queryNorm: string, placeName: string): number {
  const n = normalizeQuery(placeName);
  if (!n || !queryNorm) return 0;
  if (n === queryNorm) return 100;
  if (n.includes(queryNorm) || queryNorm.includes(n)) return 80;
  let best = 0;
  for (let len = Math.min(n.length, queryNorm.length); len >= 3; len--) {
    for (let i = 0; i <= queryNorm.length - len; i++) {
      const sub = queryNorm.slice(i, i + len);
      if (n.includes(sub)) best = Math.max(best, len);
    }
  }
  return Math.min(70, best * 4);
}

function categoryScore(category: string): number {
  if (!category) return 0;
  if (TOUR_CATEGORY.test(category) && !FOOD_CATEGORY.test(category)) return 40;
  if (FOOD_CATEGORY.test(category)) return -35;
  return 0;
}

function addressCityBoost(query: string, address: string): number {
  const cities = query.match(
    /(전주|강릉|부산|제주|경주|여수|속초|인천|대구|광주|대전|서울|홍대|해운대|감천)/g,
  );
  if (!cities?.length || !address) return 0;
  return cities.some((c) => address.includes(c)) ? 25 : 0;
}

/**
 * Stable re-rank: higher score first. Does not drop hits.
 */
export function rankKakaoPlaceSearchResults<T extends KakaoPlaceHit>(
  query: string,
  places: T[],
): T[] {
  const qNorm = normalizeQuery(query);
  if (!qNorm || places.length <= 1) return places;

  const scored = places.map((p, index) => {
    const name = String(p.place_name ?? "");
    const cat = String(p.category_name ?? "");
    const addr = String(p.road_address_name || p.address_name || "");
    const score =
      nameScore(qNorm, name) +
      categoryScore(cat) +
      addressCityBoost(query, addr);
    return { p, score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.p);
}

/**
 * Build Kakao Places keywordSearch options.
 * @param destinationRanking — true only for admin expanded MapLibre (see gate).
 */
export function buildKakaoKeywordSearchOpts(
  kakaoMaps: { services?: { SortBy?: { DISTANCE?: unknown; ACCURACY?: unknown } } },
  query: string,
  bias: { lat: number; lng: number },
  LatLngCtor: new (lat: number, lng: number) => unknown,
  destinationRanking = false,
): Record<string, unknown> {
  const SortBy = kakaoMaps.services?.SortBy;
  const location = new LatLngCtor(bias.lat, bias.lng);
  if (destinationRanking && preferAccuracySort(query)) {
    const opts: Record<string, unknown> = {};
    if (SortBy?.ACCURACY != null) opts.sort = SortBy.ACCURACY;
    void location;
    return opts;
  }
  const opts: Record<string, unknown> = { location };
  if (SortBy?.DISTANCE != null) opts.sort = SortBy.DISTANCE;
  return opts;
}
