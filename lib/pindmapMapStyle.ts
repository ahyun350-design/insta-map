/**
 * PindMap MapLibre basemap styles (OpenFreeMap / OpenMapTiles).
 * Production themes: paper, white.
 * Admin MapLibre + preview: neon.
 * Preview-only extras: black, mono, dark (used by /map-preview).
 */

import { koreaGuLabelsGeoJson } from "@/lib/koreaGuLabels";

/** Production-adopted themes */
export type PindmapMapThemeId = "paper" | "white";

/** Includes preview-only themes */
export type MapPreviewThemeId = PindmapMapThemeId | "neon" | "black" | "mono" | "dark";

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
  "neon",
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
    raw === "neon" ||
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
  neon: {
    id: "neon",
    label: "네온",
    // Accent point color from CourseMapDesignOverlay pin: #F0E4C3
    background: "#0E1230",
    land: "#0E1230",
    water: "#0A142C",
    park: "#0D2A2A",
    building: "#1A2250",
    showBuildings: true,
    road: "#3A45A0",
    roadMinor: "#262D66",
    rail: "#1E2858",
    text: "#C9CEF5",
    textHalo: "#0E1230",
    boundary: "#2A3366",
    stationDot: "#C9CEF5",
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

/**
 * Guide landmarks from OpenMapTiles `poi` (commercial shop/cafe/restaurant stay hidden).
 * Color groups: culture | medical | transit (2–3 calm tones).
 */
const LANDMARK_FILTER: unknown = [
  "any",
  // 대학교
  [
    "all",
    ["==", ["get", "class"], "college"],
    ["==", ["get", "subclass"], "university"],
  ],
  // 종합병원 (clinic/의원 제외)
  [
    "all",
    ["==", ["get", "class"], "hospital"],
    ["==", ["get", "subclass"], "hospital"],
  ],
  // 백화점·대형몰
  [
    "all",
    ["==", ["get", "class"], "shop"],
    ["==", ["get", "subclass"], "mall"],
  ],
  [
    "all",
    ["==", ["get", "class"], "grocery"],
    ["==", ["get", "subclass"], "department_store"],
  ],
  // 시청·구청 (주민센터/경로당 community_centre 제외)
  [
    "all",
    ["==", ["get", "class"], "town_hall"],
    ["==", ["get", "subclass"], "townhall"],
  ],
  // 박물관·미술관
  ["all", ["==", ["get", "class"], "museum"], ["==", ["get", "subclass"], "museum"]],
  [
    "all",
    ["==", ["get", "class"], "art_gallery"],
    ["match", ["get", "subclass"], ["gallery", "arts_centre"], true, false],
  ],
  // 경기장·궁·관광명소
  ["==", ["get", "class"], "stadium"],
  ["==", ["get", "class"], "castle"],
  ["==", ["get", "class"], "attraction"],
  // 기차역·버스터미널 (지하철역은 subway_* 레이어)
  [
    "all",
    ["==", ["get", "class"], "railway"],
    ["==", ["get", "subclass"], "station"],
  ],
  [
    "all",
    ["==", ["get", "class"], "bus"],
    ["==", ["get", "subclass"], "bus_station"],
  ],
];

/** OpenMapTiles rank is ascending importance within a grid cell (1 = top). */
function landmarkRankMaxExpr(z12Max: number, z14Max: number, z16Max: number): unknown {
  return [
    "step",
    ["zoom"],
    z12Max,
    14,
    z14Max,
    15.5,
    z16Max,
  ];
}

function landmarkGroupColor(theme: MapPreviewTheme): unknown {
  const culture =
    theme.id === "neon" ? "#A8B0E0" : theme.id === "white" ? "#5A6A88" : "#5A6B8C";
  const medical =
    theme.id === "neon" ? "#D4A0A8" : theme.id === "white" ? "#9A6A6A" : "#A66B6B";
  const transit =
    theme.id === "neon" ? "#7AB8A0" : theme.id === "white" ? "#4A7A68" : "#3A6B5A";
  return [
    "case",
    [
      "any",
      ["all", ["==", ["get", "class"], "hospital"], ["==", ["get", "subclass"], "hospital"]],
    ],
    medical,
    [
      "any",
      ["all", ["==", ["get", "class"], "railway"], ["==", ["get", "subclass"], "station"]],
      ["all", ["==", ["get", "class"], "bus"], ["==", ["get", "subclass"], "bus_station"]],
    ],
    transit,
    culture,
  ];
}

function appendLandmarkLayers(layers: AnyLayer[], theme: MapPreviewTheme): void {
  const color = landmarkGroupColor(theme);
  const rankMax = landmarkRankMaxExpr(2, 6, 14);
  const filter: unknown = [
    "all",
    LANDMARK_FILTER,
    ["has", "name"],
    ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], rankMax],
  ];
  // Higher sort-key wins placement → invert OMT rank
  const sortKey: unknown = ["-", 1000, ["to-number", ["coalesce", ["get", "rank"], 999]]];

  layers.push({
    id: "landmark_dot",
    type: "circle",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 12,
    filter,
    layout: {
      visibility: "visible",
    },
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        12,
        2.2,
        14,
        2.8,
        16,
        3.2,
      ],
      "circle-color": color,
      "circle-opacity": theme.id === "neon" ? 0.92 : 0.88,
      "circle-stroke-width": 1,
      "circle-stroke-color": theme.textHalo,
      // MapLibre 4.x has no circle-sort-key (symbol-sort-key only). Invalid paint aborts style load.
    },
  });

  layers.push({
    id: "landmark_label",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 12,
    filter,
    layout: {
      visibility: "visible",
      "text-field": KO_TEXT,
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        12,
        10.5,
        14,
        11.5,
        16,
        12.5,
      ],
      "text-anchor": "left",
      "text-offset": [0.7, 0],
      "text-max-width": 8,
      "text-padding": 2,
      "text-optional": true,
      "icon-optional": true,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": sortKey,
      "symbol-z-order": "source",
    },
    paint: {
      "text-color": color,
      "text-halo-color": theme.textHalo,
      "text-halo-width": theme.id === "neon" ? 1.6 : 1.4,
      "text-halo-blur": 0.2,
    },
  });
}

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

/** Drop in-memory liberty cache after a style/load failure so the next attempt refetches. */
export function invalidateLibertyStyleCache(): void {
  cachedLiberty = null;
}

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

/** Strip metro suffixes for compact city labels (keep plain "…시"). */
const SHORT_CITY_KO: unknown = [
  "let",
  "n",
  ["to-string", ["coalesce", ["get", "name:ko"], ["get", "name:nonlatin"], ["get", "name"], ""]],
  [
    "case",
    [
      "==",
      ["slice", ["var", "n"], ["-", ["length", ["var", "n"]], 5]],
      "특별자치시",
    ],
    ["slice", ["var", "n"], 0, ["-", ["length", ["var", "n"]], 5]],
    [
      "==",
      ["slice", ["var", "n"], ["-", ["length", ["var", "n"]], 5]],
      "특별자치도",
    ],
    ["slice", ["var", "n"], 0, ["-", ["length", ["var", "n"]], 5]],
    [
      "==",
      ["slice", ["var", "n"], ["-", ["length", ["var", "n"]], 3]],
      "광역시",
    ],
    ["slice", ["var", "n"], 0, ["-", ["length", ["var", "n"]], 3]],
    [
      "==",
      ["slice", ["var", "n"], ["-", ["length", ["var", "n"]], 3]],
      "특별시",
    ],
    ["slice", ["var", "n"], 0, ["-", ["length", ["var", "n"]], 3]],
    ["var", "n"],
  ],
];

type RoadKind =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "minor"
  | "service"
  | "link"
  | "path"
  | "other";

function cloneLayer(layer: AnyLayer): AnyLayer {
  return {
    ...layer,
    layout: { ...(layer.layout || {}) },
    paint: { ...(layer.paint || {}) },
    filter: layer.filter ? structuredClone(layer.filter) : layer.filter,
  };
}

function andFilter(existing: unknown, extra: unknown): unknown {
  if (!existing) return extra;
  return ["all", existing, extra];
}

function withRoadClass(layer: AnyLayer, className: string, suffix: string): AnyLayer {
  const next = cloneLayer(layer);
  next.id = `${layer.id}__${suffix}`;
  next.filter = andFilter(next.filter, ["==", ["get", "class"], className]);
  return next;
}

function roadMinZoom(kind: RoadKind): number {
  switch (kind) {
    case "motorway":
      return 6;
    case "trunk":
    case "primary":
      return 9;
    case "secondary":
      return 11;
    case "tertiary":
      return 13;
    case "link":
      return 12;
    case "minor":
    case "service":
      return 14;
    case "path":
      return 15;
    default:
      return 14;
  }
}

function roadFillWidth(kind: RoadKind): unknown {
  // ~30% thinner than Liberty defaults; smooth zoom interpolation.
  switch (kind) {
    case "motorway":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        6,
        0.6,
        8,
        1.0,
        10,
        1.5,
        14,
        4.2,
        18,
        11,
      ];
    case "trunk":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        9,
        1.0,
        12,
        2.0,
        16,
        7,
        18,
        10,
      ];
    case "primary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        9,
        0.8,
        10,
        1.2,
        14,
        3.0,
        18,
        8,
      ];
    case "secondary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        11,
        0.7,
        14,
        2.2,
        18,
        6.5,
      ];
    case "tertiary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        13,
        0.6,
        15,
        1.7,
        18,
        5,
      ];
    case "link":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        12,
        0.5,
        14,
        1.4,
        18,
        5.5,
      ];
    case "minor":
    case "service":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        0.5,
        16,
        1.6,
        18,
        4.2,
      ];
    case "path":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        15,
        0.4,
        18,
        2.5,
      ];
    default:
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        0.5,
        18,
        4,
      ];
  }
}

function roadCasingWidth(kind: RoadKind): unknown {
  switch (kind) {
    case "motorway":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        6,
        1.15,
        8,
        1.7,
        10,
        2.4,
        14,
        5.6,
        18,
        13,
      ];
    case "trunk":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        9,
        1.6,
        12,
        2.9,
        16,
        8.5,
        18,
        12,
      ];
    case "primary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        9,
        1.35,
        10,
        1.85,
        14,
        4.2,
        18,
        10,
      ];
    case "secondary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        11,
        1.2,
        14,
        3.2,
        18,
        8,
      ];
    case "tertiary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        13,
        1.05,
        15,
        2.5,
        18,
        6.5,
      ];
    case "link":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        12,
        1.0,
        14,
        2.2,
        18,
        7,
      ];
    case "minor":
    case "service":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        0.9,
        16,
        2.4,
        18,
        5.5,
      ];
    case "path":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        15,
        0.8,
        18,
        3.5,
      ];
    default:
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        0.9,
        18,
        5,
      ];
  }
}

function roadFillColor(
  theme: MapPreviewTheme,
  kind: RoadKind,
): string {
  const yellow = kind === "motorway" || kind === "trunk";
  if (theme.id === "paper") {
    if (yellow) return "#FAF0D4";
    return theme.road;
  }
  if (theme.id === "white") {
    if (yellow) return "#EDEDED";
    return theme.road;
  }
  if (theme.id === "neon") {
    // 간선(motorway/trunk/primary) → road; 일반·소로 → roadMinor
    if (yellow || kind === "primary") return theme.road;
    return theme.roadMinor;
  }
  return kind === "path" || kind === "minor" || kind === "service"
    ? theme.roadMinor
    : theme.road;
}

function roadCasingColor(
  theme: MapPreviewTheme,
  kind: RoadKind,
): string {
  const yellow = kind === "motorway" || kind === "trunk";
  if (theme.id === "paper") {
    return yellow ? "#EFE2B8" : "#E6E1D6";
  }
  if (theme.id === "white") {
    return yellow ? "#E0E0E0" : "#E8E8E8";
  }
  if (theme.id === "neon") {
    return yellow ? "#2E3878" : "#1A2250";
  }
  return theme.boundary;
}

function applyGuideRoadStyle(
  layer: AnyLayer,
  theme: MapPreviewTheme,
  kind: RoadKind,
  casing: boolean,
) {
  layer.minzoom = Math.max(layer.minzoom ?? 0, roadMinZoom(kind));
  if (layer.type === "line") {
    paintSet(layer, "line-color", casing ? roadCasingColor(theme, kind) : roadFillColor(theme, kind));
    paintSet(layer, "line-opacity", 1);
    paintSet(layer, "line-width", casing ? roadCasingWidth(kind) : roadFillWidth(kind));
  }
  setVisibility(layer, true);
}

function expandCombinedRoadLayers(
  layer: AnyLayer,
  theme: MapPreviewTheme,
  casing: boolean,
): AnyLayer[] | null {
  const id = layer.id;
  if (id.includes("trunk_primary")) {
    const trunk = withRoadClass(layer, "trunk", "trunk");
    const primary = withRoadClass(layer, "primary", "primary");
    applyGuideRoadStyle(trunk, theme, "trunk", casing);
    applyGuideRoadStyle(primary, theme, "primary", casing);
    return [trunk, primary];
  }
  if (id.includes("secondary_tertiary")) {
    const secondary = withRoadClass(layer, "secondary", "secondary");
    const tertiary = withRoadClass(layer, "tertiary", "tertiary");
    applyGuideRoadStyle(secondary, theme, "secondary", casing);
    applyGuideRoadStyle(tertiary, theme, "tertiary", casing);
    return [secondary, tertiary];
  }
  return null;
}

function detectRoadKind(id: string): RoadKind {
  if (id.includes("motorway") && id.includes("link")) return "link";
  if (id.includes("motorway")) return "motorway";
  if (id.includes("trunk")) return "trunk";
  if (id.includes("primary")) return "primary";
  if (id.includes("secondary")) return "secondary";
  if (id.includes("tertiary")) return "tertiary";
  if (id.includes("link")) return "link";
  if (id.includes("path") || id.includes("pedestrian")) return "path";
  if (id.includes("service") || id.includes("track")) return "service";
  if (id.includes("minor") || id.includes("street")) return "minor";
  return "other";
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

    const useGuideRoads = theme.id === "paper" || theme.id === "white" || theme.id === "neon";
    const woodFill =
      theme.id === "white"
        ? "#F5F7F3"
        : theme.id === "neon"
          ? "#0A2424"
          : "#E8F0E0";
    const buildingOutline =
      theme.id === "white"
        ? "#E6E6E6"
        : theme.id === "neon"
          ? "#242C5C"
          : "#E2DDD2";

    if (isCasing(layer.id)) {
      if (!useGuideRoads) {
        setVisibility(layer, false);
        layers.push(layer);
        continue;
      }
      const expanded = expandCombinedRoadLayers(layer, theme, true);
      if (expanded) {
        layers.push(...expanded);
        continue;
      }
      const kind = detectRoadKind(layer.id);
      applyGuideRoadStyle(layer, theme, kind, true);
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
      if (layer.type === "line" && useGuideRoads && (isRoadFill(layer.id) || layer.id.startsWith("aeroway_"))) {
        if (isRoadFill(layer.id)) {
          const expanded = expandCombinedRoadLayers(layer, theme, false);
          if (expanded) {
            layers.push(...expanded);
            continue;
          }
          const kind = detectRoadKind(layer.id);
          applyGuideRoadStyle(layer, theme, kind, false);
          layers.push(layer);
          continue;
        }
      }
      if (layer.type === "line") {
        const minor =
          layer.id.includes("path") ||
          layer.id.includes("pedestrian") ||
          layer.id.includes("service") ||
          layer.id.includes("minor") ||
          layer.id.includes("track");
        paintSet(layer, "line-color", minor ? theme.roadMinor : theme.road);
        paintSet(layer, "line-opacity", 1);
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
        paintSet(layer, "text-color", theme.id === "white" ? "#6A8FA8" : theme.id === "neon" ? "#8AA0D8" : "#4A8BB8");
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.5);
        if (layer.layout) {
          layer.layout["text-font"] = ["Noto Sans Italic"];
          if (layer.id === "water_name_point_label") {
            layer.layout["text-size"] = [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              9,
              8,
              12,
            ];
          } else {
            layer.layout["text-size"] = 12;
          }
        }
      }
      // 시 이름: 접미사 제거, 2단계 축소, Regular(medium 대체)
      if (layer.id === "label_city" || layer.id === "label_town") {
        layer.minzoom = layer.id === "label_city" ? 5 : 6;
        layer.maxzoom = 9;
        paintSet(layer, "text-color", theme.text);
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.5);
        if (layer.layout) {
          layer.layout["text-field"] = SHORT_CITY_KO;
          layer.layout["text-font"] = ["Noto Sans Regular"];
          layer.layout["text-size"] =
            layer.id === "label_city"
              ? ["interpolate", ["exponential", 1.2], ["zoom"], 4, 10, 7, 12, 11, 14]
              : ["interpolate", ["exponential", 1.2], ["zoom"], 7, 10, 11, 12];
          layer.layout["icon-size"] = 0.45;
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
            "text-font": ["Noto Sans Regular"],
            "text-size": 12.5,
            "text-letter-spacing": 0.06,
            "text-max-width": 8,
            visibility: "visible",
          },
          paint: {
            "text-color": theme.id === "neon" ? "#A8B0E0" : "#4A5166",
            "text-halo-color": theme.textHalo,
            "text-halo-width": 1.2,
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
            "text-size": 11,
            "text-max-width": 8,
            visibility: "visible",
          },
          paint: {
            "text-color": theme.id === "neon" ? "#8E96C8" : "#6A7185",
            "text-halo-color": theme.textHalo,
            "text-halo-width": 1.1,
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
        // International airports only (IATA present). Hide small airfields/heliports.
        layer.filter = [
          "all",
          ["has", "iata"],
          ["!=", ["to-string", ["coalesce", ["get", "iata"], ""]], ""],
        ];
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
        // OpenFreeMap POI: subway/train stops are class=railway (subclass subway|station).
        // Liberty style historically used class=rail — keep both.
        layer.filter = [
          "all",
          [
            "any",
            ["==", ["get", "class"], "rail"],
            ["==", ["get", "class"], "railway"],
          ],
          [
            "match",
            ["get", "subclass"],
            ["subway", "station", "halt", "tram_stop"],
            true,
            false,
          ],
          ["has", "name"],
        ];
        layer.minzoom = 12;
        const layout = { ...(layer.layout || {}) };
        delete layout["icon-image"];
        delete layout["icon-size"];
        layout["text-anchor"] = "top";
        layout["text-offset"] = [0, 0.65];
        layout["text-size"] = [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          11,
          14,
          12,
          16,
          13,
        ];
        layout["text-field"] = KO_TEXT;
        layout["text-font"] = ["Noto Sans Bold"];
        layout["text-optional"] = true;
        layout["text-allow-overlap"] = false;
        layout["symbol-sort-key"] = [
          "-",
          1000,
          ["to-number", ["coalesce", ["get", "rank"], 999]],
        ];
        layer.layout = layout;
        paintSet(layer, "text-color", theme.stationDot);
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", theme.id === "neon" ? 1.6 : 1.5);
      }
      // 큰 공원·산
      if (layer.id.includes("park_label") || layer.id === "label_park") {
        layer.minzoom = 11;
        paintSet(layer, "text-color", theme.id === "white" ? "#5A7A58" : theme.id === "neon" ? "#7AB8A0" : "#4F7A4A");
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
          "all",
          [
            "any",
            ["==", ["get", "class"], "rail"],
            ["==", ["get", "class"], "railway"],
          ],
          [
            "match",
            ["get", "subclass"],
            ["subway", "station", "halt", "tram_stop"],
            true,
            false,
          ],
        ],
        minzoom: 12,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            12,
            3.2,
            14,
            4,
            16,
            4.6,
          ],
          "circle-color": theme.stationDot,
          "circle-opacity": 0.95,
          "circle-stroke-width": theme.id === "neon" ? 1.4 : 1.2,
          "circle-stroke-color": theme.textHalo,
        },
      });
    }
  }

  // 구·군 이름 z9–13: tiles lack borough until z14 → static Korea overlay
  style.sources = {
    ...style.sources,
    korea_gu_labels: {
      type: "geojson",
      data: koreaGuLabelsGeoJson(),
    },
  };
  layers.push({
    id: "label_korea_gu_overlay",
    type: "symbol",
    source: "korea_gu_labels",
    minzoom: 9,
    maxzoom: 13.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12.5,
      "text-letter-spacing": 0.08,
      "text-max-width": 8,
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#A8B0E0" : "#4A5166",
      "text-halo-color": theme.textHalo,
      "text-halo-width": 1.2,
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

  // Guide landmarks (below adapter pins — pins are added after style load)
  appendLandmarkLayers(layers, theme);

  style.layers = layers;
  style.name = `pindmap-${theme.id}`;
  return style;
}


/** @deprecated alias — prefer buildPindmapStyle */
export const buildPreviewStyle = buildPindmapStyle;
