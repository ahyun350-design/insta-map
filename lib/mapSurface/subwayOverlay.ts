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

function ensureLayers(map: MlMap, theme: ThemeId): void {
  if (!map.getSource(SUBWAY_SOURCE)) {
    map.addSource(SUBWAY_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  const before = beforeIdForSubway(map);
  const casingColor = theme === "neon" ? "#0E1230" : "#FFFFFF";
  const transferFill = theme === "neon" ? "#E8ECFF" : "#FFFFFF";
  const transferStroke = theme === "neon" ? "#C9CEF5" : "#2A2A2A";
  const exitText = theme === "neon" ? "#E8ECFF" : "#1A1A1A";
  const exitHalo = theme === "neon" ? "#0E1230" : "#FFFFFF";
  const exitFill = theme === "neon" ? "#1A2250" : "#FFFFFF";
  const exitStroke = theme === "neon" ? "#C9CEF5" : "#444444";

  const widthMain = [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    1.2,
    13,
    2,
    16,
    3,
  ] as maplibregl.ExpressionSpecification;
  const widthCasing = [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    2.4,
    13,
    3.6,
    16,
    5,
  ] as maplibregl.ExpressionSpecification;

  if (!map.getLayer(SUBWAY_LINE_CASING)) {
    map.addLayer(
      {
        id: SUBWAY_LINE_CASING,
        type: "line",
        source: SUBWAY_SOURCE,
        filter: ["==", ["get", "kind"], "line"],
        minzoom: 10,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": casingColor,
          "line-width": widthCasing,
          "line-opacity": 0.9,
        },
      },
      before,
    );
  }

  if (!map.getLayer(SUBWAY_LINE)) {
    map.addLayer(
      {
        id: SUBWAY_LINE,
        type: "line",
        source: SUBWAY_SOURCE,
        filter: ["==", ["get", "kind"], "line"],
        minzoom: 10,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "colour"], "#666666"],
          "line-width": widthMain,
          "line-opacity": 0.85,
        },
      },
      before,
    );
  }

  if (!map.getLayer(SUBWAY_STATION)) {
    map.addLayer(
      {
        id: SUBWAY_STATION,
        type: "circle",
        source: SUBWAY_SOURCE,
        filter: [
          "all",
          ["==", ["get", "kind"], "station"],
          ["!=", ["get", "transfer"], 1],
        ],
        minzoom: 11,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            3,
            14,
            4,
            16,
            5,
          ],
          "circle-color": ["coalesce", ["get", "colour"], "#666666"],
          "circle-stroke-width": 1.2,
          "circle-stroke-color": casingColor,
          "circle-opacity": 0.95,
        },
      },
      before,
    );
  }

  if (!map.getLayer(SUBWAY_STATION_TRANSFER)) {
    map.addLayer(
      {
        id: SUBWAY_STATION_TRANSFER,
        type: "circle",
        source: SUBWAY_SOURCE,
        filter: [
          "all",
          ["==", ["get", "kind"], "station"],
          ["==", ["get", "transfer"], 1],
        ],
        minzoom: 11,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            3.6,
            14,
            5,
            16,
            6,
          ],
          "circle-color": transferFill,
          "circle-stroke-width": 2,
          "circle-stroke-color": transferStroke,
          "circle-opacity": 0.96,
        },
      },
      before,
    );
  }

  if (!map.getLayer(SUBWAY_EXIT_BG)) {
    map.addLayer(
      {
        id: SUBWAY_EXIT_BG,
        type: "circle",
        source: SUBWAY_SOURCE,
        filter: ["==", ["get", "kind"], "exit"],
        minzoom: 16,
        paint: {
          "circle-radius": 8,
          "circle-color": exitFill,
          "circle-stroke-width": 1.2,
          "circle-stroke-color": exitStroke,
          "circle-opacity": 0.94,
        },
      },
      before,
    );
  }

  if (!map.getLayer(SUBWAY_EXIT)) {
    map.addLayer(
      {
        id: SUBWAY_EXIT,
        type: "symbol",
        source: SUBWAY_SOURCE,
        filter: ["==", ["get", "kind"], "exit"],
        minzoom: 16,
        layout: {
          "text-field": ["to-string", ["get", "ref"]],
          "text-font": ["Noto Sans Bold"],
          "text-size": 11,
          "text-allow-overlap": false,
          "text-optional": true,
          "text-padding": 2,
        },
        paint: {
          "text-color": exitText,
          "text-halo-color": exitHalo,
          "text-halo-width": 0.4,
        },
      },
      before,
    );
  }

  // Prefer overlay station dots over flat tile dots
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
