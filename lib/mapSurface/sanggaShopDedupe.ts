/**
 * One label per shop across OMT · 상가 · TourAPI (z14+).
 *
 * Self-tiles POIs carry no feature ids, so twins are found by normalized name
 * (equal, or one contains the other, ≥3 chars) within 50m on loaded source
 * features. Priority: Tour attraction > 상가 > OMT > Tour shop. The weaker
 * source drops the name via a layer filter part — only when every instance of
 * that name around the viewport sits next to a stronger twin, so chains
 * elsewhere on screen keep their labels.
 */

import type { Map as MaplibreMap } from "maplibre-gl";
import { KOREA_SANGGA_SOURCE } from "./koreaSangga";
import { KOREA_TOUR_SOURCE } from "./koreaTour";
import { haversineMeters } from "./labelNameDedup";
import { clearLayerFilterOwner, setLayerFilterPart } from "./layerFilterParts";

const OWNER = "sourceDedupe";
const MIN_ZOOM = 14;
const DEDUP_M = 50;
/** Tile-buffer copies of one feature. */
const SAME_FEATURE_M = 5;
const MARGIN_PX = 120;

const NAME_EXPR: unknown = [
  "to-string",
  ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
];

type Group = "omt" | "sangga" | "tour";
const LAYER_PREFIX: Record<Group, string> = {
  omt: "shop_poi_label_",
  sangga: "sangga_shop_label_",
  tour: "tour_poi_label_",
};

type Pt = {
  group: Group;
  /** Lower wins: 0 tour attraction, 1 상가, 2 OMT, 3 tour shop. */
  rank: number;
  raw: string;
  norm: string;
  lng: number;
  lat: number;
};

export type SourceDedupeStats = {
  points: number;
  hidden: Record<Group, number>;
  atMs: number;
};

export function normalizeShopName(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "").replace(/[()[\]{}·.,'"-]/g, "");
}

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.includes(b) || b.includes(a);
}

/** ~50m grid cell key. */
function cellOf(lat: number, lng: number): [number, number] {
  return [Math.floor(lat / 0.00045), Math.floor(lng / 0.00057)];
}

export function installSanggaShopDedupe(map: MaplibreMap): () => void {
  let hidden: Record<Group, Set<string>> = {
    omt: new Set(),
    sangga: new Set(),
    tour: new Set(),
  };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const layersOf = (group: Group) =>
    (map.getStyle()?.layers ?? [])
      .map((l) => l.id)
      .filter((id) => id.startsWith(LAYER_PREFIX[group]) && map.getLayer(id));

  const apply = (next: Record<Group, Set<string>>) => {
    for (const group of Object.keys(LAYER_PREFIX) as Group[]) {
      const names = [...next[group]].sort();
      const part = names.length ? ["!", ["in", NAME_EXPR, ["literal", names]]] : null;
      for (const id of layersOf(group)) setLayerFilterPart(map, id, OWNER, part);
    }
    hidden = next;
  };

  const collect = (): Pt[] => {
    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pts: Pt[] = [];
    const take = (
      source: string,
      sourceLayer: string,
      toPt: (p: Record<string, unknown>) => Pick<Pt, "group" | "rank"> | null,
    ) => {
      if (!map.getSource(source)) return;
      let feats: ReturnType<MaplibreMap["querySourceFeatures"]> = [];
      try {
        feats = map.querySourceFeatures(source, { sourceLayer });
      } catch {
        return;
      }
      for (const f of feats) {
        const g = f.geometry;
        if (!g || g.type !== "Point") continue;
        const props = (f.properties ?? {}) as Record<string, unknown>;
        const raw = String(props["name:ko"] || props.name || "");
        const norm = normalizeShopName(raw);
        if (norm.length < 2) continue;
        const kind = toPt(props);
        if (!kind) continue;
        const [lng, lat] = g.coordinates as [number, number];
        let p: { x: number; y: number };
        try {
          p = map.project([lng, lat]);
        } catch {
          continue;
        }
        if (p.x < -MARGIN_PX || p.y < -MARGIN_PX || p.x > w + MARGIN_PX || p.y > h + MARGIN_PX) {
          continue;
        }
        pts.push({ ...kind, raw, norm, lng, lat });
      }
    };
    take("openmaptiles", "poi", (p) =>
      p.class === "bus" || p.class === "railway" ? null : { group: "omt", rank: 2 },
    );
    take(KOREA_SANGGA_SOURCE, "sangga", () => ({ group: "sangga", rank: 1 }));
    take(KOREA_TOUR_SOURCE, "tour", (p) =>
      p.class === "shop" ? { group: "tour", rank: 3 } : { group: "tour", rank: 0 },
    );
    return pts;
  };

  const reconcile = () => {
    if (map.getZoom() < MIN_ZOOM) {
      if (hidden.omt.size || hidden.sangga.size || hidden.tour.size) {
        apply({ omt: new Set(), sangga: new Set(), tour: new Set() });
      }
      return;
    }
    const raw = collect();

    // Collapse tile-buffer copies (same group + name within a few metres).
    const grid = new Map<string, Pt[]>();
    const pts: Pt[] = [];
    const key = (a: number, b: number) => `${a}:${b}`;
    for (const p of raw) {
      const [cy, cx] = cellOf(p.lat, p.lng);
      let dup = false;
      for (let dy = -1; dy <= 1 && !dup; dy++) {
        for (let dx = -1; dx <= 1 && !dup; dx++) {
          for (const q of grid.get(key(cy + dy, cx + dx)) ?? []) {
            if (
              q.group === p.group &&
              q.rank === p.rank &&
              q.raw === p.raw &&
              haversineMeters(q.lng, q.lat, p.lng, p.lat) <= SAME_FEATURE_M
            ) {
              dup = true;
              break;
            }
          }
        }
      }
      if (dup) continue;
      const k = key(cy, cx);
      const list = grid.get(k);
      if (list) list.push(p);
      else grid.set(k, [p]);
      pts.push(p);
    }

    const covered = (p: Pt): boolean => {
      const [cy, cx] = cellOf(p.lat, p.lng);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const q of grid.get(key(cy + dy, cx + dx)) ?? []) {
            if (q.rank >= p.rank) continue;
            if (!similar(q.norm, p.norm)) continue;
            if (haversineMeters(q.lng, q.lat, p.lng, p.lat) <= DEDUP_M) return true;
          }
        }
      }
      return false;
    };

    // name → all instances covered? (per group)
    const verdict: Record<Group, Map<string, boolean>> = {
      omt: new Map(),
      sangga: new Map(),
      tour: new Map(),
    };
    for (const p of pts) {
      if (p.rank === 0) continue;
      const m = verdict[p.group];
      const prev = m.get(p.raw);
      if (prev === false) continue;
      m.set(p.raw, covered(p));
    }
    // A Tour attraction name never hides itself in the tour layers.
    for (const p of pts) {
      if (p.group === "tour" && p.rank === 0) verdict.tour.set(p.raw, false);
    }

    const next: Record<Group, Set<string>> = {
      omt: new Set(),
      sangga: new Set(),
      tour: new Set(),
    };
    for (const group of Object.keys(verdict) as Group[]) {
      for (const [name, all] of verdict[group]) if (all) next[group].add(name);
    }
    apply(next);

    const stats: SourceDedupeStats = {
      points: pts.length,
      hidden: { omt: next.omt.size, sangga: next.sangga.size, tour: next.tour.size },
      atMs: Date.now(),
    };
    try {
      (
        window as unknown as { __PINDMAP_SANGGA_DEDUPE__?: SourceDedupeStats }
      ).__PINDMAP_SANGGA_DEDUPE__ = stats;
    } catch {
      /* ignore */
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        reconcile();
      } catch {
        /* soft */
      }
    }, 250);
  };
  map.on("idle", schedule);
  map.on("moveend", schedule);
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
    map.off("idle", schedule);
    map.off("moveend", schedule);
    clearLayerFilterOwner(map, OWNER);
  };
}
