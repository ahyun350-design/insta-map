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

/** TileJSON — versioned `tiles[]` template changes over time; never hardcode a stale path. */
const OFM_PLANET_TILEJSON = "https://tiles.openfreemap.org/planet";
/**
 * Bare `/planet/{z}/{x}/{y}.pbf` returns HTTP 200 with **0 bytes** on current OFM CDN.
 * Never cache it as the live template — grey/blank maps after soft-fail.
 */
const OFM_TILEJSON_RETRIES = 3;
const OFM_TILEJSON_RETRY_MS = 400;

let ofmTileTemplate: string | null = null;
let ofmTileTemplatePromise: Promise<string> | null = null;

/** Transient PMTiles Range errors before session soft-fail (aborts never count). */
const SELF_TILE_HARD_FAIL_THRESHOLD = 3;
let selfTileHardFailCount = 0;

async function fetchOfmTileJsonTemplateOnce(): Promise<string> {
  const res = await fetch(OFM_PLANET_TILEJSON, {
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ofm_tilejson_${res.status}`);
  const tj = (await res.json()) as { tiles?: string[] };
  const t = tj.tiles?.[0];
  if (typeof t !== "string" || !t.includes("{z}")) {
    throw new Error("ofm_tilejson_missing_tiles");
  }
  // Reject bare `/planet/{z}/…` (200 + 0 bytes on current OFM CDN).
  if (/openfreemap\.org\/planet\/\{z\}\//.test(t)) {
    throw new Error("ofm_tilejson_unversioned_empty_path");
  }
  return t;
}

async function resolveOfmTileTemplate(): Promise<string> {
  if (ofmTileTemplate) return ofmTileTemplate;
  if (!ofmTileTemplatePromise) {
    ofmTileTemplatePromise = (async () => {
      let lastErr: unknown;
      for (let i = 0; i < OFM_TILEJSON_RETRIES; i++) {
        try {
          const t = await fetchOfmTileJsonTemplateOnce();
          ofmTileTemplate = t;
          return t;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, OFM_TILEJSON_RETRY_MS * (i + 1)));
        }
      }
      ofmTileTemplatePromise = null;
      throw lastErr instanceof Error
        ? lastErr
        : new Error("ofm_tilejson_unreachable");
    })();
  }
  return ofmTileTemplatePromise;
}

/** Force re-resolve TileJSON (e.g. after empty tile response). */
function invalidateOfmTileTemplate(): void {
  ofmTileTemplate = null;
  ofmTileTemplatePromise = null;
}

/**
 * Live Korea PMTiles header bounds (null until warm). Compared empirically to
 * Geofabrik SK extract — Gangwon is inside (~38.65N maxLat).
 */
export type KoreaPmtilesHeaderBounds = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  minZoom: number;
  maxZoom: number;
};

let cachedHeaderBounds: KoreaPmtilesHeaderBounds | null = null;

export function getKoreaPmtilesHeaderBounds(): KoreaPmtilesHeaderBounds | null {
  return cachedHeaderBounds;
}

/**
 * South Korea extract maxzoom from Planetiler build.
 * Must match PMTiles header maxZoom (live archive = 14) so MapLibre overzooms
 * z15+ from z14 parents instead of requesting missing z15 leaf tiles.
 */
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

/**
 * Admin default: OFF when unset. Explicit "1" turns on (toggle sticky).
 * Preview/e2e can still override via setSessionSelfTilesOverride.
 */
export function readSelfTilesEnabled(): boolean {
  if (sessionOverride != null) return sessionOverride;
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(SELF_TILES_STORAGE_KEY);
    if (v === null) return false;
    return v === "1";
  } catch {
    return false;
  }
}

export function writeSelfTilesEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    // Always persist so OFF ("0") sticks across reloads.
    window.localStorage.setItem(SELF_TILES_STORAGE_KEY, enabled ? "1" : "0");
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

function isAbortError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === "object") {
    const name = String((err as { name?: string }).name || "");
    if (name === "AbortError") return true;
  }
  return /abort/i.test(String((err as { message?: string })?.message ?? err));
}

function trackSelfTilesErrorOnce(surface: "compact" | "expanded" = "expanded"): void {
  if (selfTilesErrorTracked) return;
  selfTilesErrorTracked = true;
  // Use track() directly — must not consume trackMapGlFallback session-once
  // (Kakao fallback still needs to be attributable if OFM also fails).
  void import("@/lib/track")
    .then(({ track }) => {
      track("map_gl_fallback", {
        surface,
        reason: "self_tiles_error",
      });
    })
    .catch(() => {
      /* ignore */
    });
}

function markBroken(surface: "compact" | "expanded" = "expanded"): void {
  if (selfTilesBroken) return;
  selfTilesBroken = true;
  trackSelfTilesErrorOnce(surface);
}

/**
 * Session soft-fail: stop reading PMTiles; protocol serves OFM thereafter.
 * Does not destroy MapLibre / does not switch to Kakao.
 */
export function breakSelfTilesToOfmSession(
  surface: "compact" | "expanded" = "expanded",
): void {
  markBroken(surface);
}

/** Point a live MapLibre map's openmaptiles source at OFM planet (keep MapLibre). */
export async function applyOfmPlanetTilesToMap(map: {
  getSource: (id: string) => unknown;
}): Promise<void> {
  const template = await resolveOfmTileTemplate();
  const src = map.getSource("openmaptiles") as {
    setTiles?: (tiles: string[]) => void;
  } | null;
  if (src && typeof src.setTiles === "function") {
    src.setTiles([template]);
  }
}

async function fetchOfmTile(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const template = await resolveOfmTileTemplate();
    const url = template
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) throw new Error(`ofm_tile_${res.status}`);
    const buf = await res.arrayBuffer();
    // Hardcoded/unversioned OFM path returns 200 with 0 bytes → blank grey map.
    if (buf.byteLength > 0) return buf;
    invalidateOfmTileTemplate();
  }
  throw new Error("ofm_tile_empty");
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
          if (tile?.data && tile.data.byteLength > 0) {
            selfTileHardFailCount = 0;
            // Detached Uint8Array — matches pmtiles.Protocol; avoids shared-buffer
            // reuse and matches what MapLibre's worker transfer path expects.
            return { data: copyTileBytes(tile.data) };
          }
          // Missing in archive (outside Korea / empty) → OFM (not a hard failure)
        } catch (err) {
          // Camera moves abort in-flight Range reads — must not kill self-tiles for the session.
          if (isAbortError(err) || signal.aborted) {
            throw err;
          }
          selfTileHardFailCount += 1;
          if (selfTileHardFailCount >= SELF_TILE_HARD_FAIL_THRESHOLD) {
            markBroken();
          }
          // Transient: still try OFM for this tile without ending the session yet.
        }
      }

      const data = await fetchOfmTile(z, x, y, signal);
      return { data: copyTileBytes(data) };
    },
  );
}

/** Fresh Uint8Array so callers never share PMTiles' reusable memory. */
function copyTileBytes(src: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (src instanceof ArrayBuffer) {
    return new Uint8Array(src.slice(0));
  }
  return new Uint8Array(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength));
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
  const headerMax =
    cachedHeaderBounds?.maxZoom != null &&
    Number.isFinite(cachedHeaderBounds.maxZoom)
      ? cachedHeaderBounds.maxZoom
      : KOREA_PMTILES_MAXZOOM;
  sources.openmaptiles = {
    type: "vector",
    tiles: [`${PROTOCOL_NAME}://{z}/{x}/{y}`],
    minzoom: cachedHeaderBounds?.minZoom ?? 0,
    // Cap at archive max so MapLibre overzooms rather than requesting missing leaves.
    maxzoom: Math.min(headerMax, KOREA_PMTILES_MAXZOOM),
    attribution,
  };
}

/**
 * Self-tiles style assets.
 *
 * Keep Liberty/OFM **glyphs** and **sprite**:
 * - Sprite: fill patterns (`wetland_bg_11`, `pedestrian_polygon`, …) must resolve
 *   or MapLibre leaves tiles loaded with zero buckets.
 * - Glyphs: our `/map/glyphs` set is incomplete (e.g. 8192–8447 punctuation).
 *   A glyph 404 surfaces as AJAXError status 404; VectorTileSource treats any
 *   404 as an empty tile → deps set, buckets 0, blank basemap. Hangul still
 *   uses localIdeographFontFamily; Latin/punct come from OFM until we ship a
 *   full glyph pack.
 *
 * Does not persist paths anywhere.
 */
export function applySelfHostedStyleAssets(_style: {
  glyphs?: string;
  sprite?: string;
}): void {
  // Intentionally no-op: keep OFM glyphs + sprite from Liberty.
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
      const header = await p.getHeader();
      cachedHeaderBounds = {
        minLon: header.minLon,
        minLat: header.minLat,
        maxLon: header.maxLon,
        maxLat: header.maxLat,
        minZoom: header.minZoom,
        maxZoom: header.maxZoom,
      };
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
    // 7×7 around center — mangwon z16 first paint was cold outside the old 5×5.
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x > max || y > max) continue;
        jobs.push(p.getZxy(PREFETCH_ZOOM, x, y).catch(() => null));
      }
    }
    // Also warm one zoom coarser (z13) for faster overzoom parent tiles.
    const z13 = 13;
    const { x: cx13, y: cy13 } = lngLatToTile(lng, lat, z13);
    const max13 = 2 ** z13 - 1;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const x = cx13 + dx;
        const y = cy13 + dy;
        if (x < 0 || y < 0 || x > max13 || y > max13) continue;
        jobs.push(p.getZxy(z13, x, y).catch(() => null));
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
  selfTileHardFailCount = 0;
  pmtiles = null;
  warmPromise = null;
  ofmTileTemplate = null;
  ofmTileTemplatePromise = null;
  cachedHeaderBounds = null;
  sessionOverride = null;
}
