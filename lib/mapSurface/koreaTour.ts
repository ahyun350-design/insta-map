/**
 * Admin self-tiles: TourAPI 명소 from korea-tour.pmtiles (Supabase map-tiles).
 * HTTP cache only — never localStorage/IndexedDB.
 */

import maplibregl from "maplibre-gl";
import { PMTiles } from "pmtiles";
import { resolveKoreaArchiveUrl } from "./tileHostExp";

const PROTOCOL = "pindtour";
const SOURCE_ID = "korea_tour";

let registered = false;
let pmtiles: PMTiles | null = null;

export const KOREA_TOUR_SOURCE = SOURCE_ID;

export function getKoreaTourPublicUrl(): string {
  return resolveKoreaArchiveUrl("tour");
}

function copyTileBytes(src: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (src instanceof ArrayBuffer) return new Uint8Array(src.slice(0));
  return new Uint8Array(
    src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength),
  );
}

export function ensureKoreaTourProtocol(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  maplibregl.addProtocol(
    PROTOCOL,
    async (params: { url: string }, abortController: AbortController) => {
      const m = /^pindtour:\/\/(\d+)\/(\d+)\/(\d+)(?:\?.*)?$/.exec(params.url);
      if (!m) throw new Error("invalid_pindtour_url");
      const z = Number(m[1]);
      const x = Number(m[2]);
      const y = Number(m[3]);
      const url = getKoreaTourPublicUrl();
      if (!url) throw new Error("missing_tour_url");
      if (!pmtiles) pmtiles = new PMTiles(url);
      const tile = await pmtiles.getZxy(z, x, y, abortController.signal);
      if (!tile?.data || tile.data.byteLength === 0) {
        return { data: new Uint8Array() };
      }
      return { data: copyTileBytes(tile.data) };
    },
  );
}

export function ensureKoreaTourSource(style: {
  sources?: Record<string, unknown>;
}): void {
  if (!style.sources) style.sources = {};
  if (style.sources[SOURCE_ID]) return;
  const fileUrl = getKoreaTourPublicUrl();
  if (!fileUrl) return;
  ensureKoreaTourProtocol();
  style.sources[SOURCE_ID] = {
    type: "vector",
    tiles: [`${PROTOCOL}://{z}/{x}/{y}`],
    minzoom: 12,
    maxzoom: 15,
    attribution: "한국관광공사",
  };
}

export async function warmKoreaTour(): Promise<boolean> {
  try {
    ensureKoreaTourProtocol();
    const url = getKoreaTourPublicUrl();
    if (!url) return false;
    if (!pmtiles) pmtiles = new PMTiles(url);
    await pmtiles.getHeader();
    return true;
  } catch {
    return false;
  }
}
