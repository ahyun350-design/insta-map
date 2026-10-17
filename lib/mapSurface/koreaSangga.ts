/**
 * Admin self-tiles overlay: 상가(상권)정보 shop labels
 * from korea-sangga.pmtiles (Supabase map-tiles bucket).
 */

import maplibregl from "maplibre-gl";
import { PMTiles } from "pmtiles";

const PROTOCOL = "pindsangga";
const SOURCE_ID = "korea_sangga";

let registered = false;
let pmtiles: PMTiles | null = null;

export function getKoreaSanggaPublicUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (!base) return "";
  return `${base}/storage/v1/object/public/map-tiles/korea-sangga.pmtiles`;
}

function copyTileBytes(src: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (src instanceof ArrayBuffer) return new Uint8Array(src.slice(0));
  return new Uint8Array(
    src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength),
  );
}

export function ensureKoreaSanggaProtocol(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  maplibregl.addProtocol(
    PROTOCOL,
    async (params: { url: string }, abortController: AbortController) => {
      const m = /^pindsangga:\/\/(\d+)\/(\d+)\/(\d+)(?:\?.*)?$/.exec(params.url);
      if (!m) throw new Error("invalid_pindsangga_url");
      const z = Number(m[1]);
      const x = Number(m[2]);
      const y = Number(m[3]);
      const url = getKoreaSanggaPublicUrl();
      if (!url) throw new Error("missing_sangga_url");
      if (!pmtiles) pmtiles = new PMTiles(url);
      const tile = await pmtiles.getZxy(z, x, y, abortController.signal);
      if (!tile?.data || tile.data.byteLength === 0) {
        return { data: new Uint8Array() };
      }
      return { data: copyTileBytes(tile.data) };
    },
  );
}

/** Attach vector source for sangga shops (idempotent). */
export function ensureKoreaSanggaSource(style: {
  sources?: Record<string, unknown>;
}): void {
  if (!style.sources) style.sources = {};
  if (style.sources[SOURCE_ID]) return;
  const fileUrl = getKoreaSanggaPublicUrl();
  if (!fileUrl) return;
  ensureKoreaSanggaProtocol();
  style.sources[SOURCE_ID] = {
    type: "vector",
    tiles: [`${PROTOCOL}://{z}/{x}/{y}`],
    minzoom: 14,
    maxzoom: 16,
    attribution: "소상공인시장진흥공단",
  };
}

export const KOREA_SANGGA_SOURCE = SOURCE_ID;

export async function warmKoreaSangga(): Promise<boolean> {
  try {
    ensureKoreaSanggaProtocol();
    const url = getKoreaSanggaPublicUrl();
    if (!url) return false;
    if (!pmtiles) pmtiles = new PMTiles(url);
    await pmtiles.getHeader();
    return true;
  } catch {
    return false;
  }
}
