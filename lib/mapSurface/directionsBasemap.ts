/**
 * Directions-mode basemap: mutate paint/visibility in place (no setStyle).
 * Dark palette follows neon tokens; paper leaves basemap paints alone and only
 * hides clutter layers.
 */

import type { Map as MlMap } from "maplibre-gl";
import type { DirectionsRouteThemeId } from "./directionsRouteTheme";

const DARK = {
  background: "#0E1230",
  land: "#0E1230",
  water: "#0A142C",
  park: "#0D2A2A",
  building: "#1A2250",
  road: "#3A4558",
  roadMinor: "#2A3348",
  text: "#6B7390",
  textHalo: "#0E1230",
} as const;

type PaintSnap = { layerId: string; key: string; value: unknown };
type LayoutSnap = { layerId: string; key: string; value: unknown };

type Snapshot = {
  paints: PaintSnap[];
  layouts: LayoutSnap[];
};

const snapByMap = new WeakMap<object, Snapshot>();

function hideId(id: string): boolean {
  return (
    id.startsWith("subway_overlay") ||
    id.includes("landmark") ||
    id.startsWith("poi_") ||
    id.includes("airport") ||
    id.includes("aerodrome") ||
    id.includes("rail") ||
    id.startsWith("place_town") ||
    id.startsWith("place_village") ||
    id.startsWith("place_hamlet") ||
    id.includes("place_other") ||
    id.includes("road_label") ||
    id.includes("highway_name") ||
    id.includes("water_name") ||
    id.includes("waterway_name")
  );
}

function isGuOrCityLabel(id: string): boolean {
  return (
    id.includes("korea_gu") ||
    id.includes("place_city") ||
    id.includes("place_suburb") ||
    id.includes("place_neighbourhood") ||
    id.includes("place_label_metro") ||
    id.includes("place_label_other")
  );
}

function safeGetPaint(map: MlMap, layerId: string, key: string): unknown {
  try {
    return map.getPaintProperty(layerId, key);
  } catch {
    return undefined;
  }
}

function safeSetPaint(map: MlMap, layerId: string, key: string, value: unknown) {
  try {
    map.setPaintProperty(layerId, key, value as never);
  } catch {
    /* layer may not support property */
  }
}

function safeGetLayout(map: MlMap, layerId: string, key: string): unknown {
  try {
    return map.getLayoutProperty(layerId, key);
  } catch {
    return undefined;
  }
}

function safeSetLayout(map: MlMap, layerId: string, key: string, value: unknown) {
  try {
    map.setLayoutProperty(layerId, key, value as never);
  } catch {
    /* ignore */
  }
}

function captureAndHide(
  map: MlMap,
  snap: Snapshot,
  layerId: string,
) {
  const prev = safeGetLayout(map, layerId, "visibility");
  if (prev !== undefined) {
    snap.layouts.push({ layerId, key: "visibility", value: prev });
  }
  safeSetLayout(map, layerId, "visibility", "none");
}

function captureAndPaint(
  map: MlMap,
  snap: Snapshot,
  layerId: string,
  key: string,
  next: unknown,
) {
  const prev = safeGetPaint(map, layerId, key);
  if (prev !== undefined) {
    snap.paints.push({ layerId, key, value: prev });
  }
  safeSetPaint(map, layerId, key, next);
}

/** Restore paints/visibility captured by the last apply. */
export function clearDirectionsBasemap(map: MlMap | null | undefined): void {
  if (!map) return;
  const snap = snapByMap.get(map as object);
  if (!snap) return;
  for (const p of snap.paints) {
    safeSetPaint(map, p.layerId, p.key, p.value);
  }
  for (const l of snap.layouts) {
    safeSetLayout(map, l.layerId, l.key, l.value);
  }
  snapByMap.delete(map as object);
}

/**
 * Apply directions chrome basemap. Call clearDirectionsBasemap before re-apply
 * or when leaving directions mode.
 */
export function applyDirectionsBasemap(
  map: MlMap | null | undefined,
  theme: DirectionsRouteThemeId,
): void {
  if (!map) return;
  clearDirectionsBasemap(map);
  const style = map.getStyle();
  const layers = style?.layers ?? [];
  const snap: Snapshot = { paints: [], layouts: [] };

  for (const layer of layers) {
    const id = layer.id;
    if (!id || id.startsWith("compact-") || id.startsWith("preview-")) continue;
    if (id.startsWith("e2e-")) continue;

    if (hideId(id) && !isGuOrCityLabel(id)) {
      captureAndHide(map, snap, id);
      continue;
    }

    if (theme === "paper") {
      // Paper: keep basemap colors; only clutter was hidden above.
      if (isGuOrCityLabel(id) && layer.type === "symbol") {
        captureAndPaint(map, snap, id, "text-opacity", 0.55);
      }
      continue;
    }

    // Dark (neon-based) — only mutate by layer type to avoid map error events.
    if (layer.type === "background") {
      captureAndPaint(map, snap, id, "background-color", DARK.background);
      continue;
    }
    if (layer.type === "fill") {
      if (id.includes("water")) {
        captureAndPaint(map, snap, id, "fill-color", DARK.water);
      } else if (id.includes("building")) {
        captureAndPaint(map, snap, id, "fill-color", DARK.building);
        captureAndPaint(map, snap, id, "fill-opacity", 0.55);
      } else if (
        id.includes("landcover") ||
        id.includes("landuse") ||
        id.includes("park")
      ) {
        captureAndPaint(map, snap, id, "fill-color", DARK.park);
      }
      // Skip other fills (patterns / unknown) to avoid map error events.
      continue;
    }
    if (
      layer.type === "line" &&
      (id.includes("road") || id.includes("bridge") || id.includes("tunnel")) &&
      !id.includes("rail")
    ) {
      const minor =
        id.includes("minor") ||
        id.includes("path") ||
        id.includes("pedestrian") ||
        id.includes("service");
      captureAndPaint(
        map,
        snap,
        id,
        "line-color",
        minor ? DARK.roadMinor : DARK.road,
      );
      captureAndPaint(map, snap, id, "line-opacity", 0.85);
      continue;
    }
    if (isGuOrCityLabel(id) && layer.type === "symbol") {
      captureAndPaint(map, snap, id, "text-color", DARK.text);
      captureAndPaint(map, snap, id, "text-halo-color", DARK.textHalo);
      captureAndPaint(map, snap, id, "text-opacity", 0.7);
    }
  }

  snapByMap.set(map as object, snap);
}
