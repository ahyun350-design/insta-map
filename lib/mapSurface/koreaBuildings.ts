/**
 * Admin self-tiles: Juso building polygons from NCP Korea Object Storage
 * (pindmap-tiles-kr / korea-buildings.pmtiles). Soft-fail if missing.
 * Never persist tile bytes to localStorage/IndexedDB.
 */

import maplibregl from "maplibre-gl";
import { PMTiles } from "pmtiles";

const PROTOCOL = "pindbuildings";
export const KOREA_BUILDINGS_SOURCE = "korea_buildings";
export const KOREA_BUILDINGS_LAYER = "building_kr";
/**
 * Archive / style source maxzoom. MapLibre overzooms past this (reparseOverscaled);
 * protocol must NOT remap child z→parent bytes (that misplaces geometry).
 */
export const KOREA_BUILDINGS_MAXZOOM = 16;

let softFailTracked = false;

function pageOriginMeta(): { origin_domain: string; scheme: string } {
  if (typeof window === "undefined" || !window.location) {
    return { origin_domain: "", scheme: "" };
  }
  try {
    return {
      origin_domain: String(window.location.hostname || "").slice(0, 253),
      scheme: String(window.location.protocol || "")
        .replace(/:$/, "")
        .slice(0, 32),
    };
  } catch {
    return { origin_domain: "", scheme: "" };
  }
}

/** Soft-fail telemetry once — code, source id, origin_domain, optional http status. */
function noteBuildingsSoftFail(
  code: string,
  httpStatus?: number | null,
): void {
  if (softFailTracked) return;
  softFailTracked = true;
  const { origin_domain, scheme } = pageOriginMeta();
  void import("@/lib/track")
    .then(({ track }) => {
      track("tile_source_error", {
        code,
        source: KOREA_BUILDINGS_SOURCE,
        origin_domain,
        scheme,
        ...(typeof httpStatus === "number" && Number.isFinite(httpStatus)
          ? { http_status: Math.round(httpStatus) }
          : {}),
      });
    })
    .catch(() => undefined);
}

/** Public URL on NCP KR Object Storage only (not Supabase / overseas). */
export function getKoreaBuildingsPublicUrl(): string {
  const override = (process.env.NEXT_PUBLIC_KOREA_BUILDINGS_PMTILES_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (override) return override;
  return "https://kr.object.ncloudstorage.com/pindmap-tiles-kr/korea-buildings.pmtiles";
}

let registered = false;
let pmtiles: PMTiles | null = null;
let broken = false;

function copyTileBytes(src: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (src instanceof ArrayBuffer) return new Uint8Array(src.slice(0));
  return new Uint8Array(
    src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength),
  );
}

export function ensureKoreaBuildingsProtocol(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  maplibregl.addProtocol(
    PROTOCOL,
    async (params: { url: string }, abortController: AbortController) => {
      if (broken) return { data: new Uint8Array() };
      const m = /^pindbuildings:\/\/(\d+)\/(\d+)\/(\d+)(?:\?.*)?$/.exec(
        params.url,
      );
      if (!m) throw new Error("invalid_pindbuildings_url");
      const z = Number(m[1]);
      const x = Number(m[2]);
      const y = Number(m[3]);
      // Style source maxzoom=16 → MapLibre should only request z≤16 (overzoom).
      // Never serve parent tile bytes under a child z/x/y (geometry would shift/scale).
      if (
        !Number.isFinite(z) ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        z < 0
      ) {
        return { data: new Uint8Array() };
      }
      const url = getKoreaBuildingsPublicUrl();
      if (!url) throw new Error("missing_buildings_url");
      try {
        if (!pmtiles) pmtiles = new PMTiles(url);
        const tile = await pmtiles.getZxy(z, x, y, abortController.signal);
        if (!tile?.data || tile.data.byteLength === 0) {
          return { data: new Uint8Array() };
        }
        return { data: copyTileBytes(tile.data) };
      } catch (err) {
        const status = extractHttpStatus(err);
        noteBuildingsSoftFail("tile_source_error", status);
        broken = true;
        return { data: new Uint8Array() };
      }
    },
  );
}

function extractHttpStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    cause?: { status?: unknown };
  };
  for (const v of [e.status, e.statusCode, e.response?.status, e.cause?.status]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

export function ensureKoreaBuildingsSource(style: {
  sources?: Record<string, unknown>;
}): void {
  if (!style.sources) style.sources = {};
  if (style.sources[KOREA_BUILDINGS_SOURCE]) return;
  const fileUrl = getKoreaBuildingsPublicUrl();
  if (!fileUrl) return;
  ensureKoreaBuildingsProtocol();
  style.sources[KOREA_BUILDINGS_SOURCE] = {
    type: "vector",
    tiles: [`${PROTOCOL}://{z}/{x}/{y}`],
    minzoom: 14,
    // Inline TileJSON fields — VectorTileSource.loadTileJson picks maxzoom so
    // MapLibre overzooms rather than requesting missing z17+ leaves.
    maxzoom: KOREA_BUILDINGS_MAXZOOM,
    attribution: "행정안전부",
  };
}

/** Soft-fail warm — map continues without buildings if archive missing. */
export async function warmKoreaBuildings(): Promise<boolean> {
  if (broken) return false;
  try {
    ensureKoreaBuildingsProtocol();
    const url = getKoreaBuildingsPublicUrl();
    if (!url) return false;
    // Probe Range first so CORS/HTTP failures yield a status for telemetry.
    try {
      const probe = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-15" },
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
      });
      if (!probe.ok && probe.status !== 206) {
        noteBuildingsSoftFail("tile_source_error", probe.status);
        broken = true;
        return false;
      }
    } catch (err) {
      noteBuildingsSoftFail("tile_source_error", extractHttpStatus(err));
      broken = true;
      return false;
    }
    if (!pmtiles) pmtiles = new PMTiles(url);
    const h = await pmtiles.getHeader();
    return Number(h?.maxZoom ?? 0) >= 14;
  } catch (err) {
    noteBuildingsSoftFail("tile_source_error", extractHttpStatus(err));
    broken = true;
    pmtiles = null;
    return false;
  }
}

export function isKoreaBuildingsBroken(): boolean {
  return broken;
}
