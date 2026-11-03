/**
 * Several runtime passes narrow the same label layers (shop cap allow-list,
 * same-name hide, cross-source dedupe). Each owner sets its own filter part;
 * the layer filter is always ["all", base, ...parts], so passes never clobber
 * each other. Base = the style's original filter, captured on first use.
 */

import type { Map as MaplibreMap } from "maplibre-gl";

type LayerState = { base: unknown; parts: Map<string, unknown>; applied: string };

const byMap = new WeakMap<MaplibreMap, Map<string, LayerState>>();

function stateFor(map: MaplibreMap, layerId: string): LayerState | null {
  if (!map.getLayer(layerId)) return null;
  let layers = byMap.get(map);
  if (!layers) {
    layers = new Map();
    byMap.set(map, layers);
  }
  let s = layers.get(layerId);
  if (!s) {
    let base: unknown = true;
    try {
      base = map.getFilter(layerId) ?? true;
    } catch {
      base = true;
    }
    s = { base, parts: new Map(), applied: JSON.stringify(base) };
    layers.set(layerId, s);
  }
  return s;
}

function apply(map: MaplibreMap, layerId: string, s: LayerState) {
  const next = s.parts.size ? ["all", s.base, ...s.parts.values()] : s.base;
  const key = JSON.stringify(next);
  if (key === s.applied) return;
  try {
    map.setFilter(layerId, next as never);
    s.applied = key;
  } catch {
    /* ignore */
  }
}

/** The style's own filter for a layer (before any runtime part). */
export function getLayerBaseFilter(map: MaplibreMap, layerId: string): unknown {
  return stateFor(map, layerId)?.base ?? true;
}

/** Set (or clear with null) one owner's part on a layer. */
export function setLayerFilterPart(
  map: MaplibreMap,
  layerId: string,
  owner: string,
  part: unknown | null,
): void {
  const s = stateFor(map, layerId);
  if (!s) return;
  if (part == null) s.parts.delete(owner);
  else s.parts.set(owner, part);
  apply(map, layerId, s);
}

/** Remove one owner's parts from every layer it touched. */
export function clearLayerFilterOwner(map: MaplibreMap, owner: string): void {
  const layers = byMap.get(map);
  if (!layers) return;
  for (const [layerId, s] of layers) {
    if (!s.parts.delete(owner)) continue;
    if (map.getLayer(layerId)) apply(map, layerId, s);
  }
}
