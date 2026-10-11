/**
 * PindMap MapLibre basemap styles (OpenFreeMap / OpenMapTiles).
 * Production themes: paper, white.
 * Admin MapLibre + preview: neon.
 * Preview-only extras: black, mono, dark (used by /map-preview).
 */

import { koreaGuLabelsGeoJson } from "@/lib/koreaGuLabels";
import { koreaPlaceLabelsGeoJson } from "@/lib/koreaPlaceLabels";

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
    // Very light cool gray (avoid cream/beige) — Kakao-like contrast at street zoom
    background: "#F2F2F2",
    land: "#F2F2F2",
    water: "#BFDDF2",
    park: "#D8E8D0",
    building: "#E6E6E6",
    showBuildings: true,
    road: "#FFFFFF",
    roadMinor: "#FFFFFF",
    rail: "#C8C8C8",
    text: "#3A4155",
    textHalo: "#FFFFFF",
    boundary: "#D0D0D0",
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
  // Road name labels + highway number shields (all themes / zooms). Road lines stay.
  "highway-name-path",
  "highway-name-minor",
  "highway-name-major",
  "highway-shield-non-us",
  "highway-shield-us-interstate",
  "road_shield_us",
  "building-3d",
  "label_country_1",
  "label_country_2",
  "label_country_3",
  // label_state / label_village restored with Korean zoom ladder
  "label_city_capital",
]);

/** Prefer Korean name fields from OpenMapTiles. */
const KO_TEXT: unknown = [
  "coalesce",
  ["get", "name:ko"],
  ["get", "name:nonlatin"],
  ["get", "name"],
];

/**
 * Neighborhood anchor labels from OpenMapTiles `poi`.
 * Shops/cafes use shop_poi_* layers (z16+). Landmarks always stack above shops.
 * Color groups: culture | medical | transit.
 */
const LANDMARK_FILTER: unknown = [
  "any",
  // 학교
  ["all", ["==", ["get", "class"], "school"], ["==", ["get", "subclass"], "school"]],
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
  // 공원
  ["all", ["==", ["get", "class"], "park"], ["==", ["get", "subclass"], "park"]],
  // 전통시장
  [
    "all",
    ["==", ["get", "class"], "grocery"],
    ["==", ["get", "subclass"], "marketplace"],
  ],
  // 구청·주민센터 (OMT: town_hall / townhall)
  [
    "all",
    ["==", ["get", "class"], "town_hall"],
    ["==", ["get", "subclass"], "townhall"],
  ],
  // 경찰서·파출소
  ["all", ["==", ["get", "class"], "police"], ["==", ["get", "subclass"], "police"]],
  // 우체국
  ["all", ["==", ["get", "class"], "post"], ["==", ["get", "subclass"], "post_office"]],
  // 지하철·기차역
  [
    "all",
    ["==", ["get", "class"], "railway"],
    ["match", ["get", "subclass"], ["subway", "station"], true, false],
  ],
  // 버스터미널
  [
    "all",
    ["==", ["get", "class"], "bus"],
    ["==", ["get", "subclass"], "bus_station"],
  ],
  // 도시 스케일 비상업 앵커
  ["all", ["==", ["get", "class"], "museum"], ["==", ["get", "subclass"], "museum"]],
  ["==", ["get", "class"], "stadium"],
  ["==", ["get", "class"], "attraction"],
];

/** Exclude military/small airfields from landmark labels. */
const NOT_AIRFIELD: unknown = [
  "all",
  ["!", ["in", ["get", "class"], ["literal", ["aerodrome", "airport"]]]],
  [
    "!",
    [
      "in",
      ["get", "subclass"],
      ["literal", ["aerodrome", "airfield", "heliport"]],
    ],
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
      [
        "all",
        ["==", ["get", "class"], "railway"],
        ["match", ["get", "subclass"], ["subway", "station"], true, false],
      ],
      ["all", ["==", ["get", "class"], "bus"], ["==", ["get", "subclass"], "bus_station"]],
    ],
    transit,
    culture,
  ];
}

function appendLandmarkLayers(layers: AnyLayer[], theme: MapPreviewTheme): void {
  const color = landmarkGroupColor(theme);
  // Neighborhood anchors at z15+; keep rank cap modest so shop_poi_* can fill gaps at z16–18
  const rankMax = landmarkRankMaxExpr(3, 8, 12);
  const filter: unknown = [
    "all",
    LANDMARK_FILTER,
    NOT_AIRFIELD,
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
    minzoom: 15,
    filter,
    layout: {
      visibility: "visible",
    },
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        15,
        2.4,
        16,
        2.8,
        17,
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
    minzoom: 15,
    filter,
    layout: {
      visibility: "visible",
      "text-field": KO_TEXT,
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        15,
        11.5,
        16,
        12,
        17,
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

/** Shop/facility name only — name:ko then name (no nonlatin fallback clutter). */
const SHOP_TEXT: unknown = ["coalesce", ["get", "name:ko"], ["get", "name"]];

const HAS_SHOP_NAME: unknown = [
  ">",
  ["length", ["to-string", ["coalesce", ["get", "name:ko"], ["get", "name"], ""]]],
  0,
];

/** Exclude bus stops and landmark classes (those stay on landmark_*). */
const SHOP_EXCLUDE: unknown = [
  "all",
  ["!", ["==", ["get", "class"], "bus"]],
  ["!", ["==", ["get", "subclass"], "bus_stop"]],
  [
    "!",
    [
      "in",
      ["get", "class"],
      [
        "literal",
        [
          "school",
          "college",
          "hospital",
          "park",
          "town_hall",
          "police",
          "railway",
          "museum",
          "stadium",
          "attraction",
          "aerodrome",
          "airport",
        ],
      ],
    ],
  ],
  // Traditional market + post office stay on landmark_label
  [
    "!",
    [
      "all",
      ["==", ["get", "class"], "post"],
      ["==", ["get", "subclass"], "post_office"],
    ],
  ],
  [
    "!",
    [
      "all",
      ["==", ["get", "class"], "grocery"],
      ["==", ["get", "subclass"], "marketplace"],
    ],
  ],
];

/** z16 core amenities (rank-limited). */
const SHOP_Z16: unknown = [
  "any",
  ["all", ["==", ["get", "class"], "cafe"], ["==", ["get", "subclass"], "cafe"]],
  [
    "all",
    ["==", ["get", "class"], "restaurant"],
    ["==", ["get", "subclass"], "restaurant"],
  ],
  [
    "all",
    ["==", ["get", "class"], "shop"],
    ["==", ["get", "subclass"], "convenience"],
  ],
  ["all", ["==", ["get", "class"], "bank"], ["==", ["get", "subclass"], "bank"]],
  [
    "all",
    ["==", ["get", "class"], "pharmacy"],
    ["==", ["get", "subclass"], "pharmacy"],
  ],
  [
    "all",
    ["==", ["get", "class"], "grocery"],
    ["==", ["get", "subclass"], "supermarket"],
  ],
];

/** z17+ adds bars, fast food, general shops. */
const SHOP_Z17_EXTRA: unknown = [
  "any",
  ["all", ["==", ["get", "class"], "bar"], ["==", ["get", "subclass"], "bar"]],
  [
    "all",
    ["==", ["get", "class"], "fast_food"],
    ["==", ["get", "subclass"], "fast_food"],
  ],
  ["all", ["==", ["get", "class"], "bakery"], ["==", ["get", "subclass"], "bakery"]],
  [
    "all",
    ["==", ["get", "class"], "shop"],
    ["!", ["==", ["get", "subclass"], "convenience"]],
  ],
  [
    "all",
    ["==", ["get", "class"], "grocery"],
    ["!", ["==", ["get", "subclass"], "marketplace"]],
  ],
];

/**
 * Four calm tint groups (not Kakao icons):
 * food | retail | daily (bank/pharmacy) | other
 */
function shopPoiColor(theme: MapPreviewTheme): unknown {
  const food =
    theme.id === "neon" ? "#C4A090" : theme.id === "white" ? "#8A6A5A" : "#8B6B5C";
  const retail =
    theme.id === "neon" ? "#8AB8A0" : theme.id === "white" ? "#5A7A68" : "#5B7A6A";
  const daily =
    theme.id === "neon" ? "#9AA8D0" : theme.id === "white" ? "#5A6A88" : "#5A6B8C";
  const other =
    theme.id === "neon" ? "#A0A0B0" : theme.id === "white" ? "#6E6874" : "#7A7580";
  return [
    "case",
    [
      "any",
      ["==", ["get", "class"], "cafe"],
      ["==", ["get", "class"], "restaurant"],
      ["==", ["get", "class"], "bar"],
      ["==", ["get", "class"], "fast_food"],
      ["==", ["get", "class"], "bakery"],
    ],
    food,
    [
      "any",
      ["==", ["get", "class"], "shop"],
      ["==", ["get", "class"], "grocery"],
      ["==", ["get", "class"], "clothes"],
    ],
    retail,
    [
      "any",
      ["==", ["get", "class"], "bank"],
      ["==", ["get", "class"], "post"],
      ["==", ["get", "class"], "pharmacy"],
    ],
    daily,
    other,
  ];
}

function appendShopPoiLayers(layers: AnyLayer[], theme: MapPreviewTheme): void {
  const color = shopPoiColor(theme);
  // Lower OMT rank number = more important → higher sort-key (layout data only)
  const sortKey: unknown = [
    "-",
    500,
    ["to-number", ["coalesce", ["get", "rank"], 999]],
  ];
  const rankAtMost = (max: number): unknown => [
    "<=",
    ["to-number", ["coalesce", ["get", "rank"], 999]],
    max,
  ];

  // Overlapping bands (no maxzoom) so z16 cores stay visible at z17+;
  // z17/z18 only add new classes. Avoids maxzoom=minzoom seam bugs.
  const bands: Array<{
    idSuffix: string;
    minzoom: number;
    classFilter: unknown;
    rankMax: number;
    radius: number;
    textSize: number;
  }> = [
    {
      idSuffix: "z16",
      minzoom: 16,
      classFilter: SHOP_Z16,
      rankMax: 18,
      radius: 3,
      textSize: 11,
    },
    {
      idSuffix: "z17",
      minzoom: 17,
      classFilter: SHOP_Z17_EXTRA,
      rankMax: 32,
      radius: 3.5,
      textSize: 11.5,
    },
    {
      idSuffix: "z18",
      minzoom: 18,
      // Remainder: named POIs not in z16/z17 class sets (hairdresser etc.)
      classFilter: [
        "all",
        ["!", SHOP_Z16],
        ["!", SHOP_Z17_EXTRA],
      ],
      rankMax: 999,
      radius: 4,
      textSize: 12,
    },
  ];

  for (const band of bands) {
    const filter: unknown = [
      "all",
      HAS_SHOP_NAME,
      SHOP_EXCLUDE,
      band.classFilter,
      rankAtMost(band.rankMax),
    ];
    const base = {
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: band.minzoom,
      filter,
    };

    layers.push({
      ...base,
      id: `shop_poi_dot_${band.idSuffix}`,
      type: "circle",
      layout: { visibility: "visible" },
      paint: {
        "circle-radius": band.radius,
        "circle-color": color,
        "circle-opacity": theme.id === "neon" ? 0.9 : 0.85,
        "circle-stroke-width": 1,
        "circle-stroke-color": theme.textHalo,
      },
    });

    layers.push({
      ...base,
      id: `shop_poi_label_${band.idSuffix}`,
      type: "symbol",
      layout: {
        visibility: "visible",
        "text-field": SHOP_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": band.textSize,
        "text-anchor": "left",
        "text-offset": [0.65, 0],
        "text-max-width": 7,
        "text-padding": 0.8,
        "text-optional": true,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "symbol-sort-key": sortKey,
        "symbol-z-order": "source",
      },
      paint: {
        "text-color": color,
        "text-opacity": 0.92,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": theme.id === "neon" ? 1.5 : 1.35,
        "text-halo-blur": 0.15,
      },
    });
  }
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

/**
 * Compact city labels: strip 특별시/광역시/시.
 * Keep 군 (고성군×2) and 광주시 (≠광주광역시).
 */
const SHORT_CITY_KO: unknown = [
  "let",
  "n",
  ["to-string", ["coalesce", ["get", "name:ko"], ["get", "name:nonlatin"], ["get", "name"], ""]],
  [
    "case",
    ["match", ["var", "n"], ["광주시", "고성군"], true, false],
    ["var", "n"],
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
    [
      "==",
      ["slice", ["var", "n"], ["-", ["length", ["var", "n"]], 1]],
      "시",
    ],
    ["slice", ["var", "n"], 0, ["-", ["length", ["var", "n"]], 1]],
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
      // Hide path/track dashes below z14
      return 14;
    default:
      return 14;
  }
}

function roadFillWidth(kind: RoadKind): unknown {
  // ~30% thinner than Liberty defaults; smooth zoom interpolation.
  switch (kind) {
    case "motorway":
      // Slightly clearer at z5–8; stay thin so the net doesn’t densify.
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        6,
        0.85,
        8,
        1.25,
        10,
        1.65,
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
        2.6,
        15,
        3.4,
        16,
        4.6,
        18,
        8,
      ];
    case "tertiary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        13,
        0.7,
        15,
        2.8,
        16,
        3.8,
        18,
        7,
      ];
    case "link":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        12,
        0.5,
        14,
        1.6,
        16,
        3.2,
        18,
        6,
      ];
    case "minor":
    case "service":
      // Street grid readable at Mangwon z15–18
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        1.1,
        15,
        2.4,
        16,
        3.6,
        18,
        7,
      ];
    case "path":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        0.7,
        16,
        2.2,
        18,
        4,
      ];
    default:
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        1.0,
        16,
        3.2,
        18,
        6,
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
        3.6,
        15,
        4.6,
        16,
        5.8,
        18,
        9.5,
      ];
    case "tertiary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        13,
        1.2,
        15,
        3.8,
        16,
        5,
        18,
        8.5,
      ];
    case "link":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        12,
        1.0,
        14,
        2.4,
        16,
        4.2,
        18,
        7.5,
      ];
    case "minor":
    case "service":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        1.8,
        15,
        3.4,
        16,
        4.8,
        18,
        8.5,
      ];
    case "path":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        1.2,
        16,
        3,
        18,
        5,
      ];
    default:
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        1.6,
        16,
        4.2,
        18,
        7.5,
      ];
  }
}

function roadFillColor(
  theme: MapPreviewTheme,
  kind: RoadKind,
): string {
  const yellow = kind === "motorway" || kind === "trunk";
  if (theme.id === "paper") {
    // Keep major arterials (강변북로 등) in current soft cream; locals stay white
    if (yellow) return "#F5E8C0";
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
    // Cool gray casing for white local streets (not warm beige)
    return yellow ? "#EFE2B8" : "#D4D4D4";
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
          : theme.id === "paper"
            ? "#E4ECDC"
            : "#E8F0E0";
    const buildingOutline =
      theme.id === "white"
        ? "#E6E6E6"
        : theme.id === "neon"
          ? "#242C5C"
          : theme.id === "paper"
            ? "#DEDEDE"
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
          paintSet(layer, "fill-opacity", [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.2,
            8,
            0.35,
            9,
            0.55,
            11,
            0.7,
          ]);
        } else if (layer.id === "park" || layer.id.includes("grass")) {
          paintSet(layer, "fill-color", theme.park);
          // Softer below z9 so national parks don’t blotch at nationwide zoom
          paintSet(layer, "fill-opacity", [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.22,
            8,
            0.35,
            9,
            0.75,
            11,
            0.9,
          ]);
        } else if (layer.id.includes("sand") || layer.id.includes("ice")) {
          paintSet(layer, "fill-color", theme.land);
          paintSet(layer, "fill-opacity", 0.5);
        } else {
          paintSet(layer, "fill-color", theme.land);
          paintSet(layer, "fill-opacity", [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.18,
            9,
            0.4,
          ]);
        }
      }
      if (layer.id === "park_outline") {
        paintSet(layer, "line-color", theme.park);
        paintSet(layer, "line-opacity", [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0.12,
          9,
          0.4,
        ]);
      }
    }

    if (layer.id === "building") {
      if (!theme.showBuildings) {
        setVisibility(layer, false);
      } else if (theme.id === "paper") {
        // Hidden / invisible below z17; cool gray (not beige) at z17+
        paintSet(layer, "fill-color", theme.building);
        paintSet(layer, "fill-opacity", [
          "interpolate",
          ["linear"],
          ["zoom"],
          16.99,
          0,
          17,
          0.88,
          18,
          0.95,
        ]);
        paintSet(layer, "fill-outline-color", buildingOutline);
        layer.minzoom = 17;
        delete layer.maxzoom;
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
        // Quiet rail: hidden below z14; thin solid gray (no dash) above.
        layer.minzoom = Math.max(layer.minzoom ?? 0, 14);
        paintSet(layer, "line-color", theme.rail);
        paintSet(layer, "line-opacity", theme.id === "neon" ? 0.45 : 0.5);
        paintSet(layer, "line-width", 0.9);
        if (layer.paint) delete layer.paint["line-dasharray"];
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
        // Seas/ocean readable at nationwide zoom; lakes/rivers from z10.
        layer.minzoom = 5;
        paintSet(layer, "text-color", theme.id === "white" ? "#6A8FA8" : theme.id === "neon" ? "#8AA0D8" : "#4A8BB8");
        paintSet(layer, "text-opacity", [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0.55,
          8,
          0.85,
          11,
          1,
        ]);
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.5);
        if (layer.layout) {
          layer.layout["text-font"] = ["Noto Sans Italic"];
          layer.layout["text-letter-spacing"] = 0.12;
          if (layer.id === "water_name_point_label") {
            layer.layout["text-size"] = [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              11,
              8,
              13,
              12,
              12,
            ];
          } else {
            layer.layout["text-size"] = [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              10,
              10,
              12,
            ];
          }
        }
      }
      // Province (도) names: z6–8, very light, wide tracking
      if (layer.id === "label_state") {
        layer.minzoom = 5;
        layer.maxzoom = 8.5;
        // Hide NK admin units (*직할*); keep SK provinces only via name list
        layer.filter = [
          "all",
          ["==", ["get", "class"], "state"],
          [
            "==",
            [
              "index-of",
              "직할",
              ["to-string", ["coalesce", ["get", "name:ko"], ["get", "name"], ""]],
            ],
            -1,
          ],
          [
            "==",
            [
              "index-of",
              "특별시",
              ["to-string", ["coalesce", ["get", "name:ko"], ["get", "name"], ""]],
            ],
            -1,
          ],
        ];
        if (layer.layout) {
          layer.layout["text-field"] = [
            "let",
            "n",
            [
              "to-string",
              ["coalesce", ["get", "name:ko"], ["get", "name:nonlatin"], ["get", "name"], ""],
            ],
            [
              "case",
              [
                "==",
                ["slice", ["var", "n"], ["-", ["length", ["var", "n"]], 1]],
                "도",
              ],
              ["slice", ["var", "n"], 0, ["-", ["length", ["var", "n"]], 1]],
              ["var", "n"],
            ],
          ];
          layer.layout["text-font"] = ["Noto Sans Regular"];
          layer.layout["text-size"] = [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            10,
            7,
            12,
          ];
          layer.layout["text-letter-spacing"] = 0.4;
          layer.layout["text-padding"] = 8;
          layer.layout["text-allow-overlap"] = false;
          layer.layout["text-optional"] = true;
        }
        paintSet(
          layer,
          "text-color",
          theme.id === "neon" ? "#5A6288" : theme.id === "white" ? "#B0B4BC" : "#B8B0A4",
        );
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.0);
        layers.push(layer);
        continue;
      }
      // 시 이름: 광역시(굵게) / 모든 시(점+이름) / 군·읍면은 별도 레이어
      if (layer.id === "label_city" || layer.id === "label_town") {
        const isCity = layer.id === "label_city";
        layer.minzoom = isCity ? 5 : 8;
        layer.maxzoom = isCity ? 10 : 11.5;
        const metroColor =
          theme.id === "neon" ? "#D0D4F0" : theme.id === "white" ? "#2A3348" : "#2A3144";
        const otherColor =
          theme.id === "neon" ? "#8A92B8" : theme.id === "white" ? "#6A7080" : "#6A6570";
        const metroNameFilter: unknown = [
          "match",
          ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
          [
            "서울",
            "서울특별시",
            "부산",
            "부산광역시",
            "인천",
            "인천광역시",
            "대구",
            "대구광역시",
            "대전",
            "대전광역시",
            "광주",
            "광주광역시",
            "울산",
            "울산광역시",
            "세종",
            "세종특별자치시",
            "제주특별자치도",
          ],
          true,
          false,
        ];
        const nkAdminHide: unknown = [
          "==",
          [
            "index-of",
            "직할",
            ["to-string", ["coalesce", ["get", "name:ko"], ["get", "name"], ""]],
          ],
          -1,
        ];
        // Primary = metro (bold)
        layer.filter = ["all", metroNameFilter, nkAdminHide];
        paintSet(layer, "text-color", metroColor);
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.6);
        if (layer.layout) {
          layer.layout["text-field"] = SHORT_CITY_KO;
          layer.layout["text-font"] = ["Noto Sans Bold"];
          layer.layout["text-size"] = [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            13,
            8,
            15,
          ];
          layer.layout["text-padding"] = 2;
          layer.layout["text-allow-overlap"] = true;
          layer.layout["text-ignore-placement"] = true;
          layer.layout["symbol-sort-key"] = [
            "match",
            ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
            ["서울", "서울특별시"],
            0,
            10,
          ];
          layer.layout["icon-size"] = 0.45;
        }
        layers.push(layer);
        if (isCity) {
          // All other cities — population/rank sort; denser nationwide coverage
          layers.push({
            id: "label_city_other_ko",
            type: "symbol",
            source: "openmaptiles",
            "source-layer": "place",
            filter: [
              "all",
              ["!", metroNameFilter],
              nkAdminHide,
              ["==", ["get", "class"], "city"],
              [
                "!",
                [
                  "match",
                  ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
                  ["제주", "제주시"],
                  true,
                  false,
                ],
              ],
            ],
            minzoom: 5.5,
            maxzoom: 10,
            layout: {
              "text-field": SHORT_CITY_KO,
              "text-font": ["Noto Sans Regular"],
              "text-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5.5,
                10,
                8,
                12,
              ],
              "text-padding": 4,
              "text-max-width": 8,
              "text-allow-overlap": false,
              "text-optional": true,
              "symbol-sort-key": [
                "to-number",
                ["coalesce", ["get", "rank"], 999],
              ],
              visibility: "visible",
            },
            paint: {
              "text-color": otherColor,
              "text-halo-color": theme.textHalo,
              "text-halo-width": 1.2,
            },
          });
          layers.push({
            id: "place_city_dot_ko",
            type: "circle",
            source: "openmaptiles",
            "source-layer": "place",
            filter: [
              "all",
              ["!", metroNameFilter],
              nkAdminHide,
              ["==", ["get", "class"], "city"],
            ],
            minzoom: 5.5,
            maxzoom: 9.5,
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5.5,
                1.6,
                8,
                2.4,
              ],
              "circle-color": otherColor,
              "circle-opacity": 0.8,
              "circle-stroke-width": 0.6,
              "circle-stroke-color": theme.textHalo,
            },
          });
          // Towns (smaller 시 + many 군 in OMT) from province zoom
          layers.push({
            id: "label_town_all_ko",
            type: "symbol",
            source: "openmaptiles",
            "source-layer": "place",
            filter: [
              "all",
              nkAdminHide,
              ["==", ["get", "class"], "town"],
              [
                "!",
                [
                  "match",
                  ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
                  ["제주", "제주시"],
                  true,
                  false,
                ],
              ],
            ],
            minzoom: 8,
            maxzoom: 11.5,
            layout: {
              "text-field": SHORT_CITY_KO,
              "text-font": ["Noto Sans Regular"],
              "text-size": 11,
              "text-padding": 5,
              "text-max-width": 8,
              "text-allow-overlap": false,
              "text-optional": true,
              "symbol-sort-key": [
                "to-number",
                ["coalesce", ["get", "rank"], 999],
              ],
              visibility: "visible",
            },
            paint: {
              "text-color": otherColor,
              "text-halo-color": theme.textHalo,
              "text-halo-width": 1.15,
            },
          });
          layers.push({
            id: "label_pyongyang_ko",
            type: "symbol",
            source: "openmaptiles",
            "source-layer": "place",
            filter: [
              "match",
              ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
              ["평양", "평양시"],
              true,
              false,
            ],
            minzoom: 5,
            maxzoom: 9,
            layout: {
              "text-field": "평양",
              "text-font": ["Noto Sans Regular"],
              "text-size": 11,
              "text-padding": 6,
              "text-allow-overlap": false,
              "text-optional": true,
              visibility: "visible",
            },
            paint: {
              "text-color":
                theme.id === "neon" ? "#5A6288" : theme.id === "white" ? "#A8ACB4" : "#A8A098",
              "text-halo-color": theme.textHalo,
              "text-halo-width": 1.0,
            },
          });
        }
        continue;
      }
      if (layer.id === "label_village") {
        // 읍·면 (OMT village) — city unit zoom
        layer.minzoom = 10;
        layer.maxzoom = 13.5;
        layer.filter = ["==", ["get", "class"], "village"];
        paintSet(
          layer,
          "text-color",
          theme.id === "neon" ? "#9AA2C8" : "#5A6170",
        );
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.1);
        if (layer.layout) {
          layer.layout["text-field"] = KO_TEXT;
          layer.layout["text-font"] = ["Noto Sans Regular"];
          layer.layout["text-size"] = 11;
          layer.layout["text-padding"] = 4;
          layer.layout["text-optional"] = true;
          layer.layout["text-allow-overlap"] = false;
          layer.layout["symbol-sort-key"] = [
            "to-number",
            ["coalesce", ["get", "rank"], 999],
          ];
        }
        setVisibility(layer, true);
        layers.push(layer);
        continue;
      }
      if (layer.id === "label_other") {
        // 구·동 — tiles often late; korea_gu_overlay covers 구 at z10–13
        setVisibility(layer, false);
        layers.push(layer);
        layers.push({
          id: "label_borough_ko",
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "place",
          filter: ["==", ["get", "class"], "borough"],
          minzoom: 10,
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
          id: "label_suburb_ko",
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "place",
          filter: ["==", ["get", "class"], "suburb"],
          minzoom: 11,
          maxzoom: 14,
          layout: {
            "text-field": KO_TEXT,
            "text-font": ["Noto Sans Regular"],
            "text-size": 11.5,
            "text-max-width": 8,
            visibility: "visible",
          },
          paint: {
            "text-color": theme.id === "neon" ? "#9AA2D0" : "#5A6175",
            "text-halo-color": theme.textHalo,
            "text-halo-width": 1.1,
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
      // highway-name-* / highway-shield-* are in HIDE_LAYER_IDS (no road labels)
      if (layer.id === "airport" || layer.id.startsWith("airport")) {
        // International airports only (IATA). Hides 수색비행장 etc. (no IATA).
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
        // Quiet station names: z13+, 11px gray (dots from subway overlay).
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
        layer.minzoom = 13;
        const layout = { ...(layer.layout || {}) };
        delete layout["icon-image"];
        delete layout["icon-size"];
        layout["text-anchor"] = "top";
        layout["text-offset"] = [0, 0.7];
        layout["text-size"] = 11;
        layout["text-field"] = KO_TEXT;
        layout["text-font"] = ["Noto Sans Regular"];
        layout["text-optional"] = true;
        layout["text-allow-overlap"] = false;
        layout["symbol-sort-key"] = [
          "-",
          1000,
          ["to-number", ["coalesce", ["get", "rank"], 999]],
        ];
        layer.layout = layout;
        const quietStation =
          theme.id === "neon" ? "#A8B0C8" : theme.id === "white" ? "#7A808C" : "#7A756C";
        paintSet(layer, "text-color", quietStation);
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.2);
      }
      // 큰 공원·산
      if (layer.id.includes("park_label") || layer.id === "label_park") {
        layer.minzoom = 10;
        paintSet(layer, "text-color", theme.id === "white" ? "#5A7A58" : theme.id === "neon" ? "#7AB8A0" : "#4F7A4A");
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.5);
      }
      if (layer.id.includes("mountain") || layer.id.includes("peak")) {
        // Peaks from province zoom (Kakao shows major mountains earlier)
        layer.minzoom = 8;
        paintSet(layer, "text-color", theme.text);
        paintSet(layer, "text-halo-color", theme.textHalo);
        if (layer.layout) {
          layer.layout["text-size"] = [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            10,
            12,
            12,
          ];
          layer.layout["text-optional"] = true;
        }
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

  // 시·군 supplement (poi medians) + 구 overlay — tiles often sparse
  style.sources = {
    ...style.sources,
    korea_place_labels: {
      type: "geojson",
      data: koreaPlaceLabelsGeoJson(),
    },
    korea_gu_labels: {
      type: "geojson",
      data: koreaGuLabelsGeoJson(),
    },
  };
  layers.push({
    id: "label_korea_place_si",
    type: "symbol",
    source: "korea_place_labels",
    filter: ["==", ["get", "kind"], "si"],
    minzoom: 6,
    maxzoom: 10,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6,
        10,
        9,
        12,
      ],
      "text-padding": 3,
      "text-max-width": 8,
      "text-optional": true,
      "text-allow-overlap": false,
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#8A92B8" : "#6A6570",
      "text-halo-color": theme.textHalo,
      "text-halo-width": 1.15,
    },
  });
  layers.push({
    id: "label_korea_place_gun",
    type: "symbol",
    source: "korea_place_labels",
    filter: ["==", ["get", "kind"], "gun"],
    minzoom: 8,
    maxzoom: 11.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-padding": 4,
      "text-max-width": 8,
      "text-optional": true,
      "text-allow-overlap": false,
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#7A82A8" : "#6E6874",
      "text-halo-color": theme.textHalo,
      "text-halo-width": 1.1,
    },
  });
  layers.push({
    id: "label_korea_gu_overlay",
    type: "symbol",
    source: "korea_gu_labels",
    minzoom: 10,
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

  // No transportation_name labels (road / bridge names) — place / water / station stay.

  // Shop/facility names (z16+) below landmarks; adapter pins added later on top
  appendShopPoiLayers(layers, theme);
  // Neighborhood anchors — after shops so they paint above and keep placement priority
  appendLandmarkLayers(layers, theme);

  style.layers = layers;
  style.name = `pindmap-${theme.id}`;
  return style;
}


/** @deprecated alias — prefer buildPindmapStyle */
export const buildPreviewStyle = buildPindmapStyle;
