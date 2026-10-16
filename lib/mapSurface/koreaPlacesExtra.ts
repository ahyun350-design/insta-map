/**
 * Admin self-tiles overlay: apartment complex + named building labels
 * from korea-places-extra.pmtiles (Supabase map-tiles bucket).
 */

import maplibregl from "maplibre-gl";
import { PMTiles } from "pmtiles";

const PROTOCOL = "pindplaces";
const SOURCE_ID = "korea_places_extra";

let registered = false;
let pmtiles: PMTiles | null = null;

export function getKoreaPlacesExtraPublicUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (!base) return "";
  return `${base}/storage/v1/object/public/map-tiles/korea-places-extra.pmtiles`;
}

function copyTileBytes(src: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (src instanceof ArrayBuffer) return new Uint8Array(src.slice(0));
  return new Uint8Array(
    src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength),
  );
}

export function ensureKoreaPlacesExtraProtocol(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  maplibregl.addProtocol(
    PROTOCOL,
    async (params: { url: string }, abortController: AbortController) => {
      const m = /^pindplaces:\/\/(\d+)\/(\d+)\/(\d+)(?:\?.*)?$/.exec(params.url);
      if (!m) throw new Error("invalid_pindplaces_url");
      const z = Number(m[1]);
      const x = Number(m[2]);
      const y = Number(m[3]);
      const url = getKoreaPlacesExtraPublicUrl();
      if (!url) throw new Error("missing_places_extra_url");
      if (!pmtiles) pmtiles = new PMTiles(url);
      const tile = await pmtiles.getZxy(z, x, y, abortController.signal);
      if (!tile?.data || tile.data.byteLength === 0) {
        return { data: new Uint8Array() };
      }
      return { data: copyTileBytes(tile.data) };
    },
  );
}

/** Attach vector source for places-extra (idempotent). */
export function ensureKoreaPlacesExtraSource(style: {
  sources?: Record<string, unknown>;
}): void {
  if (!style.sources) style.sources = {};
  if (style.sources[SOURCE_ID]) return;
  const fileUrl = getKoreaPlacesExtraPublicUrl();
  if (!fileUrl) return;
  ensureKoreaPlacesExtraProtocol();
  style.sources[SOURCE_ID] = {
    type: "vector",
    tiles: [`${PROTOCOL}://{z}/{x}/{y}`],
    minzoom: 12,
    maxzoom: 16,
    attribution: "© OpenStreetMap contributors",
  };
}

export const KOREA_PLACES_EXTRA_SOURCE = SOURCE_ID;

/** Soft-fail if archive missing — MapLibre will show empty layers. */
export async function warmKoreaPlacesExtra(): Promise<boolean> {
  try {
    ensureKoreaPlacesExtraProtocol();
    const url = getKoreaPlacesExtraPublicUrl();
    if (!url) return false;
    if (!pmtiles) pmtiles = new PMTiles(url);
    await pmtiles.getHeader();
    return true;
  } catch {
    return false;
  }
}
