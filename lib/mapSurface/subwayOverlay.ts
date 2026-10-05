"use client";

import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { softenSubwayColour } from "./subwayColour";

export const SUBWAY_SOURCE = "pindmap_subway";
export const SUBWAY_LINE_CASING = "subway_overlay_line_casing";
export const SUBWAY_LINE = "subway_overlay_line";
export const SUBWAY_STATION = "subway_overlay_station";
export const SUBWAY_STATION_TRANSFER = "subway_overlay_station_transfer";
export const SUBWAY_EXIT_BG = "subway_overlay_exit_bg";
export const SUBWAY_EXIT = "subway_overlay_exit";

const OVERLAY_URL = "/map-overlay/subway.json";

type ThemeId = "paper" | "white" | "neon" | string;

type OverlayFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
};

type OverlayFc = {
  type: "FeatureCollection";
  features: OverlayFeature[];
};

let cachedRaw: OverlayFc | null = null;
let loadPromise: Promise<OverlayFc | null> | null = null;

async function fetchOverlay(): Promise<OverlayFc | null> {
  if (cachedRaw) return cachedRaw;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(OVERLAY_URL, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`subway overlay HTTP ${res.status}`);
      const json = (await res.json()) as OverlayFc;
      if (!json || json.type !== "FeatureCollection") return null;
      cachedRaw = json;
      return json;
    } catch (e) {
      console.warn("[PindMap:subway] overlay load failed — map continues", e);
      return null;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

function themeFc(raw: OverlayFc, theme: ThemeId): OverlayFc {
  return {
    type: "FeatureCollection",
    features: raw.features.map((f) => {
      const p = { ...f.properties };
      if (typeof p.colour === "string") {
        p.colour = softenSubwayColour(p.colour, theme);
      }
      if (Array.isArray(p.colours)) {
        const next = (p.colours as unknown[]).map((c) =>
          typeof c === "string" ? softenSubwayColour(c, theme) : c,
        );
        p.colours = next;
        if (typeof next[0] === "string") p.colour = next[0];
      }
      return { ...f, properties: p };
    }),
  };
}

function beforeIdForSubway(map: MlMap): string | undefined {
  const order = [
    "subway_station_dot",
    "poi_transit",
    "landmark_dot",
    "landmark_label",
    "label_korea_gu_overlay",
  ];
  for (const id of order) {
    if (map.getLayer(id)) return id;
  }
  const layers = map.getStyle()?.layers ?? [];
  const sym = layers.find((l) => l.type === "symbol");
  return sym?.id;
}

function quietPalette(theme: ThemeId) {
  if (theme === "neon") {
    return {
      line: "#3A4568",
      stationStroke: "#0E1230",
      transferFill: "#E8ECFF",
      transferStroke: "#8A92B8",
      label: "#A8B0C8",
      labelHalo: "#0E1230",
      exitFill: "#2A3358",
      exitStroke: "#8A92B8",
      exitText: "#C9CEF5",
      exitHalo: "#0E1230",
    };
  }
  if (theme === "white") {
    return {
      line: "#C8CDD4",
      stationStroke: "#FFFFFF",
      transferFill: "#FFFFFF",
      transferStroke: "#9AA0A8",
      label: "#7A808C",
      labelHalo: "#FFFFFF",
      exitFill: "#F0F1F3",
      exitStroke: "#A0A6B0",
      exitText: "#5A606C",
      exitHalo: "#FFFFFF",
    };
  }
  // paper
  return {
    line: "#C5C0B8",
    stationStroke: "#F7F5F0",
    transferFill: "#FFFFFF",
    transferStroke: "#A8A29A",
    label: "#7A756C",
    labelHalo: "#F7F5F0",
    exitFill: "#EDE9E1",
    exitStroke: "#B0AAA0",
    exitText: "#5A564E",
    exitHalo: "#F7F5F0",
  };
}

function upsertLayer(
  map: MlMap,
  spec: maplibregl.AddLayerObject,
  before?: string,
) {
  const id = spec.id;
  if (map.getLayer(id)) {
    // Update paint/layout for quiet restyle on remount
    const paint = (spec as { paint?: Record<string, unknown> }).paint;
    const layout = (spec as { layout?: Record<string, unknown> }).layout;
    if (paint) {
      for (const [k, v] of Object.entries(paint)) {
        try {
          map.setPaintProperty(id, k, v as never);
        } catch {
          /* noop */
        }
      }
    }
    if (layout) {
      for (const [k, v] of Object.entries(layout)) {
        try {
          map.setLayoutProperty(id, k, v as never);
        } catch {
          /* noop */
        }
      }
    }
    if ("minzoom" in spec && typeof spec.minzoom === "number") {
      try {
        map.setLayerZoomRange(id, spec.minzoom, spec.maxzoom ?? 24);
      } catch {
        /* noop */
      }
    }
    return;
  }
  map.addLayer(spec, before);
}

function ensureLayers(map: MlMap, theme: ThemeId): void {
  if (!map.getSource(SUBWAY_SOURCE)) {
    map.addSource(SUBWAY_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  const before = beforeIdForSubway(map);
  const p = quietPalette(theme);

  // Legacy casing layer: hide (no casing in quiet style)
  if (map.getLayer(SUBWAY_LINE_CASING)) {
    map.setLayoutProperty(SUBWAY_LINE_CASING, "visibility", "none");
  }

  upsertLayer(
    map,
    {
      id: SUBWAY_LINE,
      type: "line",
      source: SUBWAY_SOURCE,
      filter: ["==", ["get", "kind"], "line"],
      minzoom: 13,
      layout: {
        "line-cap": "round",
        "line-join": "round",
        visibility: "visible",
      },
      paint: {
        "line-color": p.line,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          1.1,
          16,
          1.5,
        ],
        "line-opacity": 0.85,
      },
    },
    before,
  );

  upsertLayer(
    map,
    {
      id: SUBWAY_STATION,
      type: "circle",
      source: SUBWAY_SOURCE,
      filter: [
        "all",
        ["==", ["get", "kind"], "station"],
        ["!=", ["get", "transfer"], 1],
      ],
      minzoom: 14,
      paint: {
        "circle-radius": 2.5,
        "circle-color": ["coalesce", ["get", "colour"], "#888888"],
        "circle-stroke-width": 1,
        "circle-stroke-color": p.stationStroke,
        "circle-opacity": 0.95,
      },
      layout: { visibility: "visible" },
    },
    before,
  );

  upsertLayer(
    map,
    {
      id: SUBWAY_STATION_TRANSFER,
      type: "circle",
      source: SUBWAY_SOURCE,
      filter: [
        "all",
        ["==", ["get", "kind"], "station"],
        ["==", ["get", "transfer"], 1],
      ],
      minzoom: 14,
      paint: {
        "circle-radius": 2.8,
        "circle-color": p.transferFill,
        "circle-stroke-width": 1.4,
        "circle-stroke-color": p.transferStroke,
        "circle-opacity": 0.96,
      },
      layout: { visibility: "visible" },
    },
    before,
  );

  // Station names come from basemap poi_transit (overlay station `name` is line title).

  upsertLayer(
    map,
    {
      id: SUBWAY_EXIT_BG,
      type: "circle",
      source: SUBWAY_SOURCE,
      filter: ["==", ["get", "kind"], "exit"],
      minzoom: 16,
      paint: {
        "circle-radius": 7,
        "circle-color": p.exitFill,
        "circle-stroke-width": 1,
        "circle-stroke-color": p.exitStroke,
        "circle-opacity": 0.92,
      },
      layout: { visibility: "visible" },
    },
    before,
  );

  upsertLayer(
    map,
    {
      id: SUBWAY_EXIT,
      type: "symbol",
      source: SUBWAY_SOURCE,
      filter: ["==", ["get", "kind"], "exit"],
      minzoom: 16,
      layout: {
        "text-field": ["to-string", ["get", "ref"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "text-allow-overlap": false,
        "text-optional": true,
        "text-padding": 2,
        visibility: "visible",
      },
      paint: {
        "text-color": p.exitText,
        "text-halo-color": p.exitHalo,
        "text-halo-width": 0.3,
      },
    },
    before,
  );

  if (map.getLayer("subway_station_dot")) {
    map.setLayoutProperty("subway_station_dot", "visibility", "none");
  }
}

/**
 * Lazy-load subway overlay. Never throws; failures leave the basemap alone.
 * Safe to call multiple times (theme remount / remount keys).
 */
export async function attachSubwayOverlay(
  map: MlMap,
  theme: ThemeId = "paper",
): Promise<boolean> {
  try {
    if (!map || map.getCanvas == null) return false;
    const raw = await fetchOverlay();
    if (!raw) return false;
    if (!map.getStyle()) return false;
    ensureLayers(map, theme);
    const src = map.getSource(SUBWAY_SOURCE) as
      | { setData: (d: OverlayFc) => void }
      | undefined;
    if (!src?.setData) return false;
    src.setData(themeFc(raw, theme));
    return true;
  } catch (e) {
    console.warn("[PindMap:subway] attach failed", e);
    return false;
  }
}

/** Prefetch without blocking map creation. */
export function prefetchSubwayOverlay(): void {
  void fetchOverlay();
}
