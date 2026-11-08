/**
 * Admin expanded MapLibre search (D-2): our data first (search_map_admin RPC +
 * 도로명주소 API), Kakao keyword results appended only when ours are few.
 * Pure helpers shared by the API route, the page and tests.
 *
 * Kakao results are display-only (never stored). Recent queries live in this
 * device's localStorage only.
 */

import type { MapPoiKind, MapPoiTap } from "@/lib/mapSurface/mapPoiTap";
import type { PoiCategoryId } from "@/lib/mapSurface/poiCategoryIcons";
import { distanceMeters, normalizePlaceName, placeNamesMatch } from "@/lib/mapPlaceMatch";

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

/** Kakao keyword result (live, display only — never stored). */
export type KakaoKeywordHit = {
  kind: "kakao";
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  placeUrl: string | null;
  lat: number;
  lng: number;
};

export type OurHit = OurPlaceHit | OurAddressHit | KakaoKeywordHit;

export type MapSearchApiResponse = {
  hits: OurHit[];
  diag: {
    ms: number;
    dbMs: number | null;
    jusoMs: number | null;
    dbError: string | null;
    jusoError: string | null;
    /** "이디야 강남": the 동·역·구 point the query names (distance origin for ranking). */
    anchor?: { lat: number; lng: number } | null;
  };
};

export type MapKakaoSearchApiResponse = {
  hits: KakaoKeywordHit[];
  diag: { ms: number; error: string | null };
};

/** Kakao-shaped row for the existing results sheet / pins, plus our hit. */
export type AdminSearchRow = {
  id: string;
  place_name: string;
  category_name?: string;
  road_address_name?: string;
  address_name?: string;
  phone?: string;
  place_url?: string;
  y?: string;
  x?: string;
  /** Our place / address hit (Kakao rows have none). */
  _pindHit?: OurPlaceHit | OurAddressHit;
};

export const SUGGEST_LIMIT = 8;
export const SUGGEST_DEBOUNCE_MS = 200;
export const RESULT_LIMIT = 15;
/** Kakao keyword is called only when ours return fewer rows than this. */
export const KAKAO_FILL_BELOW = 5;
/** Name search: Kakao keyword slower than this (from the search start) → ours only. */
export const KAKAO_KEYWORD_TIMEOUT_MS = 800;
export const DEDUPE_RADIUS_M = 50;
export const QUERY_MAX_LEN = 40;

/** 도로명 + 건물번호 ("망원로4길 3", "세종대로 175"). */
export function looksLikeRoadAddress(q: string): boolean {
  return /[가-힣0-9](로|길)\s*\d+(-\d+)?(\s|$)/.test(q.trim());
}

export function placeDisplayName(hit: OurPlaceHit | KakaoKeywordHit): string {
  return hit.kind === "place" && hit.branch ? `${hit.name} ${hit.branch}` : hit.name;
}

export function hitLatLng(hit: OurHit): { lat: number; lng: number } | null {
  if (hit.kind === "address") return null;
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
  if (hit.kind === "kakao") {
    const cat = hit.category?.split(">").pop()?.trim() || null;
    return [cat, hit.address].filter(Boolean).join(" · ");
  }
  return [hitCategoryLabel(hit), hit.address].filter(Boolean).join(" · ");
}

export function toSearchRow(hit: OurHit): AdminSearchRow {
  if (hit.kind === "kakao") {
    return {
      id: `kakao-${hit.id}`,
      place_name: hit.name,
      category_name: hit.category ?? "",
      road_address_name: hit.address ?? "",
      address_name: "",
      phone: hit.phone ?? "",
      place_url: hit.placeUrl ?? "",
      y: String(hit.lat),
      x: String(hit.lng),
    };
  }
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

/** Famous places beat same-name shops (경복궁 vs 식당 "경복궁 서교점"). */
const CATALOG_BONUS: Partial<Record<OurSource, number>> = { tour: 30, landmark: 30, station: 30 };
const STATION_QUERY_BONUS = 40;
/** search_map_admin's distance bonus is 0–20; scores closer than this differ only by distance. */
const DISTANCE_BONUS_MAX = 20;
/** RPC candidates fetched before re-ranking. */
export const RPC_CANDIDATES = 20;

/**
 * Re-rank RPC rows: catalog bonus, "…역" queries prefer stations; stable on ties by distance.
 * Other queries: a station whose name (minus 역) equals a 관광·랜드마크 hit and differs from
 * it only by the distance bonus goes right after it (경복궁 before 경복궁역 — catalog
 * station names carry no 역, so both are exact matches).
 */
export function rerankPlaceHits(hits: OurPlaceHit[], query: string): OurPlaceHit[] {
  const stationQuery = /역$/.test(query.replace(/\s+/g, ""));
  const adjusted = hits.map((h, i) => ({
    h,
    i,
    s: h.score + (CATALOG_BONUS[h.source] ?? 0) + (stationQuery && h.source === "station" ? STATION_QUERY_BONUS : 0),
  }));
  adjusted.sort(
    (a, b) => b.s - a.s || (a.h.distM ?? Infinity) - (b.h.distM ?? Infinity) || a.i - b.i,
  );
  if (stationQuery) return adjusted.map((x) => x.h);
  for (let i = 0; i < adjusted.length; i++) {
    const st = adjusted[i]!;
    if (st.h.source !== "station") continue;
    const key = normalizePlaceName(st.h.name).replace(/역$/, "");
    const j = adjusted.findIndex(
      (x, k) =>
        k > i &&
        (x.h.source === "tour" || x.h.source === "landmark") &&
        normalizePlaceName(x.h.name) === key &&
        st.s - x.s <= DISTANCE_BONUS_MAX,
    );
    if (j < 0) continue;
    adjusted.splice(i, 0, ...adjusted.splice(j, 1));
    i++;
  }
  return adjusted.map((x) => x.h);
}

export const SAME_PLACE_RADIUS_M = 500;
const KEEP_PRIORITY: Partial<Record<OurSource, number>> = { landmark: 0, tour: 1, station: 2 };

/**
 * One row per real place among 관광·랜드마크·역 hits: same normalised name within
 * 500m (경복궁 관광 and 랜드마크 points are ~390m apart). The landmark row is kept
 * (at the group's first position); a tour member's category is used when there is
 * one. 상가 rows are never merged (different shops can share a name nearby);
 * 동·구·시 rows pass through.
 */
export function collapseSamePlaces(hits: OurPlaceHit[]): OurPlaceHit[] {
  type Group = { at: number; members: OurPlaceHit[] };
  const groups: Group[] = [];
  const out: Array<OurPlaceHit | Group> = [];
  for (const h of hits) {
    if (KEEP_PRIORITY[h.source] === undefined) {
      out.push(h);
      continue;
    }
    const key = normalizePlaceName(h.name);
    const g = groups.find((x) => {
      const head = x.members[0]!;
      return (
        normalizePlaceName(head.name) === key &&
        distanceMeters(head.lat, head.lng, h.lat, h.lng) <= SAME_PLACE_RADIUS_M
      );
    });
    if (g) {
      g.members.push(h);
      continue;
    }
    const ng: Group = { at: out.length, members: [h] };
    groups.push(ng);
    out.push(ng);
  }
  return out.map((x) => {
    if (!("members" in x)) return x;
    if (x.members.length === 1) return x.members[0]!;
    const keep = [...x.members].sort(
      (a, b) => (KEEP_PRIORITY[a.source] ?? 9) - (KEEP_PRIORITY[b.source] ?? 9),
    )[0]!;
    const tour = x.members.find((m) => m.source === "tour");
    return {
      ...keep,
      category: tour?.category ?? keep.category,
      score: Math.max(...x.members.map((m) => m.score)),
    };
  });
}

/**
 * Common chain name → the 상호 actually registered in 상가 data (checked with
 * name-prefix counts, scripts/localdata/probe_chain_aliases.py). Only names a plain
 * prefix search would miss; a shorter target ("이디야") also covers the long form.
 * Keys: lower-case, no spaces.
 */
export const CHAIN_ALIASES: Readonly<Record<string, string>> = {
  메가커피: "메가엠지씨커피",
  메가mgc커피: "메가엠지씨커피",
  이디야커피: "이디야",
  컴포즈커피: "컴포즈",
  할리스커피: "할리스",
  투썸플레이스: "투썸",
  백다방: "빽다방",
  맥도날드: "한국맥도날드",
  올리브영: "씨제이올리브영",
  매머드커피: "매머드",
  서브웨이: "써브웨이",
  kfc: "케이에프씨",
  케이에프씨: "KFC",
  bbq: "비비큐",
  비비큐: "BBQ",
  bhc: "비에이치씨",
  비에이치씨: "BHC",
  cu: "씨유",
  씨유: "CU",
  gs25: "지에스25",
  지에스25: "GS25",
  세븐일레븐: "7-ELEVEN",
  파리바게뜨: "파리바게트",
  파리바게트: "파리바게뜨",
  배스킨라빈스: "베스킨라빈스",
  베스킨라빈스: "배스킨라빈스",
  뚜레주르: "뚜레쥬르",
  뚜레쥬르: "뚜레주르",
  던킨도너츠: "던킨",
  엔젤리너스: "엔제리너스",
  엔제리너스: "엔젤리너스",
  스벅: "스타벅스",
  탐탐: "탐앤탐스",
};

/** "메가커피 성수" → "메가엠지씨커피 성수" (first word only); null when no alias. */
export function chainAliasQuery(query: string): string | null {
  const words = query.trim().split(/\s+/);
  for (let n = Math.min(2, words.length); n >= 1; n--) {
    const head = words.slice(0, n).join("").toLowerCase();
    const real = CHAIN_ALIASES[head];
    if (real) return [real, ...words.slice(n)].join(" ");
  }
  return null;
}

/** Kakao keyword document → display-only hit (null without coordinates). */
export function kakaoDocToHit(doc: {
  id?: string;
  place_name?: string;
  category_name?: string;
  road_address_name?: string;
  address_name?: string;
  phone?: string;
  place_url?: string;
  x?: string;
  y?: string;
}): KakaoKeywordHit | null {
  const lat = parseFloat(String(doc.y ?? ""));
  const lng = parseFloat(String(doc.x ?? ""));
  if (!doc.id || !doc.place_name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    kind: "kakao",
    id: doc.id,
    name: doc.place_name,
    category: doc.category_name || null,
    address: doc.road_address_name || doc.address_name || null,
    phone: doc.phone || null,
    placeUrl: doc.place_url || null,
    lat,
    lng,
  };
}

const squashName = (s: string) => s.toLowerCase().replace(/[\s()[\]{}（）·.,'"\-_/&+]/g, "");

/**
 * Chain alias groups (메가커피 / 메가엠지씨커피 / 메가MGC커피, 파리바게뜨 ↔ 파리바게트 …) →
 * [spelling, one canonical spelling], longest spelling first.
 */
const CHAIN_CANONICAL: Array<[string, string]> = (() => {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const [k, v] of Object.entries(CHAIN_ALIASES)) {
    const a = find(squashName(k));
    const b = find(squashName(v));
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    else parent.set(a, a);
  }
  return [...parent.keys()]
    .map((m) => [m, find(m)] as [string, string])
    .sort((x, y) => y[0].length - x[0].length);
})();

/**
 * Name key shared by ranking and duplicate checks: lower-case, no spaces / symbols, and a
 * leading chain name in its canonical spelling ("메가MGC커피 망원역점" ≡ "메가엠지씨커피망원역점").
 */
export function canonicalPlaceName(s: string): string {
  const k = squashName(s);
  for (const [spelling, canonical] of CHAIN_CANONICAL) {
    if (k.startsWith(spelling)) return canonical + k.slice(spelling.length);
  }
  return k;
}

/** Same name for duplicate checks, chain spellings unified (contains-match ≥3 chars). */
export function chainAwareNamesMatch(a: string, b: string): boolean {
  return placeNamesMatch(canonicalPlaceName(a), canonicalPlaceName(b));
}

const matchKey = canonicalPlaceName;

export type NameTier = 1 | 2 | 3;

/**
 * 1 = exact name, 2 = name starts with the query, 3 = anything else (similar).
 * `names`: the place's own name(s); `queries`: the query (+ its chain alias / name part).
 */
export function nameMatchTier(queries: string[], names: string[]): NameTier {
  const qs = queries.map(matchKey).filter((q) => q.length > 0);
  const ns = names.map(matchKey).filter((n) => n.length > 0);
  if (ns.some((n) => qs.includes(n))) return 1;
  if (ns.some((n) => qs.some((q) => n.startsWith(q)))) return 2;
  return 3;
}

/** Query forms a name may match: the query, its chain alias, and the name part before an area word. */
export function rankQueries(query: string): string[] {
  const q = query.trim();
  const out = [q];
  const alias = chainAliasQuery(q);
  if (alias) out.push(alias);
  const words = q.split(/\s+/);
  if (words.length >= 2) {
    const head = words.slice(0, -1).join(" ");
    out.push(head);
    const headAlias = chainAliasQuery(head);
    if (headAlias) out.push(headAlias);
  }
  return out;
}

function hitNames(hit: OurPlaceHit | KakaoKeywordHit): string[] {
  if (hit.kind === "place") return [hit.name, placeDisplayName(hit)];
  // Kakao names carry the branch: "스타벅스 홍대역점" → also "스타벅스".
  const head = hit.name.split(/\s+/)[0] ?? hit.name;
  return [hit.name, head];
}

/**
 * Our hits + Kakao keyword hits → one list. 도로명주소 rows lead; places are ranked by name
 * tier (exact > prefix > similar), then our 관광·랜드마크·역·지역 rows before shops (same-name
 * shops never outrank the place itself), then distance from `origin`. A Kakao hit that is the
 * same place as one of ours is dropped — ours win.
 */
export function rankMergedHits(
  ours: OurHit[],
  kakao: KakaoKeywordHit[],
  query: string,
  origin: { lat: number; lng: number } | null,
  limit: number = RESULT_LIMIT,
): OurHit[] {
  const addresses = ours.filter((h): h is OurAddressHit => h.kind === "address");
  // "망원로4길 3" with that exact address in the list: it alone, no look-alike names / numbers.
  const exact = exactAddressHits(query, addresses);
  if (exact.length) return exact;
  const places = ours.filter((h): h is OurPlaceHit => h.kind === "place");
  // Same place: matching name within 50m (shops) / 500m (관광·랜드마크·역·지역 — big areas).
  const kakaoOnly = kakao.filter(
    (k) =>
      !places.some(
        (p) =>
          chainAwareNamesMatch(placeDisplayName(p), k.name) &&
          distanceMeters(p.lat, p.lng, k.lat, k.lng) <=
            (p.source === "sangga" ? DEDUPE_RADIUS_M : SAME_PLACE_RADIUS_M),
      ),
  );
  const qs = rankQueries(query);
  const stationQuery = /역$/.test(query.replace(/\s+/g, ""));
  const ranked = [...places, ...kakaoOnly]
    .map((h, i) => {
      const byName = nameMatchTier(qs, hitNames(h));
      // search_map_admin scores exact names (and chain stores like "컴포즈커피홍대 서교점") 300.
      const tier: NameTier = h.kind === "place" && h.score >= EXACT_SCORE_MIN ? 1 : byName;
      return {
        h,
        i,
        tier,
        // "…역" queries: the station first; then our 관광·랜드마크·지역; then shops.
        catalog:
          h.kind === "place" && h.source !== "sangga"
            ? stationQuery && h.source === "station"
              ? 0
              : 1
            : 2,
        d: origin ? distanceMeters(origin.lat, origin.lng, h.lat, h.lng) : (h.kind === "place" ? h.distM ?? Infinity : Infinity),
      };
    })
    .sort((a, b) => a.tier - b.tier || a.catalog - b.catalog || a.d - b.d || a.i - b.i);
  // Same tier: a station named like a 관광·랜드마크 goes right after it unless the query ends in 역.
  if (!stationQuery) {
    for (let i = 0; i < ranked.length; i++) {
      const st = ranked[i]!;
      if (st.h.kind !== "place" || st.h.source !== "station") continue;
      const key = normalizePlaceName(st.h.name).replace(/역$/, "");
      const j = ranked.findIndex(
        (x, k) =>
          k > i &&
          x.tier === st.tier &&
          x.h.kind === "place" &&
          (x.h.source === "tour" || x.h.source === "landmark") &&
          normalizePlaceName(x.h.name) === key,
      );
      if (j < 0) continue;
      ranked.splice(i, 0, ...ranked.splice(j, 1));
      i++;
    }
  }
  return [...addresses, ...ranked.map((x) => x.h)].slice(0, Math.max(limit, addresses.length));
}

type AddressKey = { kind: "road" | "jibun"; name: string; main: string; sub: string | null; mountain: boolean };

const ROAD_KEY_RE = /([가-힣A-Za-z0-9·]+(?:대로|로|길))\s*(\d+)(?:\s*-\s*(\d+))?/g;
const JIBUN_KEY_RE = /([가-힣A-Za-z0-9·]+(?:동|리|가))\s*(산\s*)?(\d+)(?:\s*-\s*(\d+))?/g;

function lastMatch(re: RegExp, text: string): RegExpExecArray | null {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(text))) last = m;
  return last;
}

/**
 * "마포구 망원로4길 3" → road 망원로4길 / 3 (+ the words before it); "망원동 123-4" → jibun.
 * Null unless the query ends in the building / lot number.
 */
export function parseAddressQuery(
  query: string,
): { key: AddressKey; prefix: string[] } | null {
  const q = query.trim().replace(/\s+/g, " ");
  const road = lastMatch(ROAD_KEY_RE, q);
  if (road && road.index + road[0].length === q.length) {
    return {
      key: { kind: "road", name: road[1]!, main: road[2]!, sub: road[3] ?? null, mountain: false },
      prefix: q.slice(0, road.index).split(" ").filter(Boolean),
    };
  }
  const jibun = lastMatch(JIBUN_KEY_RE, q);
  if (jibun && jibun.index + jibun[0].length === q.length) {
    return {
      key: { kind: "jibun", name: jibun[1]!, main: jibun[3]!, sub: jibun[4] ?? null, mountain: Boolean(jibun[2]) },
      prefix: q.slice(0, jibun.index).split(" ").filter(Boolean),
    };
  }
  return null;
}

function addressHasKey(address: string | null, key: AddressKey): boolean {
  if (!address) return false;
  const re = key.kind === "road" ? ROAD_KEY_RE : JIBUN_KEY_RE;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(address))) {
    const name = m[1]!;
    const main = key.kind === "road" ? m[2] : m[3];
    const sub = (key.kind === "road" ? m[3] : m[4]) ?? null;
    const mountain = key.kind === "jibun" && Boolean(m[2]);
    if (name === key.name && main === key.main && sub === key.sub && mountain === key.mountain) return true;
  }
  return false;
}

/** Address hits whose road (or lot) name + number equal the query's; the query's 시·구 words must appear too. */
export function exactAddressHits(query: string, addresses: OurAddressHit[]): OurAddressHit[] {
  const parsed = parseAddressQuery(query);
  if (!parsed) return [];
  const seen = new Set<string>();
  return addresses.filter((a) => {
    const text = parsed.key.kind === "road" ? a.roadAddr : a.jibunAddr;
    if (!addressHasKey(text, parsed.key)) return false;
    const full = `${a.roadAddr} ${a.jibunAddr ?? ""}`;
    if (!parsed.prefix.every((w) => full.includes(w))) return false;
    if (seen.has(a.roadAddr)) return false;
    seen.add(a.roadAddr);
    return true;
  });
}

/** Address rows geocoded at list time so they get a pin too (Kakao address search, live per search). */
export const ADDRESS_PIN_TOP = 2;
/** The final list waits at most this long for those points. */
export const ADDRESS_PIN_TIMEOUT_MS = 1200;

export function addressRowsToGeocode<T extends { y?: string | number; _pindHit?: OurPlaceHit | OurAddressHit }>(
  rows: readonly T[],
  max: number = ADDRESS_PIN_TOP,
): T[] {
  return rows
    .filter((r) => r._pindHit?.kind === "address" && !Number.isFinite(parseFloat(String(r.y ?? ""))))
    .slice(0, max);
}

/**
 * Result pins keyed by the row's own id (not its list position), so a pin always opens the row
 * it was drawn for whatever else the list holds (rows without coordinates get no pin).
 */
export function buildSearchPins<T extends { id?: string | number; y?: string | number; x?: string | number; place_name?: string }, C>(
  rows: readonly T[],
  categoryOf: (row: T) => C,
  labelTop: number = RESULT_PIN_LABEL_TOP,
): { pins: Array<{ id: string; lat: number; lng: number; category: C; label: string | null }>; byId: Map<string, T> } {
  const byId = new Map<string, T>();
  const pins: Array<{ id: string; lat: number; lng: number; category: C; label: string | null }> = [];
  rows.forEach((row, index) => {
    const lat = parseFloat(String(row.y ?? ""));
    const lng = parseFloat(String(row.x ?? ""));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    let id = row.id != null && String(row.id) ? `search:${row.id}` : `search-${index}`;
    if (byId.has(id)) id = `${id}#${index}`;
    byId.set(id, row);
    pins.push({
      id,
      lat,
      lng,
      category: categoryOf(row),
      label: pins.length < labelTop ? String(row.place_name ?? "") : null,
    });
  });
  return { pins, byId };
}

/** search_map_admin: 300 = exact name or same-chain store; prefix matches stay below 240. */
const EXACT_SCORE_MIN = 290;

/** Union of RPC hit lists by id (first occurrence wins). */
export function unionPlaceHits(...lists: OurPlaceHit[][]): OurPlaceHit[] {
  const seen = new Set<string>();
  const out: OurPlaceHit[] = [];
  for (const list of lists) {
    for (const h of list) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h);
    }
  }
  return out;
}

const TOUR_TYPE_BY_CATEGORY: Record<string, string> = {
  관광명소: "12",
  문화시설: "14",
  레포츠: "28",
  시장: "38",
};

const SANGGA_PIN_CATEGORY: Record<string, PoiCategoryId> = {
  cafe: "cafe",
  restaurant: "restaurant",
  fast_food: "fast_food",
  bakery: "bakery",
  bar: "bar",
  pharmacy: "pharmacy",
  hospital: "hospital",
  doctors: "hospital",
  lodging: "lodging",
  grocery: "grocery",
  hairdresser: "beauty",
  fuel: "fuel",
};

/** Kakao category text ("음식점 > 카페 > …") → map POI badge; most specific words first. */
const KAKAO_PIN_CATEGORY: Array<[RegExp, PoiCategoryId]> = [
  [/카페/, "cafe"],
  [/술집|주점|호프|포차|와인바|칵테일/, "bar"],
  [/제과|베이커리|디저트|도넛|아이스크림/, "bakery"],
  [/편의점/, "convenience"],
  [/약국/, "pharmacy"],
  [/병원|의원|치과|한의원/, "hospital"],
  [/은행/, "bank"],
  [/주차장/, "parking"],
  [/주유소|충전소/, "fuel"],
  [/숙박|호텔|모텔|펜션|게스트하우스/, "lodging"],
  [/관광|명소|공원|문화시설|박물관|미술관/, "landmark"],
  [/마트|슈퍼|시장/, "grocery"],
  [/패스트푸드|햄버거|치킨|피자/, "fast_food"],
  [/음식점/, "restaurant"],
  [/미용|헤어|네일/, "beauty"],
];

/** Badge for a result pin: our hit by source / 상가 class, a Kakao row by its category text. */
export function searchRowPoiCategory(row: AdminSearchRow): PoiCategoryId {
  const hit = row._pindHit;
  if (hit?.kind === "place") {
    if (hit.source === "station") return "subway";
    if (hit.source === "tour" || hit.source === "landmark") return "landmark";
    if (hit.source !== "sangga") return "town_hall";
    return SANGGA_PIN_CATEGORY[hit.category ?? ""] ?? "shop";
  }
  const text = row.category_name ?? "";
  return KAKAO_PIN_CATEGORY.find(([re]) => re.test(text))?.[1] ?? "shop";
}

/** Names shown under result pins: only the top few. */
export const RESULT_PIN_LABEL_TOP = 5;

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
