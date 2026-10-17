/**
 * Hide OMT shop labels that duplicate 상가(상권) points (normalized name + 50m).
 * Sangga remains visible; OMT-only shops stay.
 *
 * Uses setFilter with excluded feature ids (feature-state is not valid in filters,
 * and opacity:0 still occupies collision slots).
 */

import type { Map as MaplibreMap } from "maplibre-gl";
import { KOREA_SANGGA_SOURCE } from "./koreaSangga";

const DEDUP_M = 50;

/** Base filters captured once per shop layer id (without id exclusions). */
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

function shopLayerIds(map: MaplibreMap): string[] {
  const style = map.getStyle();
  if (!style?.layers) return [];
  return style.layers
    .map((l) => l.id)
    .filter(
      (id) => id.startsWith("shop_poi_label_") && Boolean(map.getLayer(id)),
    );
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

type Pt = { name: string; c: [number, number] };

function ensureBaseFilters(map: MaplibreMap, oLayers: string[]) {
  for (const id of oLayers) {
    if (baseFilterByLayer.has(id)) continue;
    try {
      const f = map.getFilter(id);
      baseFilterByLayer.set(id, f ?? true);
    } catch {
      baseFilterByLayer.set(id, true);
    }
  }
}

/**
 * Mark OMT shop feature ids that match a nearby sangga label, then setFilter
 * so they leave collision space for 상가정보 labels.
 */
export function reconcileSanggaOmtShopDedupe(map: MaplibreMap): void {
  if (!map.getSource(KOREA_SANGGA_SOURCE)) return;
  const sLayers = sanggaLayerIds(map);
  const oLayers = shopLayerIds(map);
  if (!sLayers.length || !oLayers.length) return;
  ensureBaseFilters(map, oLayers);

  let sanggaFeats: ReturnType<MaplibreMap["queryRenderedFeatures"]> = [];
  let omtFeats: ReturnType<MaplibreMap["queryRenderedFeatures"]> = [];
  try {
    // Query with current filters — first pass may still include dups
    sanggaFeats = map.queryRenderedFeatures({ layers: sLayers });
    omtFeats = map.queryRenderedFeatures({ layers: oLayers });
  } catch {
    return;
  }

  const sangga: Pt[] = [];
  for (const f of sanggaFeats) {
    const name = normalizeShopName(
      String(f.properties?.["name:ko"] || f.properties?.name || ""),
    );
    if (!name || name.length < 2) continue;
    const g = f.geometry;
    if (!g || g.type !== "Point") continue;
    const c = g.coordinates as [number, number];
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    sangga.push({ name, c });
  }

  const byName = new Map<string, Pt[]>();
  for (const s of sangga) {
    const list = byName.get(s.name);
    if (list) list.push(s);
    else byName.set(s.name, [s]);
  }

  const dupIds: Array<string | number> = [];
  if (sangga.length) {
    for (const f of omtFeats) {
      const id = f.id;
      if (id == null) continue;
      const name = normalizeShopName(
        String(f.properties?.["name:ko"] || f.properties?.name || ""),
      );
      if (!name) continue;
      const g = f.geometry;
      if (!g || g.type !== "Point") continue;
      const c = g.coordinates as [number, number];
      const cands = byName.get(name);
      if (!cands) continue;
      for (const s of cands) {
        if (haversineM(c, s.c) <= DEDUP_M) {
          dupIds.push(id);
          break;
        }
      }
    }
  }

  // Cap literal size — viewport dups are typically small
  const unique = [...new Set(dupIds)].slice(0, 500);

  for (const id of oLayers) {
    const base = baseFilterByLayer.get(id) ?? true;
    const next: unknown =
      unique.length === 0
        ? base
        : [
            "all",
            base,
            [
              "!",
              [
                "in",
                ["id"],
                ["literal", unique],
              ],
            ],
          ];
    try {
      map.setFilter(id, next as never);
    } catch {
      /* ignore */
    }
  }
}

export function installSanggaShopDedupe(map: MaplibreMap): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        reconcileSanggaOmtShopDedupe(map);
      } catch {
        /* soft */
      }
    }, 280);
  };
  map.on("idle", run);
  map.on("moveend", run);
  run();
  return () => {
    if (timer) clearTimeout(timer);
    map.off("idle", run);
    map.off("moveend", run);
    // Restore base filters
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
