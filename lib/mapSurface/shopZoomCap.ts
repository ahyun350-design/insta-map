/**
 * z14–15 shop budget: neighbourhood anchors (stations, markets, streets, parks,
 * schools, 주민센터) lead; only the top-ranked shops in the viewport show.
 *
 * Style filters cannot count per screen, so the cap is an id allow-list applied
 * with setFilter (feature-state is not valid in filters, and opacity:0 still
 * occupies collision slots). Candidates that lose collision are skipped and the
 * next-ranked shop fills the slot, so the band shows exactly `max` when enough
 * candidates exist.
 */

import type { Map as MaplibreMap } from "maplibre-gl";

type CapBand = {
  minZoom: number;
  maxZoom: number;
  max: number;
  /** Priority order: OMT (per-cell rank) before 상가 (category rank only). */
  layerIds: string[];
};

export const SHOP_ZOOM_CAP_BANDS: readonly CapBand[] = [
  {
    minZoom: 14,
    maxZoom: 15,
    max: 8,
    layerIds: ["shop_poi_label_z14", "sangga_shop_label_z14"],
  },
  {
    minZoom: 15,
    maxZoom: 16,
    max: 5,
    layerIds: ["shop_poi_label_z15", "sangga_shop_label_z15"],
  },
];

/** Layers whose filter is owned by this module (other dedupe passes skip them). */
export const SHOP_ZOOM_CAP_LAYER_IDS: ReadonlySet<string> = new Set(
  SHOP_ZOOM_CAP_BANDS.flatMap((b) => b.layerIds),
);

/** Bounded top-up rounds per view (collision losers → next candidate). */
const MAX_ROUNDS = 6;

export type ShopZoomCapStats = {
  zoom: number;
  max: number;
  candidates: number;
  allowed: number;
  rendered: number;
  skipped: number;
  atMs: number;
};

type FeatureId = string | number;

type Candidate = { id: FeatureId; layerOrder: number; rank: number; name: string };

function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]{}]/g, "")
    .replace(/(점|본점|지점)$/u, "");
}

function bandForZoom(z: number): CapBand | null {
  return SHOP_ZOOM_CAP_BANDS.find((b) => z >= b.minZoom && z < b.maxZoom) ?? null;
}

function allowFilter(base: unknown, allow: FeatureId[]): unknown {
  return ["all", base, ["in", ["id"], ["literal", allow]]];
}

export function installShopZoomCap(map: MaplibreMap): () => void {
  const baseFilterByLayer = new Map<string, unknown>();
  let viewKey = "";
  let allow: FeatureId[] = [];
  let skip = new Set<FeatureId>();
  let rounds = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const applyAllow = (layerIds: string[], next: FeatureId[]) => {
    allow = next;
    for (const id of layerIds) {
      if (!map.getLayer(id)) continue;
      try {
        map.setFilter(id, allowFilter(baseFilterByLayer.get(id) ?? true, next) as never);
      } catch {
        /* ignore */
      }
    }
  };

  /** Capture base filters; new layers start hidden until the first reconcile. */
  const ensureBase = () => {
    for (const id of SHOP_ZOOM_CAP_LAYER_IDS) {
      if (baseFilterByLayer.has(id) || !map.getLayer(id)) continue;
      let base: unknown = true;
      try {
        base = map.getFilter(id) ?? true;
      } catch {
        base = true;
      }
      baseFilterByLayer.set(id, base);
      try {
        map.setFilter(id, allowFilter(base, allow) as never);
      } catch {
        /* ignore */
      }
    }
  };

  const collectCandidates = (band: CapBand): Candidate[] => {
    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const byId = new Map<FeatureId, Candidate>();
    band.layerIds.forEach((layerId, layerOrder) => {
      const layer = map.getLayer(layerId) as
        | { source?: string; sourceLayer?: string }
        | undefined;
      if (!layer?.source) return;
      let feats: ReturnType<MaplibreMap["querySourceFeatures"]> = [];
      try {
        feats = map.querySourceFeatures(layer.source, {
          sourceLayer: layer.sourceLayer,
          filter: (baseFilterByLayer.get(layerId) ?? true) as never,
        });
      } catch {
        return;
      }
      for (const f of feats) {
        if (f.id == null || byId.has(f.id)) continue;
        const g = f.geometry;
        if (!g || g.type !== "Point") continue;
        const c = g.coordinates as [number, number];
        let p: { x: number; y: number };
        try {
          p = map.project(c);
        } catch {
          continue;
        }
        if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
        const name = normalizeName(
          String(f.properties?.["name:ko"] || f.properties?.name || ""),
        );
        if (!name) continue;
        byId.set(f.id, {
          id: f.id,
          layerOrder,
          rank: Number(f.properties?.rank ?? 999),
          name,
        });
      }
    });
    const sorted = [...byId.values()].sort(
      (a, b) =>
        a.layerOrder - b.layerOrder ||
        a.rank - b.rank ||
        a.name.localeCompare(b.name) ||
        String(a.id).localeCompare(String(b.id)),
    );
    // One label per name (OMT + 상가 often carry the same shop).
    const seen = new Set<string>();
    return sorted.filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });
  };

  const reconcile = (fromIdle: boolean) => {
    ensureBase();
    const z = map.getZoom();
    const band = bandForZoom(z);
    if (!band) return;
    const layerIds = band.layerIds.filter((id) => map.getLayer(id));
    if (!layerIds.length) return;

    const b = map.getBounds();
    const key = [
      band.minZoom,
      z.toFixed(2),
      b.getWest().toFixed(5),
      b.getSouth().toFixed(5),
      b.getEast().toFixed(5),
      b.getNorth().toFixed(5),
    ].join("|");
    if (key !== viewKey) {
      viewKey = key;
      skip = new Set();
      rounds = 0;
    }

    let rendered = new Set<FeatureId>();
    try {
      for (const f of map.queryRenderedFeatures({ layers: layerIds })) {
        if (f.id != null) rendered.add(f.id);
      }
    } catch {
      rendered = new Set();
    }
    if (fromIdle && rounds < MAX_ROUNDS) {
      for (const id of allow) if (!rendered.has(id)) skip.add(id);
    }

    const candidates = collectCandidates(band);
    const next = candidates
      .filter((c) => !skip.has(c.id))
      .slice(0, band.max)
      .map((c) => c.id);
    const changed =
      next.length !== allow.length || next.some((id, i) => id !== allow[i]);
    if (changed) {
      rounds += 1;
      applyAllow(layerIds, next);
    }

    const stats: ShopZoomCapStats = {
      zoom: z,
      max: band.max,
      candidates: candidates.length,
      allowed: next.length,
      rendered: rendered.size,
      skipped: skip.size,
      atMs: Date.now(),
    };
    try {
      (
        window as unknown as { __PINDMAP_SHOP_CAP__?: ShopZoomCapStats }
      ).__PINDMAP_SHOP_CAP__ = stats;
    } catch {
      /* ignore */
    }
  };

  const schedule = (fromIdle: boolean) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        reconcile(fromIdle);
      } catch {
        /* soft */
      }
    }, 60);
  };
  const onIdle = () => schedule(true);
  const onMoveEnd = () => schedule(false);
  const onStyleData = () => {
    try {
      ensureBase();
    } catch {
      /* style not ready */
    }
  };

  map.on("idle", onIdle);
  map.on("moveend", onMoveEnd);
  map.on("styledata", onStyleData);
  schedule(false);

  return () => {
    if (timer) clearTimeout(timer);
    map.off("idle", onIdle);
    map.off("moveend", onMoveEnd);
    map.off("styledata", onStyleData);
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
