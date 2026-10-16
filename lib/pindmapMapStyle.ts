/**
 * PindMap MapLibre basemap styles (OpenFreeMap / OpenMapTiles).
 * Production themes: paper, white.
 * Admin MapLibre + preview: neon.
 * Preview-only extras: black, mono, dark (used by /map-preview).
 */

import { koreaGuLabelsGeoJson } from "@/lib/koreaGuLabels";
import {
  KOREA_MAJOR_LABELS,
  koreaMajorLabelsGeoJson,
} from "@/lib/koreaMajorLabels";
import { koreaPlaceLabelsGeoJson } from "@/lib/koreaPlaceLabels";
import { KOREA_LANDMARK_NAME_BLOCKLIST } from "@/lib/mapSurface/koreaLandmarkNameBlocklist";
import { labelNameBlocklistVariants } from "@/lib/mapSurface/labelNameDedup";
import {
  ADMIN_VARIABLE_ANCHOR,
  DONG_TEXT,
  GEOJSON_NAME_TEXT,
  ICON_TEXT_RADIAL_OFFSET,
  KO_TEXT,
  PLACE_TEXT_PADDING,
  PLACE_VARIABLE_ANCHOR,
  SHOP_TEXT,
} from "@/lib/mapSurface/mapLabelText";

/** Exact-match blocklist expanded with shorter inclusion variants for OMT filters. */
const OMT_NAME_BLOCKLIST: string[] = (() => {
  const names = new Set<string>();
  for (const n of KOREA_LANDMARK_NAME_BLOCKLIST) {
    for (const v of labelNameBlocklistVariants(n)) names.add(v);
  }
  for (const g of KOREA_MAJOR_LABELS) {
    if (g.kind === "landmark" || g.kind === "mountain") {
      for (const v of labelNameBlocklistVariants(g.name)) names.add(v);
    }
  }
  return [...names];
})();
import {
  poiCategoryIconImageExpr,
  poiCategoryTextColorExpr,
} from "@/lib/mapSurface/poiCategoryIcons";
import {
  applySelfHostedStyleAssets,
  applySelfTilesSource,
  ensureSelfTilesProtocolRegistered,
  readSelfTilesEnabled,
  warmSelfTilesOrBreak,
} from "@/lib/mapSurface/selfTiles";
import bundledLibertyStyle from "@/lib/mapSurface/data/liberty-style.json";

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

/** Fallback only if bundled snapshot is missing (should never run in prod). */
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

/**
 * Hide OMT POI/place labels whose display name duplicates a korea-landmarks entry.
 * (Spatial 500m join is not available in style filters — name match is the gate.)
 */
function notDuplicateKoreaLandmarkName(): unknown {
  return [
    "!",
    [
      "match",
      ["to-string", ["coalesce", ["get", "name:ko"], ["get", "name"], ""]],
      OMT_NAME_BLOCKLIST,
      true,
      false,
    ],
  ];
}

/**
 * Neighborhood anchor labels from OpenMapTiles `poi`.
 * Shops/cafes use shop_poi_* layers (z14+). Landmarks always stack above shops.
 * Color groups: culture | medical | transit.
 */
/** Core landmarks — no zoom in filter (MapLibre ignores ["zoom"] in filters). */
const LANDMARK_FILTER_CORE: unknown = [
  "any",
  ["==", ["get", "class"], "school"],
  ["==", ["get", "class"], "college"],
  ["==", ["get", "subclass"], "university"],
  [
    "all",
    ["==", ["get", "class"], "hospital"],
    ["==", ["get", "subclass"], "hospital"],
  ],
  ["==", ["get", "class"], "park"],
  [
    "all",
    ["==", ["get", "class"], "grocery"],
    ["==", ["get", "subclass"], "marketplace"],
  ],
  ["==", ["get", "class"], "town_hall"],
  ["==", ["get", "class"], "police"],
  [
    "all",
    ["==", ["get", "class"], "post"],
    ["==", ["get", "subclass"], "post_office"],
  ],
  ["==", ["get", "class"], "museum"],
  ["==", ["get", "class"], "stadium"],
  ["==", ["get", "class"], "attraction"],
];

/** Playgrounds only from street zoom — separate layer with minzoom:15. */
const LANDMARK_FILTER_PLAYGROUND: unknown = [
  "any",
  ["==", ["get", "class"], "playground"],
  ["==", ["get", "subclass"], "playground"],
];

const NOT_KINDERGARTEN: unknown = [
  "!",
  ["==", ["get", "subclass"], "kindergarten"],
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

function landmarkGroupColor(theme: MapPreviewTheme): unknown {
  return poiCategoryTextColorExpr(theme.id);
}

/** Custom addImage icons (pind-poi-*) — replaces Liberty *_11 sprites. */
function poiSpriteIcon(): unknown {
  return poiCategoryIconImageExpr();
}

function appendLandmarkLayers(layers: AnyLayer[], theme: MapPreviewTheme): void {
  const color = landmarkGroupColor(theme);
  // Above shops (≤850); below korea-landmark tiers (~1650+) and stations (~2000)
  const sortKey: unknown = ["-", 1500, ["to-number", ["coalesce", ["get", "rank"], 999]]];

  // Zoom-split rank caps — ["zoom"] inside filter is NOT re-evaluated by MapLibre.
  const bands: Array<{
    id: string;
    minzoom: number;
    maxzoom?: number;
    rankMax: number;
    classFilter: unknown;
    excludeKindergarten: boolean;
  }> = [
    {
      id: "landmark_label",
      minzoom: 11,
      maxzoom: 12,
      rankMax: 6,
      classFilter: LANDMARK_FILTER_CORE,
      excludeKindergarten: true,
    },
    {
      id: "landmark_label_z12",
      minzoom: 12,
      maxzoom: 13,
      rankMax: 8,
      classFilter: LANDMARK_FILTER_CORE,
      excludeKindergarten: true,
    },
    {
      id: "landmark_label_z13",
      minzoom: 13,
      maxzoom: 14,
      rankMax: 12,
      classFilter: LANDMARK_FILTER_CORE,
      excludeKindergarten: true,
    },
    {
      id: "landmark_label_z14",
      minzoom: 14,
      maxzoom: 15,
      rankMax: 4,
      classFilter: LANDMARK_FILTER_CORE,
      excludeKindergarten: true,
    },
    {
      // Keep legacy id for e2e / deferred-decoration hooks
      id: "landmark_label_street",
      minzoom: 15,
      maxzoom: 16,
      rankMax: 40,
      classFilter: LANDMARK_FILTER_CORE,
      excludeKindergarten: false,
    },
    {
      id: "landmark_label_z16",
      minzoom: 16,
      maxzoom: 17,
      rankMax: 70,
      classFilter: LANDMARK_FILTER_CORE,
      excludeKindergarten: false,
    },
    {
      id: "landmark_label_z17",
      minzoom: 17,
      rankMax: 100,
      classFilter: LANDMARK_FILTER_CORE,
      excludeKindergarten: false,
    },
    {
      id: "landmark_label_playground",
      minzoom: 15,
      rankMax: 40,
      classFilter: LANDMARK_FILTER_PLAYGROUND,
      excludeKindergarten: true,
    },
  ];

  for (const band of bands) {
    const filter: unknown = [
      "all",
      band.classFilter,
      NOT_AIRFIELD,
      ["has", "name"],
      notDuplicateKoreaLandmarkName(),
      ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], band.rankMax],
      ...(band.excludeKindergarten ? [NOT_KINDERGARTEN] : []),
    ];
    layers.push({
      id: band.id,
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: band.minzoom,
      ...(band.maxzoom != null ? { maxzoom: band.maxzoom } : {}),
      filter,
      layout: {
        visibility: "visible",
        "icon-image": poiSpriteIcon(),
        "icon-size": 1,
        "icon-optional": true,
        "text-field": KO_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": 13,
        "text-variable-anchor": [...PLACE_VARIABLE_ANCHOR],
        "text-radial-offset": ICON_TEXT_RADIAL_OFFSET,
        "text-max-width": 7,
        "text-padding": PLACE_TEXT_PADDING,
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
        "text-halo-blur": 0,
        "icon-opacity": 0.95,
      },
    });
  }
}

/** Overpass GeoJSON — famous buildings / venues by tier (z11 / z13 / z15). */
function appendKoreaLandmarkGeoLayers(
  layers: AnyLayer[],
  theme: MapPreviewTheme,
): void {
  const color =
    theme.id === "neon" ? "#A8B0E0" : theme.id === "white" ? "#4A5A78" : "#2E2E36";
  const tiers: Array<{
    id: string;
    tier: number;
    minzoom: number;
    maxzoom?: number;
    textSize: number;
    sortBase: number;
    filter: unknown;
  }> = [
    // z11–13: tier1 only — collision caps ~12 on screen
    {
      id: "korea_landmark_tier1_far",
      tier: 1,
      minzoom: 11,
      maxzoom: 12.5,
      textSize: 14,
      sortBase: 1050,
      filter: [
        "all",
        ["==", ["get", "tier"], 1],
        [
          "any",
          [
            "match",
            ["get", "kind"],
            ["tower", "stadium", "palace", "theme_park"],
            true,
            false,
          ],
          [">=", ["to-number", ["coalesce", ["get", "height"], 0]], 250],
        ],
      ],
    },
    {
      id: "korea_landmark_tier1",
      tier: 1,
      minzoom: 12.5,
      textSize: 14,
      sortBase: 1550,
      filter: ["==", ["get", "tier"], 1],
    },
    // z13+: tier1 + tier2 (z11–12 stay tier1-only via this minzoom)
    {
      id: "korea_landmark_tier2",
      tier: 2,
      minzoom: 13,
      textSize: 13,
      sortBase: 1520,
      filter: ["==", ["get", "tier"], 2],
    },
    {
      id: "korea_landmark_tier3",
      tier: 3,
      minzoom: 15,
      textSize: 13,
      sortBase: 1510,
      filter: ["==", ["get", "tier"], 3],
    },
  ];
  for (const t of tiers) {
    layers.push({
      id: t.id,
      type: "symbol",
      source: "korea_landmarks",
      minzoom: t.minzoom,
      ...(t.maxzoom != null ? { maxzoom: t.maxzoom } : {}),
      filter: t.filter,
      layout: {
        visibility: "visible",
        "icon-image": "korea-landmark-building",
        "icon-size": 1,
        "icon-optional": false,
        "text-field": GEOJSON_NAME_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": t.textSize,
        "text-variable-anchor": [...PLACE_VARIABLE_ANCHOR],
        "text-radial-offset": ICON_TEXT_RADIAL_OFFSET,
        "text-max-width": 7,
        "text-padding": PLACE_TEXT_PADDING,
        "text-optional": false,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        "symbol-sort-key": t.sortBase,
        "symbol-z-order": "source",
      },
      paint: {
        "text-color": color,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.5,
        "text-halo-blur": 0,
        "icon-opacity": 0.92,
      },
    });
  }
}

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

/** Category text colors — same family as icon fills (muted paper). */
function shopPoiColor(theme: MapPreviewTheme): unknown {
  return poiCategoryTextColorExpr(theme.id);
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
          ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 30],
        ],
      ],
      textPadding: [
        "interpolate",
        ["linear"],
        ["zoom"],
        14,
        16,
        15,
        12,
        16,
        9,
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
        12,
        16,
        9,
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
      notDuplicateKoreaLandmarkName(),
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
        "icon-size": 1,
        "icon-padding": 1,
        "icon-optional": false,
        "text-field": SHOP_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": 12.5,
        "text-variable-anchor": [...PLACE_VARIABLE_ANCHOR],
        "text-radial-offset": ICON_TEXT_RADIAL_OFFSET,
        // ~2 lines; long Latin shops truncated in SHOP_TEXT
        "text-max-width": 6,
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
        "text-halo-blur": 0,
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
      "icon-image": "pind-poi-bus",
      "icon-size": 0.75,
      "icon-optional": false,
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
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
let libertyLoadPromise: Promise<StyleJson> | null = null;

/** Drop in-memory liberty cache after a style/load failure so the next attempt refetches. */
export function invalidateLibertyStyleCache(): void {
  cachedLiberty = null;
  libertyLoadPromise = null;
}

/**
 * Liberty base style — bundled JSON (no network). Race-safe single load.
 * Network fetch is a last-resort fallback only.
 */
export async function fetchLibertyStyle(): Promise<StyleJson> {
  if (cachedLiberty) {
    return structuredClone(cachedLiberty);
  }
  if (!libertyLoadPromise) {
    libertyLoadPromise = (async () => {
      const bundled = bundledLibertyStyle as StyleJson;
      if (bundled?.version === 8 && Array.isArray(bundled.layers)) {
        cachedLiberty = bundled;
        return structuredClone(bundled);
      }
      const res = await fetch(LIBERTY_STYLE_URL);
      if (!res.ok) {
        throw new Error(`OpenFreeMap style fetch failed: ${res.status}`);
      }
      const json = (await res.json()) as StyleJson;
      cachedLiberty = json;
      return structuredClone(json);
    })();
  }
  return libertyLoadPromise.then((j) => structuredClone(j));
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
  // Admin self-tiles: PMTiles vector source only; keep OFM glyphs+sprite
  // (incomplete same-origin glyphs 404 → MapLibre treats tile as empty).
  // On hard PMTiles failure, leave OFM tiles (already tracked as self_tiles_error).
  if (typeof window !== "undefined" && readSelfTilesEnabled()) {
    ensureSelfTilesProtocolRegistered();
    const ok = await warmSelfTilesOrBreak();
    if (ok) {
      applySelfTilesSource(style);
      applySelfHostedStyleAssets(style);
    }
  }
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
        } else if (layer.id.includes("cemetery")) {
          // Soft cool gray-green — paper tone
          paintSet(
            layer,
            "fill-color",
            theme.id === "neon" ? "#1A2820" : theme.id === "white" ? "#E8EEE6" : "#DDE4DA",
          );
          paintSet(layer, "fill-opacity", [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            0,
            12,
            0.45,
            15,
            0.65,
          ]);
          layer.minzoom = Math.min(layer.minzoom ?? 12, 12);
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
      // Country (admin 2): keep very subtle. Gu/gun + sido added as dedicated layers below.
      if (layer.id === "boundary_2") {
        paintSet(layer, "line-color", theme.boundary);
        paintSet(layer, "line-opacity", theme.id === "neon" ? 0.25 : 0.35);
        paintSet(layer, "line-width", 0.6);
        layer.minzoom = 3;
        layer.maxzoom = 8;
      } else if (layer.id === "boundary_3") {
        // Hide bundled 3–6; replaced by sido/gu layers with distinct dash styles
        setVisibility(layer, false);
      } else {
        paintSet(layer, "line-color", theme.boundary);
        paintSet(layer, "line-opacity", 0.35);
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
        // Ocean/sea names early; stream/line names later so they don't double place names
        const isLineWater =
          /waterway|line/i.test(layer.id) && !/point/i.test(layer.id);
        layer.minzoom = isLineWater ? 14 : 5;
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
            // Major rivers (한강) via point labels; line labels from z14
            layer.layout["text-size"] = [
              "interpolate",
              ["linear"],
              ["zoom"],
              14,
              12,
              16,
              14,
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
        // Primary = metro (Regular; wins collision by layer order below)
        layer.filter = ["all", metroNameFilter, nkAdminHide];
        paintSet(layer, "text-color", metroColor);
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.6);
        if (layer.layout) {
          layer.layout["text-field"] = SHORT_CITY_KO;
          layer.layout["text-font"] = ["Noto Sans Regular"];
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
          layer.layout["text-allow-overlap"] = false;
          layer.layout["text-ignore-placement"] = false;
          layer.layout["symbol-sort-key"] = [
            "match",
            ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
            ["서울", "서울특별시"],
            0,
            10,
          ];
          // Drop OFM circle_11_* sprite — text-only place labels (no sprite dependency).
          delete layer.layout["icon-image"];
          delete layer.layout["icon-size"];
          delete layer.layout["icon-offset"];
        }
        if (isCity) {
          // Other cities first — zoom-split rank (no ["zoom"] in filter)
          const cityOtherBands: Array<{
            id: string;
            minzoom: number;
            maxzoom: number;
            rankMax: number;
          }> = [
            { id: "label_city_other_ko", minzoom: 5.5, maxzoom: 6.5, rankMax: 6 },
            {
              id: "label_city_other_ko_z65",
              minzoom: 6.5,
              maxzoom: 7.5,
              rankMax: 10,
            },
            {
              id: "label_city_other_ko_z75",
              minzoom: 7.5,
              maxzoom: 9,
              rankMax: 18,
            },
            {
              id: "label_city_other_ko_z9",
              minzoom: 9,
              maxzoom: 10,
              rankMax: 40,
            },
          ];
          for (const band of cityOtherBands) {
          layers.push({
            id: band.id,
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
              [
                "<=",
                ["to-number", ["coalesce", ["get", "rank"], 999]],
                band.rankMax,
              ],
            ],
            minzoom: band.minzoom,
            maxzoom: band.maxzoom,
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
              "text-padding": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5.5,
                8,
                7,
                5,
                9,
                3,
              ],
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
          }
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
        // Town metros stay here; city metros re-asserted as label_metro_ko after si
        if (!isCity) layers.push(layer);
        continue;
      }
      if (layer.id === "label_village") {
        // 읍·면 (OMT village) — z11+ (z9–10 stay 시·군·구 only)
        layer.minzoom = 11;
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
          delete layer.layout["icon-image"];
          delete layer.layout["icon-size"];
          delete layer.layout["icon-offset"];
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
            "text-size": 17,
            "text-letter-spacing": 0.05,
            "text-max-width": 7,
            "text-padding": PLACE_TEXT_PADDING,
            "text-variable-anchor": [...ADMIN_VARIABLE_ANCHOR],
            "symbol-sort-key": 2000,
            visibility: "visible",
          },
          paint: {
            "text-color": theme.id === "neon" ? "#A8B0E0" : "#8A8A92",
            "text-halo-color": "#FFFFFF",
            "text-halo-width": 1.5,
          },
        });
        // Suburb rank caps split by minzoom (zoom-in-filter is ignored).
        const suburbBands: Array<{
          id: string;
          minzoom: number;
          maxzoom: number;
          rankMax: number;
        }> = [
          { id: "label_suburb_ko", minzoom: 11, maxzoom: 12, rankMax: 16 },
          { id: "label_suburb_ko_z12", minzoom: 12, maxzoom: 13, rankMax: 30 },
          { id: "label_suburb_ko_z13", minzoom: 13, maxzoom: 14, rankMax: 50 },
        ];
        for (const band of suburbBands) {
          layers.push({
            id: band.id,
            type: "symbol",
            source: "openmaptiles",
            "source-layer": "place",
            filter: [
              "all",
              ["==", ["get", "class"], "suburb"],
              [
                "<=",
                ["to-number", ["coalesce", ["get", "rank"], 999]],
                band.rankMax,
              ],
            ],
            minzoom: band.minzoom,
            maxzoom: band.maxzoom,
            layout: {
              "text-field": DONG_TEXT,
              "text-font": ["Noto Sans Regular"],
              "text-size": 15,
              "text-max-width": 7,
              "text-padding": PLACE_TEXT_PADDING,
              "text-variable-anchor": [...ADMIN_VARIABLE_ANCHOR],
              "text-optional": true,
              "symbol-sort-key": [
                "-",
                1400,
                ["to-number", ["coalesce", ["get", "rank"], 999]],
              ],
              visibility: "visible",
            },
            paint: {
              "text-color": theme.id === "neon" ? "#9AA2D0" : "#8A8A92",
              "text-halo-color": "#FFFFFF",
              "text-halo-width": 1.5,
            },
          });
        }
        // 주요 동 — z12+ (rank-limited); 전부는 label_dong_ko z14+
        const dongMajorBands: Array<{
          id: string;
          minzoom: number;
          maxzoom: number;
          rankMax: number;
        }> = [
          { id: "label_dong_major_ko", minzoom: 12, maxzoom: 13, rankMax: 14 },
          {
            id: "label_dong_major_ko_z13",
            minzoom: 13,
            maxzoom: 14,
            rankMax: 26,
          },
        ];
        for (const band of dongMajorBands) {
          layers.push({
            id: band.id,
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
                band.rankMax,
              ],
            ],
            minzoom: band.minzoom,
            maxzoom: band.maxzoom,
            layout: {
              "text-field": DONG_TEXT,
              "text-font": ["Noto Sans Regular"],
              "text-size": 15,
              "text-max-width": 7,
              "text-padding": PLACE_TEXT_PADDING,
              "text-variable-anchor": [...ADMIN_VARIABLE_ANCHOR],
              "text-optional": true,
              "symbol-sort-key": [
                "-",
                1350,
                ["to-number", ["coalesce", ["get", "rank"], 999]],
              ],
              visibility: "visible",
            },
            paint: {
              "text-color": theme.id === "neon" ? "#A8B0D8" : "#8A8A92",
              "text-halo-color": "#FFFFFF",
              "text-halo-width": 1.5,
            },
          });
        }
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
            "text-field": DONG_TEXT,
            "text-font": ["Noto Sans Regular"],
            "text-size": 15,
            "text-max-width": 7,
            "text-padding": PLACE_TEXT_PADDING,
            "text-variable-anchor": [...ADMIN_VARIABLE_ANCHOR],
            "text-optional": true,
            "symbol-sort-key": [
              "to-number",
              ["coalesce", ["get", "rank"], 999],
            ],
            visibility: "visible",
          },
          paint: {
            "text-color": theme.id === "neon" ? "#A8B0D8" : "#8A8A92",
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
        // OMT station names duplicate platforms; replaced by korea_station_labels below
        continue;
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
          layer.layout["text-font"] = ["Noto Sans Regular"];
          layer.layout["text-padding"] = PLACE_TEXT_PADDING;
          layer.layout["text-variable-anchor"] = [...ADMIN_VARIABLE_ANCHOR];
          layer.layout["text-max-width"] = 7;
          layer.layout["symbol-sort-key"] = [
            "-",
            1800,
            ["to-number", ["coalesce", ["get", "rank"], 999]],
          ];
        }
      }
      if (layer.id.includes("mountain") || layer.id.includes("peak")) {
        // Hide base Liberty peak layer — replaced by zoom-split mountain_peak_label_* below
        setVisibility(layer, false);
        layers.push(layer);
        continue;
      }
    }

    layers.push(layer);
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
    korea_landmarks: {
      type: "geojson",
      data: "/map/korea-landmarks.geojson",
      attribution: "© OpenStreetMap contributors",
    },
    korea_station_labels: {
      type: "geojson",
      data: "/map/korea-station-labels.geojson",
      attribution: "© OpenStreetMap contributors",
    },
  };
  const quietStation =
    theme.id === "neon" ? "#A8B0C8" : theme.id === "white" ? "#5A606C" : "#444A54";
  // Merged station names (300m same-name → one). Keep layer ids for e2e.
  layers.push({
    id: "subway_station_dot",
    type: "circle",
    source: "korea_station_labels",
    minzoom: 11,
    maxzoom: 14,
    filter: ["==", ["get", "midzoom"], 1],
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
  // Transfer hub badge (multi-line stations after 300m merge)
  layers.push({
    id: "station_line_badge_0",
    type: "circle",
    source: "korea_station_labels",
    minzoom: 13,
    filter: ["==", ["get", "transfer"], 1],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        13,
        3.4,
        16,
        4.6,
      ],
      "circle-color": "#FFFFFF",
      "circle-stroke-width": 1.6,
      "circle-stroke-color": theme.stationDot,
      "circle-opacity": 0.95,
    },
  });
  // z11–13: curated midzoom hubs only (spread-out map would otherwise show 30+). z14+: all.
  layers.push({
    id: "poi_transit_mid",
    type: "symbol",
    source: "korea_station_labels",
    minzoom: 11,
    maxzoom: 14,
    filter: ["==", ["get", "midzoom"], 1],
    layout: {
      visibility: "visible",
      "text-field": GEOJSON_NAME_TEXT,
      "text-font": ["Noto Sans Regular"],
      "text-size": 13.5,
      "text-variable-anchor": [...PLACE_VARIABLE_ANCHOR],
      "text-radial-offset": 0.7,
      "text-max-width": 7,
      // Mid-zoom: slightly roomier padding so sparse hubs don't crowd gu/dong.
      "text-padding": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        4,
        13,
        3,
      ],
      "text-optional": false,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": [
        "-",
        2200,
        ["to-number", ["coalesce", ["get", "merged"], 1]],
      ],
      "symbol-z-order": "source",
    },
    paint: {
      "text-color": quietStation,
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
    },
  });
  layers.push({
    id: "poi_transit",
    type: "symbol",
    source: "korea_station_labels",
    minzoom: 14,
    layout: {
      visibility: "visible",
      "text-field": GEOJSON_NAME_TEXT,
      "text-font": ["Noto Sans Regular"],
      "text-size": 13.5,
      "text-variable-anchor": [...PLACE_VARIABLE_ANCHOR],
      "text-radial-offset": 0.75,
      "text-max-width": 7,
      "text-padding": PLACE_TEXT_PADDING,
      "text-optional": false,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": [
        "-",
        2200,
        ["to-number", ["coalesce", ["get", "merged"], 1]],
      ],
      "symbol-z-order": "source",
    },
    paint: {
      "text-color": quietStation,
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
    },
  });
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
      "text-padding": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6,
        6,
        8,
        3,
      ],
      "text-max-width": 8,
      "text-optional": true,
      "text-allow-overlap": false,
      // Below OMT metros (label_city painted earlier in liberty order is
      // re-ordered via symbol-sort-key 0 for Seoul); keep si supplement secondary
      "symbol-sort-key": 50,
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#8A92B8" : "#6A6570",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
    },
  });
  // label_city (metros) after korea_place_si so Seoul wins nationwide collision
  layers.push({
    id: "label_city",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "place",
    filter: [
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
      ],
      true,
      false,
    ],
    minzoom: 5,
    maxzoom: 10,
    layout: {
      "text-field": SHORT_CITY_KO,
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        16,
        8,
        20,
      ],
      "text-padding": 2,
      "text-max-width": 8,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": [
        "match",
        ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
        ["서울", "서울특별시"],
        0,
        10,
      ],
      visibility: "visible",
    },
    paint: {
      "text-color":
        theme.id === "neon" ? "#D0D4F0" : theme.id === "white" ? "#2A3348" : "#2A3144",
      "text-halo-color": theme.textHalo,
      "text-halo-width": 1.6,
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
      "text-size": 17,
      "text-letter-spacing": 0.05,
      "text-max-width": 7,
      "text-padding": PLACE_TEXT_PADDING,
      "text-variable-anchor": [...ADMIN_VARIABLE_ANCHOR],
      // Gu wins over dong / landmark / mountain when colliding
      "symbol-sort-key": 2000,
      visibility: "visible",
    },
    paint: {
      "text-color": theme.id === "neon" ? "#A8B0E0" : "#8A8A92",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5,
    },
  });
  // Famous 동 — zoom-split priority (["zoom"] in filter is ignored)
  const koreaDongBands: Array<{
    id: string;
    minzoom: number;
    maxzoom: number;
    priorityMax: number;
  }> = [
    { id: "label_korea_dong_overlay", minzoom: 11, maxzoom: 12, priorityMax: 10 },
    {
      id: "label_korea_dong_overlay_z12",
      minzoom: 12,
      maxzoom: 13,
      priorityMax: 16,
    },
    {
      id: "label_korea_dong_overlay_z13",
      minzoom: 13,
      maxzoom: 14,
      priorityMax: 50,
    },
  ];
  for (const band of koreaDongBands) {
    layers.push({
      id: band.id,
      type: "symbol",
      source: "korea_major_labels",
      filter: [
        "all",
        ["==", ["get", "kind"], "dong"],
        [
          "<=",
          ["to-number", ["coalesce", ["get", "priority"], 99]],
          band.priorityMax,
        ],
      ],
      minzoom: band.minzoom,
      maxzoom: band.maxzoom,
      layout: {
        "text-field": DONG_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": 15,
        "text-max-width": 7,
        "text-padding": PLACE_TEXT_PADDING,
        "text-variable-anchor": [...ADMIN_VARIABLE_ANCHOR],
        "text-optional": true,
        "symbol-sort-key": [
          "-",
          1450,
          ["to-number", ["coalesce", ["get", "priority"], 50]],
        ],
        visibility: "visible",
      },
      paint: {
        "text-color": theme.id === "neon" ? "#A8B0D8" : "#8A8A92",
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.5,
      },
    });
  }
  const koreaMountainBands: Array<{
    id: string;
    minzoom: number;
    maxzoom: number;
    priorityMax: number;
  }> = [
    {
      id: "label_korea_mountain_overlay",
      minzoom: 10,
      maxzoom: 11,
      priorityMax: 3,
    },
    {
      id: "label_korea_mountain_overlay_z11",
      minzoom: 11,
      maxzoom: 12,
      priorityMax: 4,
    },
    {
      id: "label_korea_mountain_overlay_z12",
      minzoom: 12,
      maxzoom: 13,
      priorityMax: 5,
    },
    {
      id: "label_korea_mountain_overlay_z13",
      minzoom: 13,
      maxzoom: 14,
      priorityMax: 12,
    },
  ];
  for (const band of koreaMountainBands) {
    layers.push({
      id: band.id,
      type: "symbol",
      source: "korea_major_labels",
      filter: [
        "all",
        ["==", ["get", "kind"], "mountain"],
        [
          "<=",
          ["to-number", ["coalesce", ["get", "priority"], 99]],
          band.priorityMax,
        ],
      ],
      minzoom: band.minzoom,
      maxzoom: band.maxzoom,
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
        "text-allow-overlap": false,
        "text-ignore-placement": false,
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
  }
  const koreaLandmarkBands: Array<{
    id: string;
    minzoom: number;
    maxzoom: number;
    priorityMax: number;
    textSize: number;
  }> = [
    {
      id: "label_korea_landmark_overlay",
      minzoom: 11.5,
      maxzoom: 12,
      priorityMax: 5,
      textSize: 12,
    },
    {
      id: "label_korea_landmark_overlay_z12",
      minzoom: 12,
      maxzoom: 13,
      priorityMax: 7,
      textSize: 12,
    },
    {
      id: "label_korea_landmark_overlay_z13",
      minzoom: 13,
      maxzoom: 14,
      priorityMax: 28,
      textSize: 13,
    },
  ];
  for (const band of koreaLandmarkBands) {
    layers.push({
      id: band.id,
      type: "symbol",
      source: "korea_major_labels",
      filter: [
        "all",
        ["==", ["get", "kind"], "landmark"],
        [
          "<=",
          ["to-number", ["coalesce", ["get", "priority"], 99]],
          band.priorityMax,
        ],
      ],
      minzoom: band.minzoom,
      maxzoom: band.maxzoom,
      layout: {
        "text-field": GEOJSON_NAME_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": band.textSize,
        "text-max-width": 7,
        "text-padding": PLACE_TEXT_PADDING,
        "text-variable-anchor": [...PLACE_VARIABLE_ANCHOR],
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
  }

  // No transportation_name labels (road / bridge names) — place / water / station stay.

  // Insert special landuse fills under roads/buildings (after park/school fills)
  const specialFills: Array<{
    id: string;
    filter: unknown;
    color: string;
    minzoom: number;
  }> = [
    {
      id: "landuse_golf",
      filter: [
        "any",
        ["==", ["get", "class"], "golf_course"],
        ["==", ["get", "subclass"], "golf_course"],
      ],
      color: theme.id === "neon" ? "#1A3328" : "#D0E0C8",
      minzoom: 11,
    },
    {
      id: "landuse_military",
      filter: ["==", ["get", "class"], "military"],
      color: theme.id === "neon" ? "#2A2820" : "#E2E0D6",
      minzoom: 11,
    },
    {
      id: "landuse_airport",
      filter: [
        "any",
        ["==", ["get", "class"], "aerodrome"],
        ["==", ["get", "class"], "airport"],
      ],
      color: theme.id === "neon" ? "#1A2238" : "#D8DCE6",
      minzoom: 10,
    },
    {
      id: "landuse_harbour",
      filter: [
        "any",
        ["==", ["get", "class"], "harbour"],
        ["==", ["get", "class"], "harbor"],
        ["==", ["get", "class"], "port"],
      ],
      color: theme.id === "neon" ? "#182838" : "#D0DCE8",
      minzoom: 11,
    },
  ];
  const specialFillLayers: AnyLayer[] = specialFills.map((sf) => ({
    id: sf.id,
    type: "fill",
    source: "openmaptiles",
    "source-layer": "landuse",
    minzoom: sf.minzoom,
    filter: sf.filter,
    layout: { visibility: "visible" },
    paint: {
      "fill-color": sf.color,
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        sf.minzoom,
        0.35,
        sf.minzoom + 3,
        0.55,
      ],
    },
  }));
  const fillAnchor = layers.findIndex(
    (l) => l.id === "landuse_school" || l.id === "landuse_cemetery" || l.id === "park",
  );
  if (fillAnchor >= 0) {
    layers.splice(fillAnchor + 1, 0, ...specialFillLayers);
  } else {
    const roadIdx = layers.findIndex((l) => l.id.includes("highway") || l.id.includes("road"));
    if (roadIdx >= 0) layers.splice(roadIdx, 0, ...specialFillLayers);
    else layers.unshift(...specialFillLayers);
  }

  // 시·도 (admin 4) solid z6–11; 구·군 (admin 6) dashed z10–14 — after fills, under labels
  const boundaryColor =
    theme.id === "neon" ? "#3A4566" : theme.id === "white" ? "#C8CCD4" : "#C0C4CC";
  const boundaryLayers: AnyLayer[] = [
    {
      id: "boundary_sido",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      minzoom: 6,
      maxzoom: 11,
      filter: [
        "all",
        ["==", ["get", "admin_level"], 4],
        ["!=", ["get", "maritime"], 1],
      ],
      layout: { visibility: "visible", "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": boundaryColor,
        "line-opacity": theme.id === "neon" ? 0.35 : 0.42,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          0.6,
          10,
          1.0,
        ],
      },
    },
    {
      id: "boundary_gu",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      minzoom: 10,
      maxzoom: 14,
      filter: [
        "all",
        ["==", ["get", "admin_level"], 6],
        ["!=", ["get", "maritime"], 1],
      ],
      layout: { visibility: "visible", "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": boundaryColor,
        "line-opacity": theme.id === "neon" ? 0.22 : 0.28,
        "line-width": 0.7,
        "line-dasharray": [1.2, 2.4],
      },
    },
  ];
  const boundAnchor = layers.findIndex((l) => l.id === "boundary_2" || l.id === "boundary_3");
  if (boundAnchor >= 0) layers.splice(boundAnchor + 1, 0, ...boundaryLayers);
  else layers.push(...boundaryLayers);

  // Mountain peaks (OMT) — zoom-split rank (no ["zoom"] in filter)
  const peakBands: Array<{
    id: string;
    minzoom: number;
    maxzoom?: number;
    rankMax: number;
  }> = [
    { id: "mountain_peak_label", minzoom: 12, maxzoom: 13, rankMax: 1 },
    { id: "mountain_peak_label_z13", minzoom: 13, maxzoom: 14, rankMax: 2 },
    { id: "mountain_peak_label_z14", minzoom: 14, maxzoom: 15, rankMax: 4 },
    { id: "mountain_peak_label_z15", minzoom: 15, rankMax: 8 },
  ];
  for (const band of peakBands) {
    layers.push({
      id: band.id,
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "mountain_peak",
      minzoom: band.minzoom,
      ...(band.maxzoom != null ? { maxzoom: band.maxzoom } : {}),
      filter: [
        "all",
        ["has", "name"],
        [">=", ["to-number", ["coalesce", ["get", "ele"], 0]], 300],
        [
          "<=",
          ["to-number", ["coalesce", ["get", "rank"], 999]],
          band.rankMax,
        ],
      ],
      layout: {
        visibility: "visible",
        "text-field": [
          "case",
          [">", ["to-number", ["coalesce", ["get", "ele"], 0]], 0],
          [
            "concat",
            "▲ ",
            KO_TEXT,
            " ",
            ["to-string", ["round", ["to-number", ["get", "ele"]]]],
            "m",
          ],
          ["concat", "▲ ", KO_TEXT],
        ],
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          11,
          12,
          12.5,
          14,
          13.5,
        ],
        "text-max-width": 10,
        "text-padding": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          10,
          12,
          6,
          14,
          3,
        ],
        "text-optional": true,
        "text-allow-overlap": false,
        "symbol-sort-key": [
          "-",
          900,
          ["to-number", ["coalesce", ["get", "rank"], 999]],
        ],
      },
      paint: {
        "text-color": theme.id === "neon" ? "#8A9278" : "#4A5A48",
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.4,
      },
    });
  }

  // Islands / islets (여의도, 밤섬, …) z12+
  layers.push({
    id: "place_island_ko",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "place",
    minzoom: 12,
    filter: [
      "all",
      ["has", "name"],
      [
        "match",
        ["get", "class"],
        ["island", "islet"],
        true,
        false,
      ],
    ],
    layout: {
      visibility: "visible",
      "text-field": KO_TEXT,
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        12,
        12,
        14,
        13,
        16,
        14,
      ],
      "text-max-width": 8,
      "text-padding": 2,
      "text-optional": true,
      "symbol-sort-key": [
        "-",
        1300,
        ["to-number", ["coalesce", ["get", "rank"], 999]],
      ],
    },
    paint: {
      "text-color": theme.id === "neon" ? "#8AA0C8" : "#4A6A88",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.4,
    },
  });

  // Shop/facility names (z14+) below landmarks; adapter pins added later on top
  appendShopPoiLayers(layers, theme);
  appendBusStopLayers(layers);
  // Neighborhood anchors — after shops so they paint above and keep placement priority
  appendLandmarkLayers(layers, theme);
  // Famous buildings from Overpass GeoJSON (tier1 z11 / tier2 z13 / tier3 z15)
  appendKoreaLandmarkGeoLayers(layers, theme);

  // Stations must paint after shops/anchors/korea so high sort-key actually wins
  // cross-layer collision (later layers beat earlier ones in MapLibre).
  const stationIds = new Set([
    "poi_transit",
    "poi_transit_mid",
    "subway_station_dot",
    "station_line_badge_0",
  ]);
  const stationLayers = layers.filter((l) => stationIds.has(l.id));
  if (stationLayers.length) {
    const rest = layers.filter((l) => !stationIds.has(l.id));
    layers.length = 0;
    layers.push(...rest, ...stationLayers);
  }

  // Final pass: place/POI labels never use Bold or allow-overlap
  // (saved/search/my-location pins are added later by adapters, not here).
  for (const layer of layers) {
    if (layer.type !== "symbol") continue;
    const id = layer.id;
    if (/pin|myloc|search|route|cluster/i.test(id)) continue;
    const prevFont = layer.layout?.["text-font"];
    const keepItalic =
      id.startsWith("water") &&
      Array.isArray(prevFont) &&
      String(prevFont[0] || "").includes("Italic");
    const layout = { ...(layer.layout || {}) };
    if (layout["text-field"] != null) {
      layout["text-font"] = keepItalic
        ? ["Noto Sans Italic"]
        : ["Noto Sans Regular"];
    }
    layout["text-allow-overlap"] = false;
    layout["text-ignore-placement"] = false;
    layout["icon-allow-overlap"] = false;
    layout["icon-ignore-placement"] = false;
    if (typeof layout["text-halo-blur"] === "number" && layout["text-halo-blur"] > 0) {
      layout["text-halo-blur"] = 0;
    }
    layer.layout = layout;
  }

  style.layers = layers;
  style.name = `pindmap-${theme.id}`;
  return style;
}


/** @deprecated alias — prefer buildPindmapStyle */
export const buildPreviewStyle = buildPindmapStyle;
