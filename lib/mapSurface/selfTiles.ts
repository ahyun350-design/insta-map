/**
 * Admin-only Korea self-hosted PMTiles (Supabase Storage public object).
 * Stores only an on/off flag in localStorage — never tile URLs or tile bytes.
 * Outside the Korea archive, tiles fall back to OpenFreeMap planet.
 * Glyphs/sprite/style asset paths are also never persisted (HTTP cache only).
 */

import maplibregl from "maplibre-gl";
import { PMTiles } from "pmtiles";

function lngLatToTile(
  lng: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  const max = n - 1;
  return {
    x: Math.max(0, Math.min(max, x)),
    y: Math.max(0, Math.min(max, y)),
  };
}

/** Boolean flag only — not a tile URL or tile payload. */
export const SELF_TILES_STORAGE_KEY = "pindmap_admin_self_tiles";

/** Same-origin glyph template (Latin/symbol ranges; Hangul via localIdeograph). */
export const SELF_GLYPHS_URL = "/map/glyphs/{fontstack}/{range}.pbf";

const OFM_PLANET_TILE =
  "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf";

/** South Korea extract maxzoom from Planetiler build. */
export const KOREA_PMTILES_MAXZOOM = 14;

const PROTOCOL_NAME = "pindself";
const PREFETCH_ZOOM = 14;

let protocolRegistered = false;
let pmtiles: PMTiles | null = null;
let selfTilesBroken = false;
let selfTilesErrorTracked = false;
let warmPromise: Promise<boolean> | null = null;

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

function getOrCreatePmtiles(): PMTiles {
  if (!pmtiles) {
    const fileUrl = getKoreaPmtilesPublicUrl();
    if (!fileUrl) throw new Error("missing_supabase_url");
    pmtiles = new PMTiles(fileUrl);
  }
  return pmtiles;
}

/** Shared PMTiles instance (null until first warm/get). */
export function getSharedPmtiles(): PMTiles | null {
  return pmtiles;
}

/**
 * Register pindself://{z}/{x}/{y} — Korea PMTiles first, OFM planet fallback.
 * Safe to call multiple times. Reuses one PMTiles instance across remounts.
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
          const tile = await getOrCreatePmtiles().getZxy(z, x, y, signal);
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

/** Point openmaptiles vector source at self protocol. */
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

/**
 * Self-tiles only: same-origin glyphs; drop OFM sprite (icons are addImage / unused).
 * Does not persist paths anywhere.
 */
export function applySelfHostedStyleAssets(style: {
  glyphs?: string;
  sprite?: string;
}): void {
  style.glyphs = SELF_GLYPHS_URL;
  delete style.sprite;
}

/**
 * Probe PMTiles header + root directory once; reuse instance.
 * On hard failure mark broken (OFM-only thereafter).
 */
export async function warmSelfTilesOrBreak(): Promise<boolean> {
  if (selfTilesBroken) return false;
  if (warmPromise) return warmPromise;
  warmPromise = (async () => {
    try {
      const p = getOrCreatePmtiles();
      await p.getHeader();
      // Load root directory into PMTiles cache (tile may be empty outside Korea).
      await p.getZxy(0, 0, 0);
      return true;
    } catch {
      markBroken();
      return false;
    }
  })();
  return warmPromise;
}

/**
 * Prefetch z14 center + 8 neighbors via shared PMTiles (HTTP Range cache only).
 */
export async function prefetchSelfTilesZ14Around(
  lat: number,
  lng: number,
): Promise<{ requested: number }> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { requested: 0 };
  }
  ensureSelfTilesProtocolRegistered();
  const ok = await warmSelfTilesOrBreak();
  if (!ok || selfTilesBroken) return { requested: 0 };
  try {
    const p = getOrCreatePmtiles();
    const { x: cx, y: cy } = lngLatToTile(lng, lat, PREFETCH_ZOOM);
    const max = 2 ** PREFETCH_ZOOM - 1;
    const jobs: Promise<unknown>[] = [];
    // 5×5 around center (covers phone viewport at z15–16 overzoom better than 3×3).
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x > max || y > max) continue;
        jobs.push(p.getZxy(PREFETCH_ZOOM, x, y).catch(() => null));
      }
    }
    await Promise.all(jobs);
    return { requested: jobs.length };
  } catch {
    return { requested: 0 };
  }
}

/** Warm common Latin glyph ranges from same-origin (HTTP cache only). */
export function prefetchSelfGlyphs(): void {
  if (typeof window === "undefined") return;
  const stacks = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"];
  const ranges = ["0-255", "256-511", "8448-8703"];
  for (const stack of stacks) {
    for (const range of ranges) {
      if (stack !== "Noto Sans Regular" && range !== "0-255") continue;
      const url = SELF_GLYPHS_URL.replace("{fontstack}", encodeURIComponent(stack)).replace(
        "{range}",
        range,
      );
      void fetch(url, { mode: "same-origin", credentials: "omit", cache: "force-cache" }).catch(
        () => {},
      );
    }
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
  warmPromise = null;
  sessionOverride = null;
}
