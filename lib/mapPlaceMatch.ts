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

/** Kakao keyword hit adopted only when the name matches and it is ≤ maxDistM away. */
export function pickKakaoDoc(
  tapName: string,
  lat: number,
  lng: number,
  docs: KakaoDocLite[],
  maxDistM = 100,
): KakaoDocLite | null {
  for (const d of docs) {
    const dy = Number(d.y);
    const dx = Number(d.x);
    if (!Number.isFinite(dy) || !Number.isFinite(dx)) continue;
    if (distanceMeters(lat, lng, dy, dx) > maxDistM) continue;
    if (placeNamesMatch(tapName, d.place_name)) return d;
  }
  return null;
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
