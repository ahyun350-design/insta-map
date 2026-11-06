/**
 * Admin expanded MapLibre search (D-2): our data first (search_map_admin RPC +
 * 도로명주소 API), Kakao keyword results appended only when ours are few.
 * Pure helpers shared by the API route, the page and tests.
 *
 * Kakao results are display-only (never stored). Recent queries live in this
 * device's localStorage only.
 */

import type { MapPoiKind, MapPoiTap } from "@/lib/mapSurface/mapPoiTap";
import { distanceMeters, placeNamesMatch } from "@/lib/mapPlaceMatch";

export type OurSource = "sangga" | "tour" | "landmark" | "station" | "dong" | "gu" | "si";

export type OurPlaceHit = {
  kind: "place";
  id: string;
  source: OurSource;
  name: string;
  branch: string | null;
  category: string | null;
  address: string | null;
  floor: string | null;
  lat: number;
  lng: number;
  distM: number | null;
  score: number;
  /** Station only: line refs + primary colour (from korea-station-labels). */
  lines?: string[];
  lineColour?: string | null;
};

export type OurAddressHit = {
  kind: "address";
  id: string;
  roadAddr: string;
  jibunAddr: string | null;
  buildingName: string | null;
};

export type OurHit = OurPlaceHit | OurAddressHit;

export type MapSearchApiResponse = {
  hits: OurHit[];
  diag: {
    ms: number;
    dbMs: number | null;
    jusoMs: number | null;
    dbError: string | null;
    jusoError: string | null;
  };
};

/** Kakao-shaped row for the existing results sheet / pins, plus our hit. */
export type AdminSearchRow = {
  id: string;
  place_name: string;
  category_name?: string;
  road_address_name?: string;
  address_name?: string;
  y?: string;
  x?: string;
  _pindHit?: OurHit;
};

export const SUGGEST_LIMIT = 8;
export const SUGGEST_DEBOUNCE_MS = 200;
export const RESULT_LIMIT = 15;
/** Kakao keyword is called only when ours return fewer rows than this. */
export const KAKAO_FILL_BELOW = 5;
export const DEDUPE_RADIUS_M = 50;
export const QUERY_MAX_LEN = 40;

/** 도로명 + 건물번호 ("망원로4길 3", "세종대로 175"). */
export function looksLikeRoadAddress(q: string): boolean {
  return /[가-힣0-9](로|길)\s*\d+(-\d+)?(\s|$)/.test(q.trim());
}

export function placeDisplayName(hit: OurPlaceHit): string {
  return hit.branch ? `${hit.name} ${hit.branch}` : hit.name;
}

export function hitLatLng(hit: OurHit): { lat: number; lng: number } | null {
  if (hit.kind !== "place") return null;
  return Number.isFinite(hit.lat) && Number.isFinite(hit.lng) ? { lat: hit.lat, lng: hit.lng } : null;
}

const SOURCE_LABEL: Record<OurSource, string> = {
  sangga: "상가",
  tour: "관광",
  landmark: "랜드마크",
  station: "지하철역",
  dong: "동",
  gu: "구·군",
  si: "시·군",
};

const SANGGA_CLASS_LABEL: Record<string, string> = {
  attraction: "명소",
  bakery: "베이커리",
  bar: "술집",
  books: "서점",
  cafe: "카페",
  cinema: "영화관",
  clothes: "의류",
  doctors: "의원",
  electronics: "전자제품",
  fast_food: "패스트푸드",
  florist: "꽃집",
  fuel: "주유소",
  furniture: "가구",
  gift: "선물",
  grocery: "식료품",
  hairdresser: "미용실",
  hospital: "병원",
  jewelry: "주얼리",
  laundry: "세탁소",
  library: "도서관",
  lodging: "숙박",
  optician: "안경",
  pharmacy: "약국",
  restaurant: "음식점",
  shoes: "신발",
  shop: "상점",
  sports: "스포츠",
  toys: "완구",
};

/** Display label for a hit's category (상가 poi_class → Korean; others as stored). */
export function hitCategoryLabel(hit: OurPlaceHit): string {
  if (hit.source === "sangga") {
    const c = hit.category ?? "";
    return SANGGA_CLASS_LABEL[c] ?? (/[가-힣]/.test(c) ? c : "상가");
  }
  return hit.category ?? SOURCE_LABEL[hit.source];
}

export function hitSubtitle(hit: OurHit): string {
  if (hit.kind === "address") return hit.buildingName ? `도로명주소 · ${hit.buildingName}` : "도로명주소";
  return [hitCategoryLabel(hit), hit.address].filter(Boolean).join(" · ");
}

export function toSearchRow(hit: OurHit): AdminSearchRow {
  if (hit.kind === "address") {
    return {
      id: hit.id,
      place_name: hit.roadAddr,
      category_name: "도로명주소",
      road_address_name: hit.roadAddr,
      address_name: hit.jibunAddr ?? "",
      _pindHit: hit,
    };
  }
  return {
    id: `pind-${hit.id}`,
    place_name: placeDisplayName(hit),
    category_name: hitCategoryLabel(hit),
    road_address_name: hit.address ?? "",
    address_name: "",
    y: String(hit.lat),
    x: String(hit.lng),
    _pindHit: hit,
  };
}

type KakaoLike = { place_name?: string; y?: string | number; x?: string | number };

/** Same place = name match (normalised, containment ≥3 chars) within 50m. */
export function isSamePlace(
  a: { name: string; lat: number; lng: number },
  b: { name: string; lat: number; lng: number },
): boolean {
  if (!placeNamesMatch(a.name, b.name)) return false;
  return distanceMeters(a.lat, a.lng, b.lat, b.lng) <= DEDUPE_RADIUS_M;
}

function rowPoint(r: { place_name?: string; y?: string | number; x?: string | number }) {
  const lat = parseFloat(String(r.y ?? ""));
  const lng = parseFloat(String(r.x ?? ""));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { name: String(r.place_name ?? ""), lat, lng };
}

/** Drop rows that are the same place as an earlier row (keeps first). */
export function dedupeRows<T extends KakaoLike>(rows: T[]): T[] {
  const kept: T[] = [];
  const points: Array<{ name: string; lat: number; lng: number }> = [];
  for (const r of rows) {
    const p = rowPoint(r);
    if (p && points.some((q) => isSamePlace(p, q))) continue;
    kept.push(r);
    if (p) points.push(p);
  }
  return kept;
}

/** Ours first; Kakao appended (minus same places) only when ours are few. */
export function mergeOursWithKakao<K extends KakaoLike>(
  ours: AdminSearchRow[],
  kakao: K[],
  limit: number = RESULT_LIMIT,
): Array<AdminSearchRow | K> {
  const base = dedupeRows(ours);
  if (base.length >= KAKAO_FILL_BELOW) return base.slice(0, limit);
  return dedupeRows<AdminSearchRow | K>([...base, ...kakao]).slice(0, limit);
}

const TOUR_TYPE_BY_CATEGORY: Record<string, string> = {
  관광명소: "12",
  문화시설: "14",
  레포츠: "28",
  시장: "38",
};

/** Our place hit → the same tap shape a basemap label uses (D-1 card). */
export function hitToMapPoiTap(hit: OurPlaceHit): MapPoiTap {
  const kind: MapPoiKind =
    hit.source === "sangga"
      ? "sangga"
      : hit.source === "tour"
        ? "tour"
        : hit.source === "station"
          ? "station"
          : "landmark";
  const lines = hit.lines ?? [];
  return {
    kind,
    layerId: "admin-search",
    name: placeDisplayName(hit),
    lat: hit.lat,
    lng: hit.lng,
    cls: hit.source === "sangga" ? hit.category : hit.source === "tour" ? "attraction" : null,
    subclass: null,
    buildingNo: null,
    lines,
    lineColour: hit.lineColour ?? null,
    lineRef: lines[0] ?? null,
    tourType: hit.source === "tour" ? (TOUR_TYPE_BY_CATEGORY[hit.category ?? ""] ?? null) : null,
  };
}

/** 동·구·시 hits only move the map (no place card). Kakao level. */
export function areaLevel(hit: OurPlaceHit): number | null {
  if (hit.source === "dong") return 5;
  if (hit.source === "gu") return 6;
  if (hit.source === "si") return 8;
  return null;
}

/** user_events meta: lengths / counts / code only — never the query text. */
export function searchEventMeta(query: string, count: number, code: string) {
  return { len: query.trim().length, n: count, code };
}

export const RECENT_KEY = "pindmap_admin_map_recent_v1";
export const RECENT_MAX = 10;

export function readRecentSearches(storage: Pick<Storage, "getItem"> | null): string[] {
  if (!storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentSearch(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  query: string,
): string[] {
  const q = query.trim().slice(0, QUERY_MAX_LEN);
  const prev = readRecentSearches(storage);
  if (!q) return prev;
  const next = [q, ...prev.filter((s) => s !== q)].slice(0, RECENT_MAX);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

export function clearRecentSearches(storage: Pick<Storage, "removeItem"> | null): void {
  try {
    storage?.removeItem(RECENT_KEY);
  } catch {
    /* noop */
  }
}
