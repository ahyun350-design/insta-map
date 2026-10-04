/**
 * PindMap MapLibre basemap styles (OpenFreeMap / OpenMapTiles).
 * Production themes: paper, white.
 * Preview-only extras: black, mono, dark (used by /map-preview).
 */

import { seoulGuLabelsGeoJson } from "@/lib/seoulGuLabels";

/** Production-adopted themes */
export type PindmapMapThemeId = "paper" | "white";

/** Includes preview-only themes */
export type MapPreviewThemeId = PindmapMapThemeId | "black" | "mono" | "dark";

export type MapPreviewTheme = {
  id: MapPreviewThemeId;
  label: string;
  background: string;
  land: string;
  water: string;
  park: string;
  building: string;
  /** When false, building fill is hidden (white/black). */
  showBuildings: boolean;
  road: string;
  roadMinor: string;
  rail: string;
  text: string;
  textHalo: string;
  boundary: string;
  stationDot: string;
};

export const PIND_MAP_PRODUCTION_THEMES: PindmapMapThemeId[] = ["paper", "white"];

export const MAP_PREVIEW_THEME_ORDER: MapPreviewThemeId[] = [
  "paper",
  "white",
  "black",
  "mono",
  "dark",
];

export function parseMapPreviewThemeId(
  raw: string | null | undefined,
): MapPreviewThemeId {
  if (
    raw === "paper" ||
    raw === "white" ||
    raw === "black" ||
    raw === "mono" ||
    raw === "dark"
  ) {
    return raw;
  }
  return "paper";
}

/** Production list pages: only paper | white */
export function parsePindmapMapThemeId(
  raw: string | null | undefined,
): PindmapMapThemeId {
  return raw === "white" ? "white" : "paper";
}

export const MAP_PREVIEW_THEMES: Record<MapPreviewThemeId, MapPreviewTheme> = {
  paper: {
    id: "paper",
    label: "페이퍼",
    background: "#F3EEE4",
    land: "#F3EEE4",
    water: "#C9DCE8",
    park: "#D5E6C6",
    building: "#E8E0D2",
    showBuildings: true,
    road: "#FFFFFF",
    roadMinor: "#FFFEFA",
    rail: "#D0C8BA",
    text: "#6A5B4E",
    textHalo: "#F3EEE4",
    boundary: "#D2C8B8",
    stationDot: "#6A5B4E",
  },
  white: {
    id: "white",
    label: "화이트",
    background: "#FFFFFF",
    land: "#FFFFFF",
    water: "#E6E6E6",
    park: "#F4F4F4",
    building: "#FFFFFF",
    showBuildings: false,
    // Slightly darker lines for major roads; minor barely visible
    road: "#D8D8D8",
    roadMinor: "#EFEFEF",
    rail: "#E0E0E0",
    text: "#757575",
    textHalo: "#FFFFFF",
    boundary: "#E8E8E8",
    stationDot: "#555555",
  },
  black: {
    id: "black",
    label: "블랙",
    background: "#0B0B0B",
    land: "#0B0B0B",
    water: "#141414",
    park: "#0F0F0F",
    building: "#0B0B0B",
    showBuildings: false,
    road: "#3A3A3A",
    roadMinor: "#222222",
    rail: "#1C1C1C",
    text: "#C8C8C8",
    textHalo: "#0B0B0B",
    boundary: "#222222",
    stationDot: "#D0D0D0",
  },
  mono: {
    id: "mono",
    label: "모노",
    background: "#E9E9E9",
    land: "#E9E9E9",
    water: "#BEBEBE",
    park: "#D5D8D2",
    building: "#DDDDDD",
    showBuildings: true,
    road: "#FFFFFF",
    roadMinor: "#FAFAFA",
    rail: "#C8C8C8",
    text: "#555555",
    textHalo: "#E9E9E9",
    boundary: "#C5C5C5",
    stationDot: "#555555",
  },
  dark: {
    id: "dark",
    label: "다크",
    background: "#0E1A30",
    land: "#0E1A30",
    water: "#081022",
    park: "#13243F",
    building: "#182743",
    showBuildings: true,
    road: "#2A3F5E",
    roadMinor: "#223552",
    rail: "#1C2C48",
    text: "#C9CED8",
    textHalo: "#0E1A30",
    boundary: "#2A3A55",
    stationDot: "#C9CED8",
  },
};

const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const HIDE_LAYER_IDS = new Set([
  "natural_earth",
  "poi_r20",
  "poi_r7",
  "poi_r1",
  // airport kept visible (guide label) — shop/POI icons stay hidden via poi_* above
  "road_one_way_arrow",
  "road_one_way_arrow_opposite",
  "highway-shield-non-us",
  "highway-shield-us-interstate",
  "road_shield_us",
  "building-3d",
  "label_country_1",
  "label_country_2",
  "label_country_3",
  "label_state",
  "label_city_capital",
  "label_village",
]);

/** Prefer Korean name fields from OpenMapTiles. */
const KO_TEXT: unknown = [
  "coalesce",
  ["get", "name:ko"],
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
  [key: string]: unknown;
};

type StyleJson = {
  version: number;
  sources: Record<string, unknown>;
  sprite?: string;
  glyphs?: string;
  layers: AnyLayer[];
  [key: string]: unknown;
};

let cachedLiberty: StyleJson | null = null;

export async function fetchLibertyStyle(): Promise<StyleJson> {
  if (cachedLiberty) {
    return structuredClone(cachedLiberty);
  }
  const res = await fetch(LIBERTY_STYLE_URL);
  if (!res.ok) {
    throw new Error(`OpenFreeMap style fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as StyleJson;
  cachedLiberty = json;
  return structuredClone(json);
}

function setVisibility(layer: AnyLayer, visible: boolean) {
  layer.layout = { ...(layer.layout || {}), visibility: visible ? "visible" : "none" };
}

function paintSet(layer: AnyLayer, key: string, value: unknown) {
  layer.paint = { ...(layer.paint || {}), [key]: value };
}

function isCasing(id: string) {
  return id.includes("_casing") || id.endsWith("-casing");
}

function isRoadFill(id: string) {
  return (
    (id.startsWith("road_") || id.startsWith("bridge_") || id.startsWith("tunnel_")) &&
    !isCasing(id) &&
    !id.includes("rail") &&
    !id.includes("arrow") &&
    !id.includes("pattern")
  );
}

function isRail(id: string) {
  return id.includes("rail");
}

export async function buildPindmapStyle(themeId: MapPreviewThemeId): Promise<StyleJson> {
  const theme = MAP_PREVIEW_THEMES[themeId];
  const style = await fetchLibertyStyle();
  const layers: AnyLayer[] = [];

  for (const raw of style.layers) {
    const layer: AnyLayer = { ...raw, layout: { ...(raw.layout || {}) }, paint: { ...(raw.paint || {}) } };

    if (HIDE_LAYER_IDS.has(layer.id) || isCasing(layer.id)) {
      setVisibility(layer, false);
      layers.push(layer);
      continue;
    }

    if (layer.id === "background") {
      paintSet(layer, "background-color", theme.background);
    }

    if (layer.id === "water" || layer.id.startsWith("waterway_")) {
      if (layer.type === "fill") paintSet(layer, "fill-color", theme.water);
      if (layer.type === "line") paintSet(layer, "line-color", theme.water);
    }

    if (
      layer.id === "park" ||
      layer.id.startsWith("landcover_") ||
      layer.id.startsWith("landuse_")
    ) {
      if (layer.type === "fill") {
        if (layer.id === "park" || layer.id.includes("wood") || layer.id.includes("grass")) {
          paintSet(layer, "fill-color", theme.park);
        } else if (layer.id.includes("sand") || layer.id.includes("ice")) {
          paintSet(layer, "fill-color", theme.land);
        } else {
          paintSet(layer, "fill-color", theme.land);
        }
        paintSet(layer, "fill-opacity", layer.id === "park" ? 0.85 : 0.55);
      }
      if (layer.id === "park_outline") {
        paintSet(layer, "line-color", theme.park);
        paintSet(layer, "line-opacity", 0.35);
      }
    }

    if (layer.id === "building") {
      if (!theme.showBuildings) {
        setVisibility(layer, false);
      } else {
        paintSet(layer, "fill-color", theme.building);
        paintSet(layer, "fill-opacity", 0.9);
        layer.minzoom = 14;
        delete layer.maxzoom;
      }
    }

    if (isRoadFill(layer.id) || layer.id === "road_area_pattern" || layer.id.startsWith("aeroway_")) {
      if (layer.type === "line") {
        const minor =
          layer.id.includes("path") ||
          layer.id.includes("pedestrian") ||
          layer.id.includes("service") ||
          layer.id.includes("minor") ||
          layer.id.includes("track");
        const major =
          layer.id.includes("motorway") ||
          layer.id.includes("trunk") ||
          layer.id.includes("primary") ||
          layer.id.includes("secondary");
        // Major: slightly thicker warm tint; minor/일반: near-white (theme.road)
        const majorWarm =
          theme.id === "black" || theme.id === "dark" ? "#4a3f35" : "#E8D5BF";
        paintSet(layer, "line-color", minor ? theme.roadMinor : major ? majorWarm : theme.road);
        paintSet(layer, "line-opacity", major ? 0.95 : 1);
        if (major && layer.paint && typeof layer.paint["line-width"] !== "undefined") {
          /* keep liberty width ramp; nudge via multiplier where numeric */
        }
      }
      if (layer.type === "fill") {
        paintSet(layer, "fill-color", theme.road);
      }
    }

    if (isRail(layer.id)) {
      if (layer.type === "line") {
        paintSet(layer, "line-color", theme.rail);
        paintSet(layer, "line-opacity", 0.55);
      }
    }

    if (layer.id.startsWith("boundary")) {
      paintSet(layer, "line-color", theme.boundary);
      paintSet(layer, "line-opacity", 0.45);
    }

    // Labels — Korean only + zoom ladder
    if (layer.type === "symbol") {
      if (layer.layout?.["text-field"] != null) {
        layer.layout["text-field"] = KO_TEXT;
        layer.layout["text-font"] = ["Noto Sans Regular"];
      }
      paintSet(layer, "text-color", theme.text);
      paintSet(layer, "text-halo-color", theme.textHalo);
      paintSet(layer, "text-halo-width", 1.2);

      if (layer.id.startsWith("water")) {
        layer.minzoom = 10;
      }
      // 시 이름: z8 이하 위주 (city/town). 구 스케일에서는 숨겨 겹침 감소.
      if (layer.id === "label_city" || layer.id === "label_town") {
        layer.minzoom = 5;
        layer.maxzoom = 9;
        paintSet(layer, "text-color", theme.text);
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.4);
      }
      if (layer.id === "label_other") {
        // Seoul tiles: 구=borough (z14), 동=quarter (z14). suburb≠구.
        setVisibility(layer, false);
        layers.push(layer);
        layers.push({
          id: "label_borough_ko",
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "place",
          filter: ["==", ["get", "class"], "borough"],
          minzoom: 13,
          maxzoom: 16,
          layout: {
            "text-field": KO_TEXT,
            "text-font": ["Noto Sans Regular"],
            "text-size": 13,
            "text-max-width": 8,
            visibility: "visible",
          },
          paint: {
            "text-color": theme.text,
            "text-halo-color": theme.textHalo,
            "text-halo-width": 1.4,
          },
        });
        layers.push({
          id: "label_dong_ko",
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "place",
          filter: ["match", ["get", "class"], ["quarter", "neighbourhood"], true, false],
          minzoom: 13,
          layout: {
            "text-field": KO_TEXT,
            "text-font": ["Noto Sans Regular"],
            "text-size": 12,
            "text-max-width": 8,
            visibility: "visible",
          },
          paint: {
            "text-color": theme.text,
            "text-halo-color": theme.textHalo,
            "text-halo-width": 1.3,
          },
        });
        continue;
      }
      if (layer.id.startsWith("highway-name")) {
        // 주요 도로 이름 z13+, 방패/번호는 HIDE
        if (layer.id.includes("major")) layer.minzoom = 13;
        else if (layer.id.includes("minor")) layer.minzoom = 15.2;
        else layer.minzoom = 16;
      }
      // 다리 이름 (한강 다리 등)
      if (layer.id.includes("bridge") && layer.type === "symbol") {
        layer.minzoom = 12;
        paintSet(layer, "text-color", theme.text);
        paintSet(layer, "text-halo-color", theme.textHalo);
      }
      if (layer.id === "airport" || layer.id.startsWith("airport")) {
        setVisibility(layer, true);
        layer.minzoom = 9;
        const layout = { ...(layer.layout || {}) };
        layout["text-field"] = KO_TEXT;
        layout["text-font"] = ["Noto Sans Regular"];
        layout["text-size"] = 12;
        delete layout["icon-image"];
        layer.layout = layout;
        paintSet(layer, "text-color", theme.text);
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.3);
      }
      if (layer.id === "poi_transit") {
        layer.filter = [
          "any",
          ["==", ["get", "class"], "rail"],
          ["==", ["get", "class"], "railway"],
        ];
        layer.minzoom = 12;
        const layout = { ...(layer.layout || {}) };
        delete layout["icon-image"];
        delete layout["icon-size"];
        layout["text-anchor"] = "top";
        layout["text-offset"] = [0, 0.55];
        layout["text-size"] = 11;
        layout["text-field"] = KO_TEXT;
        layer.layout = layout;
      }
      // 큰 공원·산
      if (layer.id.includes("park_label") || layer.id === "label_park") {
        layer.minzoom = 11;
      }
      if (layer.id.includes("mountain") || layer.id.includes("peak")) {
        layer.minzoom = 11;
        paintSet(layer, "text-color", theme.text);
        paintSet(layer, "text-halo-color", theme.textHalo);
      }
    }

    layers.push(layer);

    if (layer.id === "poi_transit") {
      layers.splice(layers.length - 1, 0, {
        id: "subway_station_dot",
        type: "circle",
        source: "openmaptiles",
        "source-layer": "poi",
        filter: [
          "any",
          ["==", ["get", "class"], "rail"],
          ["==", ["get", "class"], "railway"],
        ],
        minzoom: 12,
        paint: {
          "circle-radius": 2.6,
          "circle-color": theme.stationDot,
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": theme.textHalo,
        },
      });
    }
  }

  // 구 이름 z9–13: tiles lack borough until z14 → static Seoul overlay
  style.sources = {
    ...style.sources,
    seoul_gu_labels: {
      type: "geojson",
      data: seoulGuLabelsGeoJson(),
    },
  };
  layers.push({
    id: "label_seoul_gu_overlay",
    type: "symbol",
    source: "seoul_gu_labels",
    minzoom: 9,
    maxzoom: 13.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 13,
      "text-max-width": 8,
      visibility: "visible",
    },
    paint: {
      "text-color": theme.text,
      "text-halo-color": theme.textHalo,
      "text-halo-width": 1.4,
    },
  });

  // transportation_name bridge labels if liberty didn't already expose them
  layers.push({
    id: "label_bridge_ko",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "transportation_name",
    minzoom: 12,
    filter: ["==", ["get", "brunnel"], "bridge"],
    layout: {
      "text-field": KO_TEXT,
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "symbol-placement": "line",
      "text-max-angle": 30,
      visibility: "visible",
    },
    paint: {
      "text-color": theme.text,
      "text-halo-color": theme.textHalo,
      "text-halo-width": 1.2,
    },
  });

  style.layers = layers;
  style.name = `pindmap-${theme.id}`;
  return style;
}


/** @deprecated alias — prefer buildPindmapStyle */
export const buildPreviewStyle = buildPindmapStyle;
