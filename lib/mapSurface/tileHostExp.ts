/**
 * Admin / map-preview experiment: swap Korea tile host Supabase → NCP Seoul.
 * Default remains Supabase. Never enable for general users (rollout untouched).
 *
 * Activation (session):
 * - URL `?tileHost=ncp` (map-preview / e2e)
 * - or localStorage `pindmap_admin_tile_host=ncp` (admin QA)
 * Clear with `?tileHost=default` or storage `default`.
 */

export const TILE_HOST_STORAGE_KEY = "pindmap_admin_tile_host";

export type TileHostId = "default" | "ncp";

/** NCP KR bucket prefix for experiment copies (public-read). */
export const NCP_TILES_EXP_BASE =
  "https://kr.object.ncloudstorage.com/pindmap-tiles-kr/exp";

/** Filenames under exp/ (and Supabase map-tiles). */
export const TILE_HOST_EXP_FILES = {
  korea: "korea-latest.pmtiles",
  sangga: "korea-sangga.pmtiles",
  tour: "korea-tour.pmtiles",
  placesExtra: "korea-places-extra.pmtiles",
} as const;

let sessionOverride: TileHostId | null = null;

export function setTileHostSessionOverride(host: TileHostId | null): void {
  sessionOverride = host;
}

export function readTileHost(): TileHostId {
  if (sessionOverride === "ncp" || sessionOverride === "default") {
    return sessionOverride;
  }
  if (typeof window === "undefined") return "default";
  try {
    const q = new URLSearchParams(window.location.search).get("tileHost");
    if (q === "ncp") return "ncp";
    if (q === "default" || q === "supabase") return "default";
  } catch {
    /* ignore */
  }
  try {
    const v = window.localStorage.getItem(TILE_HOST_STORAGE_KEY);
    if (v === "ncp") return "ncp";
  } catch {
    /* ignore */
  }
  return "default";
}

export function writeTileHostPreference(host: TileHostId): void {
  if (typeof window === "undefined") return;
  try {
    if (host === "default") {
      window.localStorage.removeItem(TILE_HOST_STORAGE_KEY);
    } else {
      window.localStorage.setItem(TILE_HOST_STORAGE_KEY, host);
    }
  } catch {
    /* ignore */
  }
}

export function isNcpTileHost(): boolean {
  return readTileHost() === "ncp";
}

/** PMTiles public URL for a known archive; empty string if unavailable. */
export function resolveKoreaArchiveUrl(
  kind: keyof typeof TILE_HOST_EXP_FILES,
): string {
  const file = TILE_HOST_EXP_FILES[kind];
  if (isNcpTileHost()) {
    return `${NCP_TILES_EXP_BASE}/${file}`;
  }
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (!base) return "";
  return `${base}/storage/v1/object/public/map-tiles/${file}`;
}

/**
 * Glyphs template when experimenting with NCP.
 * Pack must exist under exp/glyphs/; otherwise callers keep Railway same-origin.
 */
export function ncpGlyphsUrlTemplate(): string {
  return `${NCP_TILES_EXP_BASE}/glyphs/{fontstack}/{range}.pbf`;
}
