/**
 * Hide OMT shop labels that duplicate 상가(상권) points (normalized name + 50m).
 * Sangga remains visible for duplicates; OMT-only shops stay (OMT layers paint
 * after sangga so they win collision against nearby different-named sangga).
 *
 * Uses setFilter with excluded feature ids (feature-state is not valid in filters,
 * and opacity:0 still occupies collision slots).
 */

import type { Map as MaplibreMap } from "maplibre-gl";
import { KOREA_SANGGA_SOURCE } from "./koreaSangga";

const DEDUP_M = 50;

/** Base filters captured once per shop layer id (without id exclusions). */
const baseFilterByLayer = new Map<string, unknown>();

/** Last reconcile stats (for diagnose / e2e). */
export type SanggaDedupeStats = {
  sanggaCandidates: number;
  omtCandidates: number;
  dupIds: number;
  filterLiteralSize: number;
  atMs: number;
};

let lastStats: SanggaDedupeStats = {
  sanggaCandidates: 0,
  omtCandidates: 0,
  dupIds: 0,
  filterLiteralSize: 0,
  atMs: 0,
};

export function getSanggaDedupeStats(): SanggaDedupeStats {
  return { ...lastStats };
}

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

function inViewport(
  map: MaplibreMap,
  c: [number, number],
  pad = 32,
): boolean {
  try {
    const p = map.project(c);
    const { clientWidth: w, clientHeight: h } = map.getCanvas();
    return p.x >= -pad && p.y >= -pad && p.x <= w + pad && p.y <= h + pad;
  } catch {
    return false;
  }
}

/**
 * Mark OMT shop feature ids that match a nearby sangga point (source features,
 * not only rendered labels), then setFilter so dups leave collision space.
 */
export function reconcileSanggaOmtShopDedupe(map: MaplibreMap): void {
  if (!map.getSource(KOREA_SANGGA_SOURCE)) return;
  const oLayers = shopLayerIds(map);
  if (!oLayers.length) return;
  ensureBaseFilters(map, oLayers);

  let omtFeats: ReturnType<MaplibreMap["queryRenderedFeatures"]> = [];
  let srcFeats: ReturnType<MaplibreMap["querySourceFeatures"]> = [];
  try {
    omtFeats = map.queryRenderedFeatures({ layers: oLayers });
    srcFeats = map.querySourceFeatures(KOREA_SANGGA_SOURCE, {
      sourceLayer: "sangga",
    });
  } catch {
    return;
  }

  const sangga: Pt[] = [];
  for (const f of srcFeats) {
    const name = normalizeShopName(
      String(f.properties?.["name:ko"] || f.properties?.name || ""),
    );
    if (!name || name.length < 2) continue;
    const g = f.geometry;
    if (!g || g.type !== "Point") continue;
    const c = g.coordinates as [number, number];
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    if (!inViewport(map, c)) continue;
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
      if (!name || name.length < 2) continue;
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

  lastStats = {
    sanggaCandidates: sangga.length,
    omtCandidates: omtFeats.length,
    dupIds: dupIds.length,
    filterLiteralSize: unique.length,
    atMs: Date.now(),
  };
  try {
    (
      window as unknown as { __PINDMAP_SANGGA_DEDUPE__?: SanggaDedupeStats }
    ).__PINDMAP_SANGGA_DEDUPE__ = lastStats;
  } catch {
    /* ignore */
  }

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
    // Debounce idle+moveend — typically ≤1 setFilter burst per gesture (~280ms)
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
