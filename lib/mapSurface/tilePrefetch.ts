/**
 * Warm OpenFreeMap / OpenMapTiles z14 HTTP cache (browser only).
 * Never writes tile URLs or bytes to localStorage / IndexedDB.
 */

import { fetchLibertyStyle } from "@/lib/pindmapMapStyle";

const PREFETCH_ZOOM = 14;
const MAX_CONCURRENT = 6;

let tileTemplate: string | null = null;
let templatePromise: Promise<string | null> | null = null;

const warmed = new Set<string>();
const inFlight = new Set<string>();
let active = 0;
const queue: Array<() => void> = [];

function pumpQueue(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift();
    if (next) next();
  }
}

function enqueueFetch(url: string): Promise<void> {
  if (warmed.has(url) || inFlight.has(url)) return Promise.resolve();
  inFlight.add(url);
  return new Promise<void>((resolve) => {
    const run = () => {
      active += 1;
      void fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" })
        .then(() => {
          warmed.add(url);
        })
        .catch(() => {
          /* ignore — never block UI */
        })
        .finally(() => {
          inFlight.delete(url);
          active -= 1;
          resolve();
          pumpQueue();
        });
    };
    if (active < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

async function resolveTileTemplate(): Promise<string | null> {
  if (tileTemplate) return tileTemplate;
  if (templatePromise) return templatePromise;
  templatePromise = (async () => {
    try {
      const style = await fetchLibertyStyle();
      const src = (style.sources as Record<string, { url?: string; tiles?: string[] }> | undefined)
        ?.openmaptiles;
      if (!src) return null;
      if (Array.isArray(src.tiles) && typeof src.tiles[0] === "string") {
        tileTemplate = src.tiles[0];
        return tileTemplate;
      }
      if (typeof src.url === "string") {
        const res = await fetch(src.url, { mode: "cors", credentials: "omit" });
        if (!res.ok) return null;
        const tj = (await res.json()) as { tiles?: string[] };
        const t = tj.tiles?.[0];
        if (typeof t === "string") {
          tileTemplate = t;
          return tileTemplate;
        }
      }
      return null;
    } catch {
      return null;
    }
  })();
  return templatePromise;
}

/** WebMercator tile x/y at integer zoom. */
export function lngLatToTile(
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

function tileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/** Prefetch z14 center + 8 neighbors (3×3). Deduped; ≤6 concurrent. */
export async function prefetchZ14Around(
  lat: number,
  lng: number,
): Promise<{ requested: number; template: string | null }> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { requested: 0, template: null };
  }
  const template = await resolveTileTemplate();
  if (!template) return { requested: 0, template: null };
  const { x: cx, y: cy } = lngLatToTile(lng, lat, PREFETCH_ZOOM);
  const max = 2 ** PREFETCH_ZOOM - 1;
  const urls: string[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x > max || y > max) continue;
      urls.push(tileUrl(template, PREFETCH_ZOOM, x, y));
    }
  }
  await Promise.all(urls.map((u) => enqueueFetch(u)));
  return { requested: urls.length, template };
}

/** Top search hits — warm z14 around each (HTTP cache only). */
export function prefetchTilesForSearchResults(
  places: Array<{ y?: string | number; x?: string | number }>,
  limit = 3,
): void {
  if (typeof window === "undefined") return;
  const pts: Array<{ lat: number; lng: number }> = [];
  for (const p of places) {
    if (pts.length >= limit) break;
    const lat = parseFloat(String(p.y ?? ""));
    const lng = parseFloat(String(p.x ?? ""));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    pts.push({ lat, lng });
  }
  for (const pt of pts) {
    void prefetchZ14Around(pt.lat, pt.lng);
  }
}

/** Haversine meters — shared by camera distance gate. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Test helper */
export function resetTilePrefetchForTests(): void {
  warmed.clear();
  inFlight.clear();
  active = 0;
  queue.length = 0;
  tileTemplate = null;
  templatePromise = null;
}
