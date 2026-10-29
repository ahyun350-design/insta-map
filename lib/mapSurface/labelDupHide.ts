/**
 * Street zoom (z14+): one label per name. When the same normalized name is
 * placed by two label families close together (e.g. 홍대거리 as a ★ attraction
 * and as a gray area name), the stronger family keeps it and the other layer
 * drops that name via setFilter (feature-state is not valid in filters, and
 * opacity:0 still occupies collision slots).
 *
 * Shop layers are left alone (chain names repeat; shopZoomCap owns z14–15).
 * Below z14 base filters are restored so mid-zoom place density is unchanged.
 */

import type { Map as MaplibreMap } from "maplibre-gl";
import { normalizeLabelName, haversineMeters } from "./labelNameDedup";

const MIN_ZOOM = 14;
/** POI vs POI with short (generic-prone) names. */
const POI_RADIUS_M = 300;
/**
 * Area names sit at polygon / admin centroids, and long venue names (경의선숲길)
 * label linear parks / streets far from the other source's point.
 */
const AREA_RADIUS_M = 800;
/** Multi-point venues (linear parks / streets) spread up to this from the winner. */
const SPREAD_RADIUS_M = 1600;
const AREA_TIER = 5;

/** Lower tier = stronger (keeps the name). */
function tierOf(layerId: string): number | null {
  if (/^(korea_landmark_tier|label_korea_landmark_overlay)/.test(layerId)) return 0;
  if (/^poi_transit/.test(layerId)) return 1;
  if (/^tour_poi_label_/.test(layerId)) return 2;
  if (/^landmark_(label|priority)/.test(layerId)) return 3;
  if (/^park_name_label_/.test(layerId)) return 4;
  if (
    /^(label_(dong|suburb|village|borough|korea_gu|korea_dong|korea_mountain)|admin_(dong|sigungu)_label|named_building_label|apt_complex_label)/.test(
      layerId,
    )
  ) {
    return AREA_TIER;
  }
  return null;
}

const NAME_EXPR: unknown = [
  "to-string",
  ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
];

type Placed = {
  layerId: string;
  tier: number;
  raw: string;
  norm: string;
  lng: number;
  lat: number;
};

export function installLabelDupHide(map: MaplibreMap): () => void {
  const baseFilterByLayer = new Map<string, unknown>();
  /** layerId → raw names hidden in that layer. */
  let hidden = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const applyLayer = (layerId: string) => {
    if (!map.getLayer(layerId)) return;
    if (!baseFilterByLayer.has(layerId)) {
      try {
        baseFilterByLayer.set(layerId, map.getFilter(layerId) ?? true);
      } catch {
        baseFilterByLayer.set(layerId, true);
      }
    }
    const base = baseFilterByLayer.get(layerId) ?? true;
    const names = [...(hidden.get(layerId) ?? [])];
    try {
      map.setFilter(
        layerId,
        (names.length
          ? ["all", base, ["!", ["in", NAME_EXPR, ["literal", names]]]]
          : base) as never,
      );
    } catch {
      /* ignore */
    }
  };

  const sameSet = (a: Set<string> | undefined, b: Set<string> | undefined) => {
    const x = a ?? new Set<string>();
    const y = b ?? new Set<string>();
    return x.size === y.size && [...x].every((n) => y.has(n));
  };

  const commit = (next: Map<string, Set<string>>) => {
    const touched = new Set([...hidden.keys(), ...next.keys()]);
    const prev = hidden;
    hidden = next;
    for (const id of touched) {
      if (!sameSet(prev.get(id), next.get(id))) applyLayer(id);
    }
  };

  const reconcile = () => {
    if (map.getZoom() < MIN_ZOOM) {
      if (hidden.size) commit(new Map());
      publish();
      return;
    }
    const ids = (map.getStyle()?.layers ?? [])
      .filter((l) => l.type === "symbol" && tierOf(l.id) != null)
      .map((l) => l.id)
      .filter((id) => map.getLayer(id));
    if (!ids.length) return;

    const placed: Placed[] = [];
    try {
      for (const f of map.queryRenderedFeatures({ layers: ids })) {
        const g = f.geometry;
        if (!g || g.type !== "Point") continue;
        const raw = String(f.properties?.["name:ko"] || f.properties?.name || "");
        const norm = normalizeLabelName(raw);
        if (norm.length < 2) continue;
        const [lng, lat] = g.coordinates as [number, number];
        placed.push({ layerId: f.layer.id, tier: tierOf(f.layer.id)!, raw, norm, lng, lat });
      }
    } catch {
      return;
    }

    const byNorm = new Map<string, Placed[]>();
    for (const p of placed) {
      const list = byNorm.get(p.norm);
      if (list) list.push(p);
      else byNorm.set(p.norm, [p]);
    }

    const next = new Map<string, Set<string>>();
    const hide = (layerId: string, raw: string) => {
      const s = next.get(layerId) ?? new Set<string>();
      s.add(raw);
      next.set(layerId, s);
    };

    // Keep names already hidden while their stronger twin is still on screen.
    for (const [layerId, names] of hidden) {
      const t = tierOf(layerId);
      for (const raw of names) {
        const winners = byNorm.get(normalizeLabelName(raw)) ?? [];
        if (winners.some((w) => t != null && w.tier < t)) hide(layerId, raw);
      }
    }

    for (const list of byNorm.values()) {
      if (list.length < 2) continue;
      const best = Math.min(...list.map((p) => p.tier));
      const winners = list.filter((p) => p.tier === best);
      const nearWinner = (p: Placed, radius: number) =>
        winners.some((w) => haversineMeters(w.lng, w.lat, p.lng, p.lat) <= radius);
      for (const p of list) {
        if (p.tier === best) continue;
        const radius =
          p.tier === AREA_TIER || p.norm.length >= 4 ? AREA_RADIUS_M : POI_RADIUS_M;
        if (!nearWinner(p, radius)) continue;
        // Several points of one name in a layer: one venue (linear park) only when
        // all sit around the winner; otherwise a generic name (어린이공원) → keep.
        const sameLayer = list.filter((q) => q.layerId === p.layerId && q.raw === p.raw);
        if (sameLayer.some((q) => !nearWinner(q, SPREAD_RADIUS_M))) continue;
        hide(p.layerId, p.raw);
      }
    }

    commit(next);
    publish();
  };

  const publish = () => {
    try {
      (
        window as unknown as { __PINDMAP_LABEL_DUP__?: Record<string, string[]> }
      ).__PINDMAP_LABEL_DUP__ = Object.fromEntries(
        [...hidden].map(([k, v]) => [k, [...v]]),
      );
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
    }, 120);
  };

  map.on("idle", schedule);
  map.on("moveend", schedule);
  schedule();

  return () => {
    if (timer) clearTimeout(timer);
    map.off("idle", schedule);
    map.off("moveend", schedule);
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
