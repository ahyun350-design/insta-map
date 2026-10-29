/**
 * z14–15 shop budget: neighbourhood anchors (stations, markets, streets, parks,
 * schools, 주민센터) lead; only the top-ranked shops in the viewport show.
 *
 * Style filters cannot count per screen, so the cap is a name allow-list applied
 * with setFilter (self-tiles POIs carry no feature ids; feature-state is not valid
 * in filters, and opacity:0 still occupies collision slots). Names that occur at
 * more than one place around the viewport are skipped so one allowed name = one
 * label. Candidates that lose collision are skipped and the next-ranked shop
 * fills the slot, so the band shows exactly `max` when enough candidates exist.
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
const MAX_ROUNDS = 10;
/**
 * Pre-placement guess (screen px) so most picks survive collision on the first
 * round: keep clear of already-placed labels and of each other (text-padding 14).
 */
const CLEAR_OF_LABEL = { dx: 70, dy: 24 };
const CLEAR_OF_SHOP = { dx: 130, dy: 40 };
/** Same-name points closer than this are one shop (tile-buffer copies, OMT+상가). */
const SAME_PLACE_M = 40;
/** Same name elsewhere within this screen margin would double-render → skip name. */
const UNIQUE_MARGIN_PX = 240;

/** Must match the text source of shop_poi / sangga labels. */
const NAME_EXPR: unknown = [
  "to-string",
  ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
];

export type ShopZoomCapStats = {
  zoom: number;
  max: number;
  candidates: number;
  allowed: number;
  rendered: number;
  skipped: number;
  atMs: number;
};

/** Food / café / retail first; lodging · fuel · bank only fill leftover slots. */
const SERVICE_CLASSES = new Set([
  "hotel",
  "lodging",
  "motel",
  "fuel",
  "bank",
  "pharmacy",
]);

type Candidate = {
  name: string;
  layerOrder: number;
  tier: number;
  rank: number;
  x: number;
  y: number;
};

function near(a: { x: number; y: number }, b: { x: number; y: number }, box: { dx: number; dy: number }) {
  return Math.abs(a.x - b.x) < box.dx && Math.abs(a.y - b.y) < box.dy;
}

function rawName(p: Record<string, unknown> | null | undefined): string {
  return String(p?.["name:ko"] || p?.name || "");
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b[1] - a[1]);
  const dLon = toR(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bandForZoom(z: number): CapBand | null {
  return SHOP_ZOOM_CAP_BANDS.find((b) => z >= b.minZoom && z < b.maxZoom) ?? null;
}

function allowFilter(base: unknown, allow: string[]): unknown {
  return ["all", base, ["in", NAME_EXPR, ["literal", allow]]];
}

export function installShopZoomCap(map: MaplibreMap): () => void {
  const baseFilterByLayer = new Map<string, unknown>();
  let viewKey = "";
  /** Allowed names in priority order; each name is shown from one layer only. */
  let allow: Candidate[] = [];
  let allowBand: CapBand | null = null;
  let skip = new Set<string>();
  let rounds = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const namesFor = (layerId: string): string[] => {
    const order = allowBand?.layerIds.indexOf(layerId) ?? -1;
    if (order < 0) return [];
    return allow.filter((c) => c.layerOrder === order).map((c) => c.name);
  };

  const applyAllow = (band: CapBand, layerIds: string[], next: Candidate[]) => {
    allow = next;
    allowBand = band;
    for (const id of layerIds) {
      if (!map.getLayer(id)) continue;
      try {
        map.setFilter(
          id,
          allowFilter(baseFilterByLayer.get(id) ?? true, namesFor(id)) as never,
        );
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
        map.setFilter(id, allowFilter(base, namesFor(id)) as never);
      } catch {
        /* ignore */
      }
    }
  };

  const collectCandidates = (band: CapBand): Candidate[] => {
    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    /** Distinct places per name (around the viewport, incl. margin). */
    const places = new Map<string, Array<[number, number]>>();
    const best = new Map<string, Candidate>();
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
        const name = rawName(f.properties);
        if (!name.trim()) continue;
        const g = f.geometry;
        if (!g || g.type !== "Point") continue;
        const c = g.coordinates as [number, number];
        let p: { x: number; y: number };
        try {
          p = map.project(c);
        } catch {
          continue;
        }
        const m = UNIQUE_MARGIN_PX;
        if (p.x < -m || p.y < -m || p.x > w + m || p.y > h + m) continue;
        const list = places.get(name) ?? [];
        if (!list.some((q) => haversineM(q, c) <= SAME_PLACE_M)) list.push(c);
        places.set(name, list);
        if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
        const cls = String(f.properties?.class ?? "");
        const sub = String(f.properties?.subclass ?? "");
        const cand: Candidate = {
          name,
          layerOrder,
          tier: SERVICE_CLASSES.has(cls) || SERVICE_CLASSES.has(sub) ? 1 : 0,
          rank: Number(f.properties?.rank ?? 999),
          x: p.x,
          y: p.y,
        };
        const prev = best.get(name);
        if (
          !prev ||
          cand.layerOrder < prev.layerOrder ||
          (cand.layerOrder === prev.layerOrder && cand.rank < prev.rank)
        ) {
          best.set(name, cand);
        }
      }
    });
    return [...best.values()]
      .filter((c) => (places.get(c.name)?.length ?? 0) === 1)
      .sort(
        (a, b) =>
          a.layerOrder - b.layerOrder ||
          a.tier - b.tier ||
          a.rank - b.rank ||
          a.name.localeCompare(b.name),
      );
  };

  /** Point labels placed ahead of this band's shops (later style layers win). */
  const placedLabelPoints = (band: CapBand): Array<{ x: number; y: number }> => {
    const styleLayers = map.getStyle()?.layers ?? [];
    const bandIdx = Math.min(
      ...band.layerIds
        .map((id) => styleLayers.findIndex((l) => l.id === id))
        .filter((i) => i >= 0),
    );
    const ids = styleLayers
      .filter(
        (l, i) =>
          i > bandIdx &&
          l.type === "symbol" &&
          !SHOP_ZOOM_CAP_LAYER_IDS.has(l.id) &&
          (l.layout as Record<string, unknown> | undefined)?.["symbol-placement"] !==
            "line",
      )
      .map((l) => l.id);
    if (!ids.length) return [];
    const pts: Array<{ x: number; y: number }> = [];
    try {
      for (const f of map.queryRenderedFeatures({ layers: ids })) {
        const g = f.geometry;
        if (!g || g.type !== "Point") continue;
        pts.push(map.project(g.coordinates as [number, number]));
      }
    } catch {
      /* ignore */
    }
    return pts;
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

    const rendered = new Set<string>();
    try {
      for (const f of map.queryRenderedFeatures({ layers: layerIds })) {
        const n = rawName(f.properties);
        if (n) rendered.add(n);
      }
    } catch {
      /* ignore */
    }
    if (fromIdle && allowBand === band && rounds < MAX_ROUNDS) {
      for (const c of allow) if (!rendered.has(c.name)) skip.add(c.name);
    }

    const candidates = collectCandidates(band);
    const pool = candidates.filter((c) => !skip.has(c.name));
    const sameSlot = (a: Candidate, c: Candidate) =>
      a.name === c.name && a.layerOrder === c.layerOrder;
    // Keep shops that already won placement (no flicker across top-up rounds).
    const chosen = pool
      .filter(
        (c) =>
          allowBand === band &&
          rendered.has(c.name) &&
          allow.some((a) => sameSlot(a, c)),
      )
      .slice(0, band.max);
    const obstacles = placedLabelPoints(band);
    const clearOfShops = (c: Candidate) =>
      !chosen.some((s) => near(s, c, CLEAR_OF_SHOP));
    const passes: Array<(c: Candidate) => boolean> = [
      (c) => clearOfShops(c) && !obstacles.some((o) => near(o, c, CLEAR_OF_LABEL)),
      clearOfShops,
      () => true,
    ];
    for (const ok of passes) {
      for (const c of pool) {
        if (chosen.length >= band.max) break;
        if (chosen.some((s) => sameSlot(s, c))) continue;
        if (ok(c)) chosen.push(c);
      }
    }
    const slotKey = (c: Candidate) => `${c.layerOrder}|${c.name}`;
    const prevKeys = new Set(allow.map(slotKey));
    const changed =
      band !== allowBand ||
      chosen.length !== allow.length ||
      chosen.some((c) => !prevKeys.has(slotKey(c)));
    if (changed) {
      rounds += 1;
      applyAllow(band, layerIds, chosen);
    }

    const stats: ShopZoomCapStats = {
      zoom: z,
      max: band.max,
      candidates: candidates.length,
      allowed: chosen.length,
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
