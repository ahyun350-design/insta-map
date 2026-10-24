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
      const url = getKoreaBuildingsPublicUrl();
      if (!url) throw new Error("missing_buildings_url");
      try {
        if (!pmtiles) pmtiles = new PMTiles(url);
        const tile = await pmtiles.getZxy(z, x, y, abortController.signal);
        if (!tile?.data || tile.data.byteLength === 0) {
          return { data: new Uint8Array() };
        }
        return { data: copyTileBytes(tile.data) };
      } catch {
        broken = true;
        return { data: new Uint8Array() };
      }
    },
  );
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
    maxzoom: 16,
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
    if (!pmtiles) pmtiles = new PMTiles(url);
    const h = await pmtiles.getHeader();
    return Number(h?.maxZoom ?? 0) >= 14;
  } catch {
    broken = true;
    pmtiles = null;
    return false;
  }
}

export function isKoreaBuildingsBroken(): boolean {
  return broken;
}
