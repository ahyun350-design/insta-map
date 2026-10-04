/**
 * /map-preview style helpers.
 * Production themes live in lib/pindmapMapStyle (paper, white).
 * Lite style is preview-only and never used by public list pages.
 */

import {
  MAP_PREVIEW_THEME_ORDER,
  MAP_PREVIEW_THEMES,
  buildPindmapStyle,
  buildPreviewStyle,
  fetchLibertyStyle,
  parseMapPreviewThemeId,
  type MapPreviewTheme,
  type MapPreviewThemeId,
} from "@/lib/pindmapMapStyle";

export {
  MAP_PREVIEW_THEME_ORDER,
  MAP_PREVIEW_THEMES,
  buildPindmapStyle,
  buildPreviewStyle,
  parseMapPreviewThemeId,
  type MapPreviewTheme,
  type MapPreviewThemeId,
};

const KO_TEXT: unknown = [
  "coalesce",
  ["get", "name:nonlatin"],
  ["get", "name"],
];

type AnyLayer = {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  filter?: unknown;
  minzoom?: number;
  maxzoom?: number;
  source?: string;
  "source-layer"?: string;
  [key: string]: unknown;
};

type StyleJson = {
  version: number;
  name?: string;
  sources: Record<string, unknown>;
  sprite?: string;
  glyphs?: string;
  layers: AnyLayer[];
  [key: string]: unknown;
};

/**
 * Minimal basemap for WKWebView perf isolation:
 * land/water/park + major roads + minor roads (≥z14) + subway/dong labels.
 * No buildings, no fill-extrusion, no POI icons/sprites.
 */
export async function buildLitePreviewStyle(
  themeId: MapPreviewThemeId,
): Promise<StyleJson> {
  const theme = MAP_PREVIEW_THEMES[themeId];
  const liberty = await fetchLibertyStyle();
  const openmaptiles = liberty.sources?.openmaptiles;
  if (!openmaptiles) {
    throw new Error("openmaptiles source missing from liberty style");
  }

  const layers: AnyLayer[] = [
    {
      id: "background",
      type: "background",
      paint: { "background-color": theme.background },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": theme.water },
    },
    {
      id: "park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      filter: ["==", ["get", "class"], "park"],
      paint: { "fill-color": theme.park, "fill-opacity": 0.85 },
    },
    {
      id: "landcover_parkish",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["wood", "grass"]]],
      paint: { "fill-color": theme.park, "fill-opacity": 0.45 },
    },
    {
      id: "road_major",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["motorway", "trunk", "primary", "secondary"]],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": theme.road,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          0.6,
          12,
          1.6,
          16,
          4,
        ],
      },
    },
    {
      id: "road_minor",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 14,
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["tertiary", "minor", "service"]],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": theme.roadMinor,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          0.6,
          18,
          2.2,
        ],
      },
    },
    {
      id: "subway_station_dot",
      type: "circle",
      source: "openmaptiles",
      "source-layer": "poi",
      filter: ["==", ["get", "class"], "rail"],
      minzoom: 12,
      paint: {
        "circle-radius": 3,
        "circle-color": theme.stationDot,
        "circle-opacity": 0.9,
        "circle-stroke-width": 1,
        "circle-stroke-color": theme.textHalo,
      },
    },
    {
      id: "subway_station_label",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      filter: ["==", ["get", "class"], "rail"],
      minzoom: 13,
      layout: {
        "text-field": KO_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-anchor": "top",
        "text-offset": [0, 0.65],
        "text-max-width": 8,
      },
      paint: {
        "text-color": theme.text,
        "text-halo-color": theme.textHalo,
        "text-halo-width": 1.2,
      },
    },
    {
      id: "label_city",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
      minzoom: 5,
      maxzoom: 12,
      layout: {
        "text-field": KO_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": 13,
        "text-max-width": 8,
      },
      paint: {
        "text-color": theme.text,
        "text-halo-color": theme.textHalo,
        "text-halo-width": 1.2,
      },
    },
    {
      id: "label_dong",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["suburb", "neighbourhood"]],
      ],
      minzoom: 12,
      layout: {
        "text-field": KO_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-max-width": 8,
      },
      paint: {
        "text-color": theme.text,
        "text-halo-color": theme.textHalo,
        "text-halo-width": 1.2,
      },
    },
  ];

  return {
    version: 8,
    name: `pindmap-lite-${theme.id}`,
    sources: { openmaptiles },
    glyphs: liberty.glyphs,
    layers,
  };
}
