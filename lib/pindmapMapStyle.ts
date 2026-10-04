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
    background: "#F7F5F0",
    land: "#F7F5F0",
    water: "#BFDDF2",
    park: "#DCEAD0",
    building: "#EEEAE2",
    showBuildings: true,
    road: "#FFFFFF",
    roadMinor: "#FFFFFF",
    rail: "#C5C0B8",
    text: "#3A4155",
    textHalo: "#FFFFFF",
    boundary: "#D8D2C8",
    stationDot: "#3A4155",
  },
  white: {
    id: "white",
    label: "화이트",
    background: "#FFFFFF",
    land: "#FFFFFF",
    water: "#DCE6EE",
    park: "#EEF2EC",
    building: "#F3F3F3",
    showBuildings: true,
    road: "#FFFFFF",
    roadMinor: "#FAFAFA",
    rail: "#D0D0D0",
    text: "#3A4155",
    textHalo: "#FFFFFF",
    boundary: "#E0E0E0",
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

    if (HIDE_LAYER_IDS.has(layer.id)) {
      setVisibility(layer, false);
      layers.push(layer);
      continue;
    }

    const useGuideRoads = theme.id === "paper" || theme.id === "white";
    const roadCasing = theme.id === "white" ? "#E8E8E8" : "#E6E1D6";
    const majorFill = theme.id === "white" ? "#F0F0F0" : "#FBEBC2";
    const majorCasing = theme.id === "white" ? "#D8D8D8" : "#EBD9A6";
    const woodFill = theme.id === "white" ? "#F5F7F3" : "#E8F0E0";
    const buildingOutline = theme.id === "white" ? "#E6E6E6" : "#E2DDD2";

    if (isCasing(layer.id)) {
      if (!useGuideRoads) {
        setVisibility(layer, false);
        layers.push(layer);
        continue;
      }
      const major =
        layer.id.includes("motorway") ||
        layer.id.includes("trunk") ||
        layer.id.includes("primary") ||
        layer.id.includes("secondary");
      if (layer.type === "line") {
        paintSet(layer, "line-color", major ? majorCasing : roadCasing);
        paintSet(layer, "line-opacity", 1);
        // Keep liberty width; ensure visible from z6 for motorway casing
        if (layer.id.includes("motorway") || layer.id.includes("trunk")) {
          layer.minzoom = Math.min(layer.minzoom ?? 6, 6);
        }
      }
      setVisibility(layer, true);
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
        if (layer.id.includes("wood") || layer.id.includes("forest")) {
          paintSet(layer, "fill-color", woodFill);
          paintSet(layer, "fill-opacity", 0.7);
        } else if (layer.id === "park" || layer.id.includes("grass")) {
          paintSet(layer, "fill-color", theme.park);
          paintSet(layer, "fill-opacity", 0.9);
        } else if (layer.id.includes("sand") || layer.id.includes("ice")) {
          paintSet(layer, "fill-color", theme.land);
          paintSet(layer, "fill-opacity", 0.5);
        } else {
          paintSet(layer, "fill-color", theme.land);
          paintSet(layer, "fill-opacity", 0.4);
        }
      }
      if (layer.id === "park_outline") {
        paintSet(layer, "line-color", theme.park);
        paintSet(layer, "line-opacity", 0.4);
      }
    }

    if (layer.id === "building") {
      if (!theme.showBuildings) {
        setVisibility(layer, false);
      } else {
        paintSet(layer, "fill-color", theme.building);
        paintSet(layer, "fill-opacity", 0.95);
        paintSet(layer, "fill-outline-color", buildingOutline);
        layer.minzoom = 15;
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
        const highway =
          layer.id.includes("motorway") || layer.id.includes("trunk");
        if (useGuideRoads) {
          paintSet(
            layer,
            "line-color",
            minor ? theme.roadMinor : major ? majorFill : theme.road,
          );
          paintSet(layer, "line-opacity", 1);
          if (highway) {
            // Low-zoom thin highways so national view isn't empty land
            layer.minzoom = Math.min(layer.minzoom ?? 6, 6);
          }
        } else {
          paintSet(layer, "line-color", minor ? theme.roadMinor : theme.road);
          paintSet(layer, "line-opacity", 1);
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
      paintSet(layer, "line-opacity", 0.55);
      if (useGuideRoads && layer.type === "line") {
        paintSet(layer, "line-dasharray", [2, 2]);
        layer.minzoom = Math.min(layer.minzoom ?? 4, 4);
      }
    }

    // Labels — Korean only + zoom ladder
    if (layer.type === "symbol") {
      if (layer.layout?.["text-field"] != null) {
        layer.layout["text-field"] = KO_TEXT;
        layer.layout["text-font"] = ["Noto Sans Regular"];
      }
      paintSet(layer, "text-color", theme.text);
      paintSet(layer, "text-halo-color", theme.textHalo);
      paintSet(layer, "text-halo-width", 1.5);

      if (layer.id.startsWith("water") && layer.type === "symbol") {
        layer.minzoom = 10;
        paintSet(layer, "text-color", theme.id === "white" ? "#6A8FA8" : "#4A8BB8");
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.5);
        if (layer.layout) {
          layer.layout["text-font"] = ["Noto Sans Regular"];
        }
      }
      // 시 이름: z8 이하 위주 — 굵고 크게
      if (layer.id === "label_city" || layer.id === "label_town") {
        layer.minzoom = 5;
        layer.maxzoom = 9;
        paintSet(layer, "text-color", theme.text);
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.5);
        if (layer.layout) {
          layer.layout["text-font"] = ["Noto Sans Bold"];
          layer.layout["text-size"] = layer.id === "label_city" ? 15 : 13;
        }
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
            "text-font": ["Noto Sans Bold"],
            "text-size": 13,
            "text-letter-spacing": 0.06,
            "text-max-width": 8,
            visibility: "visible",
          },
          paint: {
            "text-color": theme.text,
            "text-halo-color": theme.textHalo,
            "text-halo-width": 1.5,
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
            "text-halo-width": 1.5,
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
        paintSet(layer, "text-color", theme.id === "white" ? "#5A7A58" : "#4F7A4A");
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.5);
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
      "text-font": ["Noto Sans Bold"],
      "text-size": 13,
      "text-letter-spacing": 0.08,
      "text-max-width": 8,
      visibility: "visible",
    },
    paint: {
      "text-color": theme.text,
      "text-halo-color": theme.textHalo,
      "text-halo-width": 1.5,
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
