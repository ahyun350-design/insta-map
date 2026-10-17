/**
 * When TourAPI and 상가정보 share normalized name within 50m, hide the sangga
 * label (Tour sits above shops in the priority stack).
 */

import type { Map as MaplibreMap } from "maplibre-gl";
import { KOREA_TOUR_SOURCE } from "./koreaTour";

const DEDUP_M = 50;
const baseFilterByLayer = new Map<string, unknown>();

function normalizeShopName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]{}]/g, "")
    .replace(/(점|본점|지점)$/u, "");
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b[1] - a[1]);
  const dLon = toR(b[0] - a[0]);
  const lat1 = toR(a[1]);
  const lat2 = toR(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function sanggaLayerIds(map: MaplibreMap): string[] {
  const style = map.getStyle();
  if (!style?.layers) return [];
  return style.layers
    .map((l) => l.id)
    .filter(
      (id) =>
        id.startsWith("sangga_shop_label_") && Boolean(map.getLayer(id)),
    );
}

function tourLayerIds(map: MaplibreMap): string[] {
  const style = map.getStyle();
  if (!style?.layers) return [];
  return style.layers
    .map((l) => l.id)
    .filter(
      (id) => id.startsWith("tour_poi_label_") && Boolean(map.getLayer(id)),
    );
}

export function reconcileTourSanggaDedupe(map: MaplibreMap): void {
  if (!map.getSource(KOREA_TOUR_SOURCE)) return;
  const tLayers = tourLayerIds(map);
  const sLayers = sanggaLayerIds(map);
  if (!tLayers.length || !sLayers.length) return;

  for (const id of sLayers) {
    if (baseFilterByLayer.has(id)) continue;
    try {
      baseFilterByLayer.set(id, map.getFilter(id) ?? true);
    } catch {
      baseFilterByLayer.set(id, true);
    }
  }

  let tourFeats: ReturnType<MaplibreMap["queryRenderedFeatures"]> = [];
  let sanggaFeats: ReturnType<MaplibreMap["queryRenderedFeatures"]> = [];
  try {
    tourFeats = map.queryRenderedFeatures({ layers: tLayers });
    sanggaFeats = map.queryRenderedFeatures({ layers: sLayers });
  } catch {
    return;
  }

  type Pt = { name: string; c: [number, number] };
  const tour: Pt[] = [];
  for (const f of tourFeats) {
    const name = normalizeShopName(String(f.properties?.name || ""));
    if (!name || name.length < 2) continue;
    const g = f.geometry;
    if (!g || g.type !== "Point") continue;
    const c = g.coordinates as [number, number];
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    tour.push({ name, c });
  }
  const byName = new Map<string, Pt[]>();
  for (const t of tour) {
    const list = byName.get(t.name);
    if (list) list.push(t);
    else byName.set(t.name, [t]);
  }

  const dupIds: Array<string | number> = [];
  for (const f of sanggaFeats) {
    if (f.id == null) continue;
    const name = normalizeShopName(String(f.properties?.name || ""));
    if (!name) continue;
    const g = f.geometry;
    if (!g || g.type !== "Point") continue;
    const c = g.coordinates as [number, number];
    const cands = byName.get(name);
    if (!cands) continue;
    for (const t of cands) {
      if (haversineM(c, t.c) <= DEDUP_M) {
        dupIds.push(f.id);
        break;
      }
    }
  }
  const unique = [...new Set(dupIds)].slice(0, 500);

  for (const id of sLayers) {
    const base = baseFilterByLayer.get(id) ?? true;
    const next: unknown =
      unique.length === 0
        ? base
        : ["all", base, ["!", ["in", ["id"], ["literal", unique]]]];
    try {
      map.setFilter(id, next as never);
    } catch {
      /* ignore */
    }
  }
}

export function installTourSanggaDedupe(map: MaplibreMap): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        reconcileTourSanggaDedupe(map);
      } catch {
        /* soft */
      }
    }, 320);
  };
  map.on("idle", run);
  map.on("moveend", run);
  run();
  return () => {
    if (timer) clearTimeout(timer);
    map.off("idle", run);
    map.off("moveend", run);
    for (const [id, base] of baseFilterByLayer) {
      try {
        if (map.getLayer(id)) map.setFilter(id, base as never);
      } catch {
        /* ignore */
      }
    }
    baseFilterByLayer.clear();
  };
}
