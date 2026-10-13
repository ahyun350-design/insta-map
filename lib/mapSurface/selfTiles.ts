/**
 * Admin-only Korea self-hosted PMTiles (Supabase Storage public object).
 * Stores only an on/off flag in localStorage — never tile URLs or tile bytes.
 * Outside the Korea archive, tiles fall back to OpenFreeMap planet.
 */

import maplibregl from "maplibre-gl";
import { PMTiles } from "pmtiles";

/** Boolean flag only — not a tile URL or tile payload. */
export const SELF_TILES_STORAGE_KEY = "pindmap_admin_self_tiles";

const OFM_PLANET_TILE =
  "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf";

/** South Korea extract maxzoom from Planetiler build. */
export const KOREA_PMTILES_MAXZOOM = 14;

const PROTOCOL_NAME = "pindself";

let protocolRegistered = false;
let pmtiles: PMTiles | null = null;
let selfTilesBroken = false;
let selfTilesErrorTracked = false;

/** map-preview / e2e session override (null = use localStorage flag). */
let sessionOverride: boolean | null = null;

export function setSessionSelfTilesOverride(enabled: boolean | null): void {
  sessionOverride = enabled;
}

export function readSelfTilesEnabled(): boolean {
  if (sessionOverride != null) return sessionOverride;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SELF_TILES_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSelfTilesEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(SELF_TILES_STORAGE_KEY, "1");
    else window.localStorage.removeItem(SELF_TILES_STORAGE_KEY);
  } catch {
    /* ignore quota */
  }
}

/** Public HTTPS URL for korea-latest.pmtiles (derived at runtime, never persisted). */
export function getKoreaPmtilesPublicUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (!base) return "";
  return `${base}/storage/v1/object/public/map-tiles/korea-latest.pmtiles`;
}

function trackSelfTilesErrorOnce(): void {
  if (selfTilesErrorTracked) return;
  selfTilesErrorTracked = true;
  // Dynamic import — avoid pulling supabase into validate:map-style / SSR graphs.
  void import("@/lib/track")
    .then(({ track }) => {
      track("map_gl_fallback", {
        surface: "expanded",
        reason: "self_tiles_error",
      });
    })
    .catch(() => {
      /* ignore */
    });
}

function markBroken(): void {
  if (selfTilesBroken) return;
  selfTilesBroken = true;
  trackSelfTilesErrorOnce();
}

async function fetchOfmTile(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const url = OFM_PLANET_TILE.replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`ofm_tile_${res.status}`);
  return res.arrayBuffer();
}

/**
 * Register pindself://{z}/{x}/{y} — Korea PMTiles first, OFM planet fallback.
 * Safe to call multiple times.
 */
export function ensureSelfTilesProtocolRegistered(): void {
  if (protocolRegistered || typeof window === "undefined") return;
  protocolRegistered = true;

  maplibregl.addProtocol(
    PROTOCOL_NAME,
    async (params: { url: string }, abortController: AbortController) => {
      const m = /^pindself:\/\/(\d+)\/(\d+)\/(\d+)(?:\?.*)?$/.exec(params.url);
      if (!m) throw new Error("invalid_pindself_url");
      const z = Number(m[1]);
      const x = Number(m[2]);
      const y = Number(m[3]);
      const signal = abortController.signal;

      if (!selfTilesBroken) {
        try {
          const fileUrl = getKoreaPmtilesPublicUrl();
          if (!fileUrl) throw new Error("missing_supabase_url");
          if (!pmtiles) pmtiles = new PMTiles(fileUrl);
          const tile = await pmtiles.getZxy(z, x, y, signal);
          if (tile?.data) {
            return { data: tile.data.slice(0) };
          }
          // Missing in archive (outside Korea / empty) → OFM
        } catch {
          markBroken();
        }
      }

      const data = await fetchOfmTile(z, x, y, signal);
      return { data };
    },
  );
}

/** Point openmaptiles vector source at self protocol; keep glyphs/sprite on OFM. */
export function applySelfTilesSource(style: {
  sources?: Record<string, unknown>;
}): void {
  const sources = style.sources;
  if (!sources || typeof sources.openmaptiles !== "object" || !sources.openmaptiles) {
    return;
  }
  const prev = sources.openmaptiles as Record<string, unknown>;
  const attribution =
    typeof prev.attribution === "string"
      ? prev.attribution
      : "© OpenStreetMap contributors";
  sources.openmaptiles = {
    type: "vector",
    tiles: [`${PROTOCOL_NAME}://{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: KOREA_PMTILES_MAXZOOM,
    attribution,
  };
}

/** Probe PMTiles header once; on hard failure mark broken (OFM-only thereafter). */
export async function warmSelfTilesOrBreak(): Promise<boolean> {
  if (selfTilesBroken) return false;
  try {
    const fileUrl = getKoreaPmtilesPublicUrl();
    if (!fileUrl) {
      markBroken();
      return false;
    }
    if (!pmtiles) pmtiles = new PMTiles(fileUrl);
    await pmtiles.getHeader();
    return true;
  } catch {
    markBroken();
    return false;
  }
}

export function isSelfTilesBroken(): boolean {
  return selfTilesBroken;
}

/** Test helper */
export function resetSelfTilesForTests(): void {
  selfTilesBroken = false;
  selfTilesErrorTracked = false;
  pmtiles = null;
  sessionOverride = null;
}
