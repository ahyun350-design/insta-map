/**
 * PindMap MapLibre basemap styles (OpenFreeMap / OpenMapTiles).
 * Production themes: paper, white.
 * Admin MapLibre + preview: neon.
 * Preview-only extras: black, mono, dark (used by /map-preview).
 */

import { koreaGuLabelsGeoJson } from "@/lib/koreaGuLabels";
import { koreaMajorLabelsGeoJson } from "@/lib/koreaMajorLabels";
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
    // Slightly deeper green so parks/mountains read at z11–12 (still paper-cool)
    park: "#C5DDB8",
    building: "#E8E8E8",
    showBuildings: true,
    road: "#FFFFFF",
    roadMinor: "#FFFFFF",
    rail: "#B0B0B0",

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
 * Shops/cafes use shop_poi_* layers (z14+). Landmarks always stack above shops.
 * Color groups: culture | medical | transit.
 */
const LANDMARK_FILTER: unknown = [
  "any",
  // 학교·대학 (OMT class varies)
  ["==", ["get", "class"], "school"],
  ["==", ["get", "class"], "college"],
  ["==", ["get", "subclass"], "university"],
  // 종합병원 (clinic/의원 제외)
  [
    "all",
    ["==", ["get", "class"], "hospital"],
    ["==", ["get", "subclass"], "hospital"],
  ],
  // 공원
  ["==", ["get", "class"], "park"],
  // 전통시장
  [
    "all",
    ["==", ["get", "class"], "grocery"],
    ["==", ["get", "subclass"], "marketplace"],
  ],
  // 구청·주민센터
  ["==", ["get", "class"], "town_hall"],
  // 경찰서·파출소
  ["==", ["get", "class"], "police"],
  // 우체국
  [
    "all",
    ["==", ["get", "class"], "post"],
    ["==", ["get", "subclass"], "post_office"],
  ],
  // Stations stay on poi_transit (not landmark) so names don't double-collide
  ["==", ["get", "class"], "museum"],
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

/** OpenFreeMap Liberty sprite ids (ofm_f384) — category icons already in style.sprite. */
function poiSpriteIcon(): unknown {
  return [
    "case",
    [
      "any",
      ["==", ["get", "class"], "cafe"],
      ["all", ["==", ["get", "class"], "shop"], ["==", ["get", "subclass"], "coffee"]],
    ],
    "cafe_11",
    ["==", ["get", "class"], "restaurant"],
    "restaurant_11",
    ["==", ["get", "class"], "fast_food"],
    "fast_food_11",
    ["==", ["get", "class"], "bakery"],
    "bakery_11",
    ["==", ["get", "class"], "bar"],
    "bar_11",
    ["==", ["get", "class"], "beer"],
    "bar_11",
    ["==", ["get", "class"], "pharmacy"],
    "pharmacy_11",
    ["==", ["get", "class"], "bank"],
    "bank_11",
    [
      "any",
      ["==", ["get", "class"], "hotel"],
      ["==", ["get", "class"], "lodging"],
      ["==", ["get", "subclass"], "hotel"],
    ],
    "lodging_11",
    [
      "any",
      ["==", ["get", "class"], "cinema"],
      ["==", ["get", "subclass"], "cinema"],
    ],
    "cinema_11",
    [
      "any",
      ["==", ["get", "class"], "theatre"],
      ["==", ["get", "class"], "theater"],
    ],
    "cinema_11",
    [
      "any",
      ["==", ["get", "class"], "mall"],
      ["==", ["get", "subclass"], "department_store"],
      ["==", ["get", "class"], "department_store"],
    ],
    "shop_11",
    [
      "any",
      ["all", ["==", ["get", "class"], "shop"], ["==", ["get", "subclass"], "convenience"]],
      ["all", ["==", ["get", "class"], "grocery"], ["==", ["get", "subclass"], "supermarket"]],
    ],
    "shop_11",
    ["==", ["get", "class"], "grocery"],
    "grocery_11",
    ["==", ["get", "class"], "shop"],
    "shop_11",
    ["==", ["get", "class"], "hospital"],
    "hospital_11",
    [
      "any",
      ["==", ["get", "class"], "school"],
      ["==", ["get", "class"], "college"],
    ],
    "school_11",
    ["==", ["get", "class"], "park"],
    "park_11",
    ["==", ["get", "class"], "police"],
    "police_11",
    ["==", ["get", "class"], "post"],
    "post_11",
    ["==", ["get", "class"], "town_hall"],
    "town_hall_11",
    [
      "any",
      ["==", ["get", "class"], "railway"],
      ["==", ["get", "class"], "rail"],
    ],
    "railway_metro_11",
    ["==", ["get", "class"], "bus"],
    "bus_11",
    ["==", ["get", "class"], "hairdresser"],
    "shop_11",
    "shop_11",
  ];
}

function appendLandmarkLayers(layers: AnyLayer[], theme: MapPreviewTheme): void {
  const color = landmarkGroupColor(theme);
  // z11–13: few major anchors; z14 tight for shops; denser late
  const rankMax: unknown = [
    "step",
    ["zoom"],
    3,
    12,
    5,
    13,
    12,
    14,
    6,
    15.5,
    14,
    17,
    18,
  ];
  const filter: unknown = [
    "all",
    LANDMARK_FILTER,
    NOT_AIRFIELD,
    ["has", "name"],
    ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], rankMax],
  ];
  // Priority 2 — above shops (≤850), below stations (~1100−rank)
  const sortKey: unknown = ["-", 1000, ["to-number", ["coalesce", ["get", "rank"], 999]]];

  // Single symbol: icon + name together (no nameless dots).
  layers.push({
    id: "landmark_label",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 11,
    filter,
    layout: {
      visibility: "visible",
      "icon-image": poiSpriteIcon(),
      // cafe_11 is 34px@2x → 17 CSS px at size 1; ~18px ≈ 1.1
      "icon-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        0.85,
        13,
        1.0,
        14,
        1.1,
      ],
      "icon-optional": false,
      "text-field": KO_TEXT,
      "text-font": ["Noto Sans Bold"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        12,
        13,
        13,
        14,
        14,
      ],
      "text-variable-anchor": ["right", "left", "top", "bottom"],
      "text-radial-offset": 1.05,
      "text-max-width": 8,
      "text-padding": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        6,
        13,
        2.2,
        14,
        3,
        16,
        1.5,
        17,
        0.7,
      ],
      "text-optional": false,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "symbol-sort-key": sortKey,
      "symbol-z-order": "source",
    },
    paint: {
      "text-color": color,
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
      "text-halo-blur": 0.2,
      "icon-opacity": 0.95,
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

/** Priority 3 — large commercial / culture venues (not landmark anchors). */
const SHOP_BIG: unknown = [
  "any",
  ["==", ["get", "class"], "mall"],
  ["==", ["get", "class"], "cinema"],
  ["==", ["get", "class"], "theatre"],
  ["==", ["get", "class"], "theater"],
  ["==", ["get", "class"], "hotel"],
  ["==", ["get", "class"], "lodging"],
  ["==", ["get", "class"], "department_store"],
  ["==", ["get", "subclass"], "department_store"],
  ["==", ["get", "subclass"], "hotel"],
  ["==", ["get", "subclass"], "cinema"],
  [
    "all",
    ["==", ["get", "class"], "grocery"],
    ["==", ["get", "subclass"], "supermarket"],
  ],
];

/** Priority 4 — food & drink. */
const SHOP_FOOD: unknown = [
  "any",
  ["==", ["get", "class"], "cafe"],
  ["==", ["get", "class"], "restaurant"],
  ["==", ["get", "class"], "fast_food"],
  ["==", ["get", "class"], "bakery"],
  ["==", ["get", "class"], "bar"],
  ["==", ["get", "class"], "beer"],
];

/** Priority 5 — daily services (convenience excluded at z14–15). */
const SHOP_DAILY_NO_CONV: unknown = [
  "any",
  ["==", ["get", "class"], "bank"],
  ["==", ["get", "class"], "pharmacy"],
];

const SHOP_CONVENIENCE: unknown = [
  "all",
  ["==", ["get", "class"], "shop"],
  ["==", ["get", "subclass"], "convenience"],
];

/** z16 bucket: food + daily + convenience + big (legacy name kept for remainder). */
const SHOP_Z16: unknown = [
  "any",
  SHOP_BIG,
  SHOP_FOOD,
  SHOP_DAILY_NO_CONV,
  SHOP_CONVENIENCE,
];

/** Priority 6 — general retail / personal care (z17+). */
const SHOP_Z17_EXTRA: unknown = [
  "any",
  [
    "all",
    ["==", ["get", "class"], "shop"],
    ["!", ["==", ["get", "subclass"], "convenience"]],
  ],
  [
    "all",
    ["==", ["get", "class"], "grocery"],
    [
      "!",
      [
        "in",
        ["get", "subclass"],
        ["literal", ["marketplace", "supermarket"]],
      ],
    ],
  ],
  ["==", ["get", "class"], "hairdresser"],
  ["==", ["get", "class"], "laundry"],
  ["==", ["get", "class"], "clothes"],
  ["==", ["get", "class"], "florist"],
  ["==", ["get", "class"], "books"],
  ["==", ["get", "class"], "library"],
  ["==", ["get", "class"], "dentist"],
  ["==", ["get", "class"], "doctors"],
  ["==", ["get", "class"], "optician"],
  ["==", ["get", "class"], "furniture"],
  ["==", ["get", "class"], "gift"],
  ["==", ["get", "class"], "jewelry"],
  ["==", ["get", "class"], "shoes"],
  ["==", ["get", "class"], "sports"],
  ["==", ["get", "class"], "toys"],
];

/**
 * z18 remainder: other named commercial / service POIs not in earlier sets.
 */
const SHOP_Z18_REMAINDER: unknown = [
  "all",
  ["!", SHOP_Z16],
  ["!", SHOP_Z17_EXTRA],
  [
    "any",
    ["==", ["get", "class"], "shop"],
    ["==", ["get", "class"], "grocery"],
    ["==", ["get", "class"], "furniture"],
    ["==", ["get", "class"], "gift"],
    ["==", ["get", "class"], "jewelry"],
    ["==", ["get", "class"], "shoes"],
    ["==", ["get", "class"], "sports"],
    ["==", ["get", "class"], "stationery"],
    ["==", ["get", "class"], "toys"],
    ["==", ["get", "class"], "optician"],
    ["==", ["get", "class"], "chemist"],
    ["==", ["get", "class"], "doityourself"],
    ["==", ["get", "class"], "hardware"],
    ["==", ["get", "class"], "electronics"],
    ["==", ["get", "class"], "mobile_phone"],
    ["==", ["get", "class"], "bicycle"],
    ["==", ["get", "class"], "car"],
    ["==", ["get", "class"], "travel_agent"],
    ["==", ["get", "class"], "copyshop"],
    ["==", ["get", "class"], "art"],
    ["==", ["get", "class"], "music"],
    ["==", ["get", "class"], "pet"],
    ["==", ["get", "class"], "wine"],
    ["==", ["get", "class"], "beverages"],
    ["==", ["get", "class"], "butcher"],
    ["==", ["get", "class"], "confectionery"],
    ["==", ["get", "class"], "deli"],
    ["==", ["get", "class"], "greengrocer"],
    ["==", ["get", "class"], "seafood"],
    ["==", ["get", "class"], "tea"],
    ["==", ["get", "class"], "pastry"],
    ["==", ["get", "class"], "ice_cream"],
    ["==", ["get", "class"], "alcohol"],
    ["==", ["get", "class"], "kiosk"],
    ["==", ["get", "class"], "newsagent"],
    ["==", ["get", "class"], "tobacco"],
    ["==", ["get", "class"], "perfumery"],
    ["==", ["get", "class"], "cosmetics"],
    ["==", ["get", "class"], "dentist"],
    ["==", ["get", "class"], "doctors"],
    ["==", ["get", "class"], "clinic"],
    ["==", ["get", "class"], "veterinary"],
    ["==", ["get", "class"], "beauty"],
    ["==", ["get", "subclass"], "beauty"],
    ["==", ["get", "subclass"], "hairdresser"],
    ["==", ["get", "subclass"], "laundry"],
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
      ["==", ["get", "class"], "beer"],
      ["==", ["get", "class"], "fast_food"],
      ["==", ["get", "class"], "bakery"],
      ["==", ["get", "class"], "ice_cream"],
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
  // Higher sort-key wins placement. Priority: big(3) > food(4) > daily(5) > rest(6).
  // Stay below landmarks (1000−rank) and stations (1100−rank).
  const sortKey: unknown = [
    "-",
    [
      "case",
      SHOP_BIG,
      850,
      SHOP_FOOD,
      700,
      [
        "any",
        SHOP_DAILY_NO_CONV,
        SHOP_CONVENIENCE,
      ],
      550,
      400,
    ],
    ["/", ["to-number", ["coalesce", ["get", "rank"], 999]], 10],
  ];

  // Overlapping bands. Convenience excluded until z16. Padding: far=large, near=small.
  const bands: Array<{
    idSuffix: string;
    minzoom: number;
    maxzoom?: number;
    classFilter: unknown;
    textPadding: unknown;
  }> = [
    {
      idSuffix: "z14",
      minzoom: 14,
      maxzoom: 16,
      // Big venues + better-ranked food (no convenience)
      classFilter: [
        "any",
        [
          "all",
          SHOP_BIG,
          ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 40],
        ],
        [
          "all",
          SHOP_FOOD,
          ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 22],
        ],
      ],
      textPadding: [
        "interpolate",
        ["linear"],
        ["zoom"],
        14,
        22,
        15,
        16,
        16,
        12,
      ],
    },
    {
      idSuffix: "z15",
      minzoom: 15,
      maxzoom: 16.5,
      classFilter: [
        "any",
        SHOP_BIG,
        [
          "all",
          SHOP_FOOD,
          ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 55],
        ],
        SHOP_DAILY_NO_CONV,
      ],
      textPadding: [
        "interpolate",
        ["linear"],
        ["zoom"],
        15,
        14,
        16,
        10,
      ],
    },
    {
      idSuffix: "z16",
      minzoom: 16,
      classFilter: SHOP_Z16,
      textPadding: [
        "interpolate",
        ["linear"],
        ["zoom"],
        16,
        16,
        17,
        2.4,
        18,
        1.1,
      ],
    },
    {
      idSuffix: "z17",
      minzoom: 17,
      classFilter: [
        "all",
        SHOP_Z17_EXTRA,
        ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 120],
      ],
      textPadding: [
        "interpolate",
        ["linear"],
        ["zoom"],
        17,
        0.7,
        18,
        0.4,
      ],
    },
    {
      idSuffix: "z18",
      minzoom: 18,
      classFilter: SHOP_Z18_REMAINDER,
      textPadding: 0.6,
    },
  ];

  for (const band of bands) {
    const filter: unknown = [
      "all",
      HAS_SHOP_NAME,
      SHOP_EXCLUDE,
      band.classFilter,
    ];
    const layerSpec: AnyLayer = {
      id: `shop_poi_label_${band.idSuffix}`,
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: band.minzoom,
      filter,
      layout: {
        visibility: "visible",
        "icon-image": poiSpriteIcon(),
        // ~18px on screen from *_11 @2x (17 CSS px at size 1 → ×1.1)
        "icon-size": 1.1,
        "icon-padding": 1,
        "icon-optional": false,
        "text-field": SHOP_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          13,
          16,
          12.5,
          17,
          11.5,
        ],
        "text-variable-anchor": ["right", "left", "top", "bottom"],
        "text-radial-offset": 0.9,
        "text-max-width": 8,
        "text-padding": band.textPadding,
        "text-optional": false,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        "symbol-sort-key": sortKey,
        "symbol-z-order": "source",
      },
      paint: {
        "text-color": color,
        "text-opacity": 0.92,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.5,
        "text-halo-blur": 0.15,
        "icon-opacity": 0.95,
      },
    };
    if (typeof band.maxzoom === "number") {
      layerSpec.maxzoom = band.maxzoom;
    }
    layers.push(layerSpec);
  }
}

/** Bus stops: small icon only (no name) at z17+. */
function appendBusStopLayers(layers: AnyLayer[]): void {
  layers.push({
    id: "bus_stop_icon",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 17,
    filter: [
      "all",
      ["==", ["get", "class"], "bus"],
      ["==", ["get", "subclass"], "bus_stop"],
    ],
    layout: {
      visibility: "visible",
      "icon-image": "bus_11",
      "icon-size": 0.65,
      "icon-optional": false,
      // Decorative dots — do not crowd out place names
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-padding": 0.5,
      "symbol-sort-key": 50,
    },
    paint: {
      "icon-opacity": 0.85,
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
      // Clear step up vs secondary at z15+
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        9,
        0.9,
        12,
        2.2,
        14,
        4.2,
        15,
        5.6,
        16,
        7.2,
        18,
        11,
      ];
    case "secondary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        11,
        0.7,
        14,
        2.4,
        15,
        3.2,
        16,
        4.2,
        18,
        7.5,
      ];
    case "tertiary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        13,
        0.7,
        15,
        2.6,
        16,
        3.4,
        18,
        6.5,
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
      // Thin locals — hierarchy vs arterial must be obvious at z15+
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        14,
        0.9,
        15,
        1.6,
        16,
        2.4,
        18,
        4.5,
      ];
    case "path":
      return 0.5;
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
        1.4,
        12,
        3.0,
        14,
        5.4,
        15,
        7.0,
        16,
        8.8,
        18,
        13,
      ];
    case "secondary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        11,
        1.2,
        14,
        3.4,
        15,
        4.4,
        16,
        5.4,
        18,
        9,
      ];
    case "tertiary":
      return [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        13,
        1.2,
        15,
        3.6,
        16,
        4.6,
        18,
        8,
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
        1.4,
        15,
        2.4,
        16,
        3.2,
        18,
        5.5,
      ];
    case "path":
      return 0.5;
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
  // motorway/trunk/primary = cream; secondary/tertiary/minor = white
  const arterial =
    kind === "motorway" || kind === "trunk" || kind === "primary";
  if (theme.id === "paper") {
    if (arterial) return "#F3E6B8";
    return theme.road;
  }
  if (theme.id === "white") {
    if (arterial) return "#EDE8D8";
    return theme.road;
  }
  if (theme.id === "neon") {
    if (arterial) return theme.road;
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
  const arterial =
    kind === "motorway" || kind === "trunk" || kind === "primary";
  if (theme.id === "paper") {
    if (arterial) return "#E0D2A0";
    if (kind === "secondary" || kind === "tertiary") return "#C8C8C8";
    return "#D4D4D4";
  }
  if (theme.id === "white") {
    return arterial ? "#D8D0B8" : "#E0E0E0";
  }
  if (theme.id === "neon") {
    return arterial ? "#2E3878" : "#1A2250";
  }
  return theme.boundary;
}

function applyGuideRoadStyle(
  layer: AnyLayer,
  theme: MapPreviewTheme,
  kind: RoadKind,
  casing: boolean,
) {
  // Hide mountain/foot path dashes entirely (always-hidden rule).
  if (kind === "path") {
    setVisibility(layer, false);
    return;
  }
  layer.minzoom = Math.max(layer.minzoom ?? 0, roadMinZoom(kind));
  if (layer.type === "line") {
    paintSet(layer, "line-color", casing ? roadCasingColor(theme, kind) : roadFillColor(theme, kind));
    paintSet(layer, "line-opacity", 1);
    paintSet(layer, "line-width", casing ? roadCasingWidth(kind) : roadFillWidth(kind));
    if (layer.paint) delete layer.paint["line-dasharray"];
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
            ? "#D2E0C8"
            : "#E8F0E0";
    const buildingOutline =
      theme.id === "white"
        ? "#E6E6E6"
        : theme.id === "neon"
          ? "#242C5C"
          : theme.id === "paper"
            ? "#DADADA"
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
        if (layer.id.includes("school")) {
          // School / university campus — very light sky blue from z12
          paintSet(layer, "fill-color", theme.id === "neon" ? "#1A3050" : "#D8E8F4");
          paintSet(layer, "fill-opacity", [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            0,
            12,
            0.55,
            14,
            0.75,
            16,
            0.85,
          ]);
          layer.minzoom = Math.min(layer.minzoom ?? 12, 12);
        } else if (layer.id.includes("hospital")) {
          paintSet(layer, "fill-color", theme.id === "neon" ? "#3A2030" : "#F0E0E4");
          paintSet(layer, "fill-opacity", [
            "interpolate",
            ["linear"],
            ["zoom"],
            13,
            0,
            14,
            0.55,
            16,
            0.8,
          ]);
          layer.minzoom = Math.min(layer.minzoom ?? 14, 14);
        } else if (layer.id.includes("wood") || layer.id.includes("forest")) {
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
          paintSet(layer, "fill-opacity", [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.28,
            8,
            0.45,
            9,
            0.82,
            11,
            0.92,
            12,
            0.95,
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
      } else if (theme.id === "paper" || theme.id === "white") {
        // z14+ light gray fill + outline; slightly stronger at z17+
        paintSet(layer, "fill-color", theme.id === "paper" ? "#E8E8E8" : theme.building);
        paintSet(layer, "fill-opacity", [
          "interpolate",
          ["linear"],
          ["zoom"],
          13.99,
          0,
          14,
          0.55,
          15,
          0.72,
          16,
          0.82,
          17,
          0.92,
          18,
          0.96,
        ]);
        paintSet(layer, "fill-outline-color", buildingOutline);
        layer.minzoom = 14;
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
      if (layer.id.includes("hatching")) {
        // White/black dash hatching reads as “broken road” — hide; overlay colours subway.
        setVisibility(layer, false);
        layers.push(layer);
        continue;
      }
      if (layer.type === "line") {
        // Far: thin gray solid (z12+). Overlay paints coloured subway on top from z12/14.
        layer.minzoom = Math.max(layer.minzoom ?? 0, 12);
        paintSet(layer, "line-color", theme.rail);
        paintSet(layer, "line-opacity", theme.id === "neon" ? 0.45 : 0.55);
        paintSet(layer, "line-width", [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          0.8,
          14,
          1.1,
          16,
          1.4,
        ]);
        if (layer.paint) {
          delete layer.paint["line-dasharray"];
          delete layer.paint["line-pattern"];
        }
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
              11,
              15,
              13,
              16,
            ];
          } else {
            // Rivers (한강 등) readable from z11–12
            layer.layout["text-size"] = [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              10,
              10,
              13,
              12,
              15,
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
            16,
            8,
            20,
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
                12,
                8,
                16,
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
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              14,
              11.5,
              16,
              12.5,
              18,
            ],
            "text-letter-spacing": 0.06,
            "text-max-width": 8,
            "text-padding": 1.5,
            "symbol-sort-key": 2000,
            visibility: "visible",
          },
          paint: {
            "text-color": theme.id === "neon" ? "#A8B0E0" : "#4A5166",
            "text-halo-color": "#FFFFFF",
            "text-halo-width": 1.5,
          },
        });
        layers.push({
          id: "label_suburb_ko",
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "place",
          filter: [
            "all",
            ["==", ["get", "class"], "suburb"],
            // z11: major only; z12+: more suburbs
            [
              "<=",
              ["to-number", ["coalesce", ["get", "rank"], 999]],
              ["step", ["zoom"], 10, 12, 22, 13, 40],
            ],
          ],
          minzoom: 11,
          maxzoom: 14,
          layout: {
            "text-field": KO_TEXT,
            "text-font": ["Noto Sans Regular"],
            "text-size": 16,
            "text-max-width": 8,
            "text-padding": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              5,
              13,
              3,
            ],
            "text-optional": true,
            // Below gu (~2000), above landmarks (~1000)
            "symbol-sort-key": [
              "-",
              1400,
              ["to-number", ["coalesce", ["get", "rank"], 999]],
            ],
            visibility: "visible",
          },
          paint: {
            "text-color": theme.id === "neon" ? "#9AA2D0" : "#4A5166",
            "text-halo-color": "#FFFFFF",
            "text-halo-width": 1.5,
          },
        });
        // 주요 동 — z12+ (rank-limited); 전부는 label_dong_ko z14+
        layers.push({
          id: "label_dong_major_ko",
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "place",
          filter: [
            "all",
            [
              "match",
              ["get", "class"],
              ["suburb", "quarter", "neighbourhood"],
              true,
              false,
            ],
            [
              "<=",
              ["to-number", ["coalesce", ["get", "rank"], 999]],
              ["step", ["zoom"], 8, 13, 18, 14, 30],
            ],
          ],
          minzoom: 12,
          maxzoom: 14,
          layout: {
            "text-field": KO_TEXT,
            "text-font": ["Noto Sans Regular"],
            "text-size": 15,
            "text-max-width": 8,
            "text-padding": 3,
            "text-optional": true,
            "symbol-sort-key": [
              "-",
              1350,
              ["to-number", ["coalesce", ["get", "rank"], 999]],
            ],
            visibility: "visible",
          },
          paint: {
            "text-color": theme.id === "neon" ? "#A8B0D8" : "#3A4155",
            "text-halo-color": "#FFFFFF",
            "text-halo-width": 1.5,
          },
        });
        // 동 이름 전부 — z14–17.5
        layers.push({
          id: "label_dong_ko",
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "place",
          filter: [
            "match",
            ["get", "class"],
            ["suburb", "quarter", "neighbourhood"],
            true,
            false,
          ],
          minzoom: 14,
          maxzoom: 17.5,
          layout: {
            "text-field": KO_TEXT,
            "text-font": ["Noto Sans Regular"],
            "text-size": 16,
            "text-max-width": 8,
            "text-padding": 1.2,
            "text-optional": true,
            "symbol-sort-key": [
              "to-number",
              ["coalesce", ["get", "rank"], 999],
            ],
            visibility: "visible",
          },
          paint: {
            "text-color": theme.id === "neon" ? "#A8B0D8" : "#3A4155",
            "text-halo-color": "#FFFFFF",
            "text-halo-width": 1.5,
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
        // Street zoom station names (shops dense) — mid-zoom uses poi_transit_mid
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
        layer.minzoom = 14;
        const layout = { ...(layer.layout || {}) };
        delete layout["icon-image"];
        delete layout["icon-size"];
        layout["text-anchor"] = "top";
        layout["text-offset"] = [0, 0.85];
        layout["text-size"] = 13;
        layout["text-field"] = KO_TEXT;
        layout["text-font"] = ["Noto Sans Bold"];
        layout["text-optional"] = false;
        layout["text-allow-overlap"] = true;
        layout["text-ignore-placement"] = true;
        layout["text-padding"] = 0.5;
        layout["symbol-sort-key"] = [
          "-",
          1600,
          ["to-number", ["coalesce", ["get", "rank"], 999]],
        ];
        layer.layout = layout;
        const quietStation =
          theme.id === "neon" ? "#A8B0C8" : theme.id === "white" ? "#5A606C" : "#3A4155";
        paintSet(layer, "text-color", quietStation);
        paintSet(layer, "text-halo-color", "#FFFFFF");
        paintSet(layer, "text-halo-width", 1.5);
      }
      // 큰 공원 이름 — z12+ with landmarks
      if (layer.id.includes("park_label") || layer.id === "label_park") {
        layer.minzoom = 12;
        paintSet(layer, "text-color", theme.id === "white" ? "#5A7A58" : theme.id === "neon" ? "#7AB8A0" : "#3F6B3A");
        paintSet(layer, "text-halo-color", "#FFFFFF");
        paintSet(layer, "text-halo-width", 1.5);
        if (layer.layout) {
          layer.layout["text-size"] = [
            "interpolate",
            ["linear"],
            ["zoom"],
            12,
            12,
            14,
            14,
          ];
          layer.layout["text-font"] = ["Noto Sans Bold"];
          layer.layout["text-padding"] = 3;
          layer.layout["symbol-sort-key"] = [
            "-",
            1200,
            ["to-number", ["coalesce", ["get", "rank"], 999]],
          ];
        }
      }
      if (layer.id.includes("mountain") || layer.id.includes("peak")) {
        // Major peaks z10+; more names as we zoom in
        layer.minzoom = 10;
        const peakFilter = layer.filter;
        layer.filter = [
          "all",
          ...(Array.isArray(peakFilter) && peakFilter[0] === "all"
            ? peakFilter.slice(1)
            : peakFilter
              ? [peakFilter]
              : []),
          ["has", "name"],
          [
            "<=",
            ["to-number", ["coalesce", ["get", "rank"], 999]],
            ["step", ["zoom"], 4, 11, 8, 12, 16, 13, 30],
          ],
        ];
        paintSet(layer, "text-color", theme.id === "neon" ? "#8A9278" : "#4A5A48");
        paintSet(layer, "text-halo-color", theme.textHalo);
        if (layer.layout) {
          layer.layout["text-size"] = [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            11,
            12,
            13,
            14,
            14,
          ];
          layer.layout["text-optional"] = true;
          layer.layout["text-padding"] = 4;
          layer.layout["symbol-sort-key"] = [
            "-",
            1700,
            ["to-number", ["coalesce", ["get", "rank"], 999]],
          ];
        }
      }
    }

    layers.push(layer);

    if (layer.id === "poi_transit") {
      const stationFilter: unknown = [
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
      const quietStation =
        theme.id === "neon" ? "#A8B0C8" : theme.id === "white" ? "#5A606C" : "#3A4155";
      // Mid-zoom names: collision-limited (OMT ranks are mostly 1 in Seoul)
      layers.splice(layers.length - 1, 0, {
        id: "poi_transit_mid",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "poi",
        minzoom: 11,
        maxzoom: 14,
        filter: stationFilter,
        layout: {
          visibility: "visible",
          "text-field": KO_TEXT,
          "text-font": ["Noto Sans Bold"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            11,
            13,
            12,
          ],
          "text-anchor": "top",
          "text-offset": [0, 0.7],
          "text-optional": false,
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-padding": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            14,
            12,
            13,
            13,
            1.8,
          ],
          "symbol-sort-key": 1600,
          "symbol-z-order": "source",
        },
        paint: {
          "text-color": quietStation,
          "text-halo-color": "#FFFFFF",
          "text-halo-width": 1.5,
        },
      });
      layers.splice(layers.length - 1, 0, {
        id: "subway_station_dot",
        type: "circle",
        source: "openmaptiles",
        "source-layer": "poi",
        minzoom: 11,
        maxzoom: 14,
        filter: stationFilter,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            2.0,
            13,
            2.8,
          ],
          "circle-color": theme.stationDot,
          "circle-opacity": 0.88,
          "circle-stroke-width": theme.id === "neon" ? 1.3 : 1.0,
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
    korea_major_labels: {
      type: "geojson",
      data: koreaMajorLabelsGeoJson(),
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
        14,
        9,
        20,
      ],
      "text-padding": 3,
      "text-max-width": 8,
      "text-optional": true,
      "text-allow-overlap": false,
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#8A92B8" : "#6A6570",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
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
      "text-size": 14,
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
      // z10–11 keep denser; z12+ reach ≥18px (Kakao-like)
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        14,
        11.5,
        16,
        12.5,
        18,
      ],
      "text-letter-spacing": 0.08,
      "text-max-width": 8,
      "text-padding": 1.5,
      // Gu wins over dong / landmark / mountain when colliding
      "symbol-sort-key": 2000,
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#A8B0E0" : "#4A5166",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
    },
  });
  // Famous 동 — z11+ (OMT suburb sparse until later)
  layers.push({
    id: "label_korea_dong_overlay",
    type: "symbol",
    source: "korea_major_labels",
    filter: [
      "all",
      ["==", ["get", "kind"], "dong"],
      [
        "<=",
        ["to-number", ["coalesce", ["get", "priority"], 99]],
        ["step", ["zoom"], 6, 12, 8, 13, 50],
      ],
    ],
    minzoom: 11,
    maxzoom: 14,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        14,
        13,
        16,
      ],
      "text-max-width": 8,
      "text-padding": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        5,
        12,
        3.5,
        13,
        1.6,
      ],
      "text-optional": true,
      "symbol-sort-key": [
        "-",
        1450,
        ["to-number", ["coalesce", ["get", "priority"], 50]],
      ],
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#A8B0D8" : "#3A4155",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
    },
  });
  layers.push({
    id: "label_korea_mountain_overlay",
    type: "symbol",
    source: "korea_major_labels",
    filter: [
      "all",
      ["==", ["get", "kind"], "mountain"],
      [
        "<=",
        ["to-number", ["coalesce", ["get", "priority"], 99]],
        ["step", ["zoom"], 3, 11, 4, 12, 5, 13, 12],
      ],
    ],
    minzoom: 10,
    maxzoom: 14,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        12,
        12,
        13,
      ],
      "text-max-width": 8,
      "text-padding": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        5,
        13,
        1.2,
      ],
      "text-optional": true,
      // Few peaks — always show when in view; do not crowd other labels out
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "symbol-sort-key": [
        "-",
        1750,
        ["to-number", ["coalesce", ["get", "priority"], 50]],
      ],
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#8A9278" : "#4A5A48",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
    },
  });
  layers.push({
    id: "label_korea_landmark_overlay",
    type: "symbol",
    source: "korea_major_labels",
    filter: [
      "all",
      ["==", ["get", "kind"], "landmark"],
      [
        "<=",
        ["to-number", ["coalesce", ["get", "priority"], 99]],
        ["step", ["zoom"], 5, 12, 7],
      ],
    ],
    minzoom: 11.5,
    maxzoom: 13,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-max-width": 8,
      "text-padding": 3.5,
      "text-optional": true,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": [
        "-",
        1050,
        ["to-number", ["coalesce", ["get", "priority"], 50]],
      ],
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#A8B0E0" : "#5A6B8C",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
    },
  });
  layers.push({
    id: "label_korea_landmark_overlay_z13",
    type: "symbol",
    source: "korea_major_labels",
    filter: [
      "all",
      ["==", ["get", "kind"], "landmark"],
      ["<=", ["to-number", ["coalesce", ["get", "priority"], 99]], 28],
    ],
    minzoom: 13,
    maxzoom: 14,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 13,
      "text-max-width": 8,
      "text-padding": 1.0,
      "text-optional": true,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "symbol-sort-key": [
        "-",
        1050,
        ["to-number", ["coalesce", ["get", "priority"], 50]],
      ],
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#A8B0E0" : "#5A6B8C",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
    },
  });

  // No transportation_name labels (road / bridge names) — place / water / station stay.

  // Shop/facility names (z14+) below landmarks; adapter pins added later on top
  appendShopPoiLayers(layers, theme);
  appendBusStopLayers(layers);
  // Neighborhood anchors — after shops so they paint above and keep placement priority
  appendLandmarkLayers(layers, theme);

  style.layers = layers;
  style.name = `pindmap-${theme.id}`;
  return style;
}


/** @deprecated alias — prefer buildPindmapStyle */
export const buildPreviewStyle = buildPindmapStyle;
