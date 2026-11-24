/**
 * Admin MapLibre address card: "이 건물의 장소" list helpers.
 * Candidates come from sangga_places_near (~20m); the app keeps rows whose
 * road_address matches the opened address. Max 10. Pure functions only.
 */

export const BUILDING_PLACES_RADIUS_M = 20;
export const BUILDING_PLACES_MAX = 10;

export type BuildingPlaceCandidate = {
  id: string;
  name: string;
  branch: string | null;
  category: string | null;
  floor: string | null;
  roadAddress: string | null;
  lat: number;
  lng: number;
  distM: number;
};

/** Display row after address filter (name · 업종 · 층). */
export type BuildingPlaceItem = {
  id: string;
  name: string;
  category: string | null;
  floorLabel: string | null;
  lat: number;
  lng: number;
};

const SIDO_PREFIX =
  /^(서울특별시|서울시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|제주특별자치도|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도)/;

/** Compact key: 시·도·구 접두 제거 + 공백/구두점 제거 후 "…로|길 + 번지" 우선. */
export function roadAddressKey(raw: string | null | undefined): string {
  let s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!s) return "";
  s = s.replace(SIDO_PREFIX, "");
  s = s.replace(/^[가-힣]+(?:시|군|구)/, "");
  s = s.replace(/[·.,'"\-_/()]/g, "");
  const m = s.match(/([가-힣A-Za-z0-9]+(?:로|길)\d+(?:-\d+)?)/);
  return m ? m[1] : s;
}

export function roadAddressesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = roadAddressKey(a);
  const kb = roadAddressKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return ka.includes(kb) || kb.includes(ka);
}

/** "1" → "1층", "B1"/"지하1" → "지하 1층". Empty → null. */
export function formatBuildingFloor(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return `${s}층`;
  if (s === "지" || s === "지하") return "지하";
  const b = /^(?:B|지하)\s*(\d+)$/i.exec(s);
  if (b) return `지하 ${b[1]}층`;
  return s;
}

export function buildingPlaceDisplayName(
  name: string,
  branch: string | null | undefined,
): string {
  const n = String(name ?? "").trim();
  const br = String(branch ?? "").trim();
  if (!br) return n;
  if (!n) return br;
  if (n.includes(br)) return n;
  return `${n} ${br}`;
}

/**
 * Map icon category Korean labels (22 visible map icons; hidden z17+ classes omitted).
 * Keys = poi_class / OMT class aliases used on the basemap.
 */
export const BUILDING_PLACE_CATEGORY_KO: Readonly<Record<string, string>> = {
  restaurant: "음식점",
  fast_food: "패스트푸드",
  cafe: "카페",
  bakery: "빵·디저트",
  ice_cream: "빵·디저트",
  pastry: "빵·디저트",
  confectionery: "빵·디저트",
  bar: "술집",
  beer: "술집",
  pub: "술집",
  alcohol: "술집",
  wine: "술집",
  convenience: "편의점",
  grocery: "마트·시장",
  supermarket: "마트·시장",
  shop: "상점",
  books: "서점",
  clothes: "상점",
  shoes: "상점",
  florist: "상점",
  gift: "상점",
  jewelry: "상점",
  cosmetics: "상점",
  mall: "상점",
  lodging: "숙박",
  hotel: "숙박",
  hospital: "병원",
  doctors: "병원",
  clinic: "병원",
  dentist: "병원",
  pharmacy: "약국",
  bank: "은행",
  atm: "은행",
  beauty: "미용실",
  hairdresser: "미용실",
  school: "학교",
  college: "학교",
  kindergarten: "학교",
  university: "학교",
  park: "공원",
  playground: "공원",
  landmark: "명소",
  attraction: "명소",
  museum: "명소",
  cinema: "명소",
  town_hall: "행정",
  community_centre: "행정",
  library: "행정",
  police: "경찰",
  post: "우체국",
  post_office: "우체국",
  fuel: "주유소",
  parking: "주차장",
  subway: "지하철",
  railway: "지하철",
  station: "지하철",
};

const BUILDING_PLACE_CATEGORY_KO_VALUES = new Set(
  Object.values(BUILDING_PLACE_CATEGORY_KO),
);

/**
 * poi_class / 업종 원문 → 지도 아이콘 한글명.
 * 매핑 없으면 null (영어·미분류 한글 원문 노출 금지).
 */
export function buildingPlaceCategoryLabel(
  raw: string | null | undefined,
): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const mapped = BUILDING_PLACE_CATEGORY_KO[s.toLowerCase()];
  if (mapped) return mapped;
  if (BUILDING_PLACE_CATEGORY_KO_VALUES.has(s)) return s;
  return null;
}

/**
 * Keep candidates whose road_address matches `roadAddr`, nearest first, max N.
 * Dedupe by id, then by normalized name at the same floor.
 */
export function filterBuildingPlaces(
  candidates: BuildingPlaceCandidate[],
  roadAddr: string,
  max = BUILDING_PLACES_MAX,
): BuildingPlaceItem[] {
  const lim = Math.max(0, Math.min(max, BUILDING_PLACES_MAX));
  if (!roadAddr.trim() || lim === 0) return [];

  const matched = candidates
    .filter(
      (c) =>
        Number.isFinite(c.lat) &&
        Number.isFinite(c.lng) &&
        roadAddressesMatch(roadAddr, c.roadAddress),
    )
    .sort((a, b) => a.distM - b.distM || a.name.localeCompare(b.name, "ko"));

  const out: BuildingPlaceItem[] = [];
  const seenId = new Set<string>();
  const seenNameFloor = new Set<string>();
  for (const c of matched) {
    if (seenId.has(c.id)) continue;
    const displayName = buildingPlaceDisplayName(c.name, c.branch);
    if (!displayName) continue;
    const floorLabel = formatBuildingFloor(c.floor);
    const nf = `${displayName.toLowerCase()}|${floorLabel ?? ""}`;
    if (seenNameFloor.has(nf)) continue;
    seenId.add(c.id);
    seenNameFloor.add(nf);
    out.push({
      id: c.id,
      name: displayName,
      category: buildingPlaceCategoryLabel(c.category),
      floorLabel,
      lat: c.lat,
      lng: c.lng,
    });
    if (out.length >= lim) break;
  }
  return out;
}
