/**
 * Map place card matching rules (server + tests). Pure functions only.
 *
 * Name equality: lower-case, spaces / brackets / punctuation removed, trailing
 * branch suffix (점·본점·지점) ignored; two names match when equal or one
 * contains the other (≥3 chars).
 */

export function normalizePlaceName(raw: string | null | undefined): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[\s()[\]{}（）·.,'"\-_/]/g, "")
    .replace(/(본점|지점|점)$/u, "");
}

export function placeNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizePlaceName(a);
  const y = normalizePlaceName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < 3 || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function bigramDice(a: string, b: string): number {
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let k = 0; k + 1 < s.length; k++) {
      const g = s.slice(k, k + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  const total = Math.max(0, a.length - 1) + Math.max(0, b.length - 1);
  return total ? (2 * overlap) / total : 0;
}

/**
 * Same shop spelled slightly differently (one-character variant, or bigram
 * Dice ≥ 0.6) — only used together with a tight distance gate.
 */
export function placeNamesClose(a: string | null | undefined, b: string | null | undefined): boolean {
  if (placeNamesMatch(a, b)) return true;
  const x = normalizePlaceName(a);
  const y = normalizePlaceName(b);
  if (Math.min(x.length, y.length) < 4) return false;
  return editDistanceAtMost1(x, y) || bigramDice(x, y) >= 0.6;
}

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type SanggaNearRow = {
  bizes_id: string;
  name: string;
  branch: string | null;
  ind_m_name: string | null;
  ind_s_name: string | null;
  poi_class: string | null;
  road_address: string | null;
  floor: string | null;
  dist_m: number;
};

/** Tile names are 상호명 (+ 지점명); pick the nearest row whose name matches. */
export function pickSanggaRow(
  tapName: string,
  rows: SanggaNearRow[],
  maxDistM: number,
): SanggaNearRow | null {
  let best: SanggaNearRow | null = null;
  for (const r of rows) {
    if (!(r.dist_m <= maxDistM)) continue;
    const full = r.branch ? `${r.name} ${r.branch}` : r.name;
    if (!placeNamesMatch(tapName, full) && !placeNamesMatch(tapName, r.name)) continue;
    if (!best || r.dist_m < best.dist_m) best = r;
  }
  return best;
}

export type KakaoDocLite = {
  id: string;
  place_name: string;
  phone?: string;
  place_url?: string;
  category_name?: string;
  distance?: string;
  x: string;
  y: string;
};

/** Close-spelling hits must sit this near the tapped point. */
export const KAKAO_CLOSE_NAME_MAX_M = 30;

/**
 * Kakao keyword hit adopted when the name matches within maxDistM, or the name
 * is a near spelling within KAKAO_CLOSE_NAME_MAX_M.
 */
export function pickKakaoDoc(
  tapName: string,
  lat: number,
  lng: number,
  docs: KakaoDocLite[],
  maxDistM = 100,
): KakaoDocLite | null {
  let close: KakaoDocLite | null = null;
  for (const d of docs) {
    const dy = Number(d.y);
    const dx = Number(d.x);
    if (!Number.isFinite(dy) || !Number.isFinite(dx)) continue;
    const m = distanceMeters(lat, lng, dy, dx);
    if (m > maxDistM) continue;
    if (placeNamesMatch(tapName, d.place_name)) return d;
    if (!close && m <= KAKAO_CLOSE_NAME_MAX_M && placeNamesClose(tapName, d.place_name)) close = d;
  }
  return close;
}

export type SavedPlaceLite = {
  user_id: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
};

/** Distinct users who saved a same-name place within maxDistM. */
export function countSavedUsers(
  tapName: string,
  lat: number,
  lng: number,
  rows: SavedPlaceLite[],
  maxDistM = 100,
): number {
  const users = new Set<string>();
  for (const r of rows) {
    if (!r.user_id || r.lat == null || r.lng == null) continue;
    if (distanceMeters(lat, lng, r.lat, r.lng) > maxDistM) continue;
    if (placeNamesMatch(tapName, r.name)) users.add(r.user_id);
  }
  return users.size;
}
