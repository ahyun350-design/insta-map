/**
 * PindMap MapLibre basemap styles (OpenFreeMap / OpenMapTiles).
 * Production themes: paper, white.
 * Admin MapLibre + preview: neon.
 * Preview-only extras: black, mono, dark (used by /map-preview).
 */

import {
  KOREA_GU_LABELS,
  koreaGuLabelsGeoJson,
} from "@/lib/koreaGuLabels";
import {
  KOREA_MAJOR_LABELS,
  koreaMajorLabelsGeoJson,
} from "@/lib/koreaMajorLabels";
import {
  KOREA_PLACE_LABELS,
  koreaPlaceLabelsGeoJson,
} from "@/lib/koreaPlaceLabels";
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
  POI_NAME_TEXT,
  POI_TEXT_MAX_WIDTH,
  POI_VARIABLE_ANCHOR,
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

/**
 * Hide admin_sigungu when the same display name already exists on korea gu/place
 * overlays (gu/place always win; admin fills gaps only).
 */
const ADMIN_SIGUNGU_NAME_BLOCKLIST: string[] = (() => {
  const names = new Set<string>();
  for (const g of KOREA_GU_LABELS) {
    const n = String(g.name || "").trim();
    if (n) names.add(n);
  }
  for (const p of KOREA_PLACE_LABELS) {
    const n = String(p.name || "").trim();
    const full = String(p.full || "").trim();
    if (n) names.add(n);
    if (full) names.add(full);
  }
  return [...names];
})();
import {
  poiCategoryIconImageExpr,
  poiCategoryTextColorExpr,
  subwayStationIconImageExpr,
} from "@/lib/mapSurface/poiCategoryIcons";
import {
  applySelfHostedStyleAssets,
  applySelfTilesSource,
  ensureSelfTilesProtocolRegistered,
  readSelfTilesEnabled,
  warmSelfTilesOrBreak,
} from "@/lib/mapSurface/selfTiles";
import {
  ensureKoreaPlacesExtraSource,
  KOREA_PLACES_EXTRA_SOURCE,
  warmKoreaPlacesExtra,
} from "@/lib/mapSurface/koreaPlacesExtra";
import {
  ensureKoreaSanggaSource,
  KOREA_SANGGA_SOURCE,
  warmKoreaSangga,
} from "@/lib/mapSurface/koreaSangga";
import {
  ensureKoreaTourSource,
  KOREA_TOUR_SOURCE,
  warmKoreaTour,
} from "@/lib/mapSurface/koreaTour";
import {
  ensureKoreaBuildingsSource,
  KOREA_BUILDINGS_LAYER,
  KOREA_BUILDINGS_SOURCE,
  warmKoreaBuildings,
} from "@/lib/mapSurface/koreaBuildings";
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
    // Kakao-like paper: cool gray land; white buildings float above
    background: "#F2F2F0",
    land: "#F2F2F0",
    water: "#BFDDF2",
    // Deeper park green so urban parks read clearly on cool-gray land
    park: "#B8D4A8",
    building: "#FFFFFF",
    showBuildings: true,
    road: "#FFFFFF",
    roadMinor: "#FFFFFF",
    rail: "#B0B0B0",

    text: "#2E3440",
    textHalo: "#FFFFFF",
    boundary: "#D0D0D0",
    stationDot: "#2E3440",
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
  // Liberty road labels stay off; major Korean road names added via appendRoadNameLayers.
  // Highway number / route shields stay hidden (all themes / zooms). Road lines stay.
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
 * Shops/cafes use shop_poi_* layers (z14+).
 * Split so large apt complexes can sit above parks/museums but below
 * school / civic / hospital (and korea tier1 / stations).
 */
/** Culture / post / attraction — parks use park_name_* (green) instead. */
const LANDMARK_FILTER_SECONDARY: unknown = [
  "any",
  [
    "all",
    ["==", ["get", "class"], "grocery"],
    ["==", ["get", "subclass"], "marketplace"],
  ],
  [
    "all",
    ["==", ["get", "class"], "post"],
    ["==", ["get", "subclass"], "post_office"],
  ],
  ["==", ["get", "class"], "museum"],
  ["==", ["get", "class"], "stadium"],
  ["==", ["get", "class"], "attraction"],
];

/** School / civic / hospital — always above large apt. */
const LANDMARK_FILTER_PRIORITY: unknown = [
  "any",
  ["==", ["get", "class"], "school"],
  ["==", ["get", "class"], "college"],
  ["==", ["get", "subclass"], "university"],
  [
    "all",
    ["==", ["get", "class"], "hospital"],
    ["==", ["get", "subclass"], "hospital"],
  ],
  ["==", ["get", "class"], "town_hall"],
  ["==", ["get", "class"], "police"],
];

/** @deprecated alias — full set for any remaining CORE references */
const LANDMARK_FILTER_CORE: unknown = [
  "any",
  LANDMARK_FILTER_PRIORITY,
  LANDMARK_FILTER_SECONDARY,
];

/** z14–15 neighbourhood reference points (Naver-like): dark gray, bold, larger. */
const ANCHOR_TEXT_COLOR = "#2B2F33";
const FONT_BOLD_EXPR: unknown = ["literal", ["Noto Sans Bold"]];
const FONT_REGULAR_EXPR: unknown = ["literal", ["Noto Sans Regular"]];

const OMT_MARKET: unknown = [
  "all",
  ["==", ["get", "class"], "grocery"],
  ["==", ["get", "subclass"], "marketplace"],
];

/** OMT anchors at z14–15: school · 주민센터/구청 · 전통시장 · 명소. */
const LANDMARK_ANCHOR: unknown = [
  "any",
  ["==", ["get", "class"], "school"],
  ["==", ["get", "class"], "college"],
  ["==", ["get", "subclass"], "university"],
  ["==", ["get", "class"], "town_hall"],
  ["==", ["get", "class"], "attraction"],
  OMT_MARKET,
];

/** Bold outside the anchor band: 시장 · 대표 명소 only. */
const LANDMARK_BOLD: unknown = [
  "any",
  ["==", ["get", "class"], "attraction"],
  OMT_MARKET,
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

function appendLandmarkLayers(
  layers: AnyLayer[],
  theme: MapPreviewTheme,
  opts?: {
    /** Default: secondary (park/culture). Use "priority" for school/civic. */
    kind?: "secondary" | "priority";
  },
): void {
  const kind = opts?.kind ?? "secondary";
  const color = landmarkGroupColor(theme);
  // MapLibre: lower sort-key places first. Priority (school/civic) must beat shops.
  const sortKey: unknown =
    kind === "priority"
      ? ["-", 280, ["to-number", ["coalesce", ["get", "rank"], 999]]]
      : ["-", 1500, ["to-number", ["coalesce", ["get", "rank"], 999]]];
  const classFilter =
    kind === "priority" ? LANDMARK_FILTER_PRIORITY : LANDMARK_FILTER_SECONDARY;
  const id =
    kind === "priority"
      ? (base: string) =>
          base === "landmark_label_playground"
            ? base
            : base.replace("landmark_label", "landmark_priority")
      : (base: string) => base;

  // Zoom-split rank caps — ["zoom"] inside filter is NOT re-evaluated by MapLibre.
  const bands: Array<{
    id: string;
    minzoom: number;
    maxzoom?: number;
    rankMax: number;
    classFilter: unknown;
    excludeKindergarten: boolean;
    /** z14–15: anchors get their own rank cap + dark bold text. */
    anchorRankMax?: number;
  }> = [
    {
      id: id("landmark_label"),
      minzoom: 11,
      maxzoom: 12,
      rankMax: 6,
      classFilter,
      excludeKindergarten: true,
    },
    {
      id: id("landmark_label_z12"),
      minzoom: 12,
      maxzoom: 13,
      rankMax: 8,
      classFilter,
      excludeKindergarten: true,
    },
    {
      id: id("landmark_label_z13"),
      minzoom: 13,
      maxzoom: 14,
      rankMax: 12,
      classFilter,
      excludeKindergarten: true,
    },
    {
      id: id("landmark_label_z14"),
      minzoom: 14,
      maxzoom: 15,
      rankMax: 4,
      anchorRankMax: 8,
      classFilter,
      excludeKindergarten: true,
    },
    {
      // Keep legacy id for e2e / deferred-decoration hooks (secondary / parks)
      id: id("landmark_label_street"),
      minzoom: 15,
      maxzoom: 16,
      rankMax: 40,
      anchorRankMax: 40,
      classFilter,
      excludeKindergarten: false,
    },
    {
      id: id("landmark_label_z16"),
      minzoom: 16,
      maxzoom: 17,
      rankMax: 70,
      classFilter,
      excludeKindergarten: false,
    },
    {
      id: id("landmark_label_z17"),
      minzoom: 17,
      rankMax: 100,
      classFilter,
      excludeKindergarten: false,
    },
  ];
  if (kind === "secondary") {
    bands.push({
      id: "landmark_label_playground",
      minzoom: 15,
      rankMax: 40,
      classFilter: LANDMARK_FILTER_PLAYGROUND,
      excludeKindergarten: true,
    });
  }

  for (const band of bands) {
    const rank: unknown = ["to-number", ["coalesce", ["get", "rank"], 999]];
    const anchorBand = band.anchorRankMax != null;
    const rankFilter: unknown = anchorBand
      ? [
          "any",
          ["all", LANDMARK_ANCHOR, ["<=", rank, band.anchorRankMax]],
          ["<=", rank, band.rankMax],
        ]
      : ["<=", rank, band.rankMax];
    const filter: unknown = [
      "all",
      band.classFilter,
      NOT_AIRFIELD,
      ["has", "name"],
      notDuplicateKoreaLandmarkName(),
      rankFilter,
      ...(band.excludeKindergarten ? [NOT_KINDERGARTEN] : []),
    ];
    const boldWhen = anchorBand ? LANDMARK_ANCHOR : LANDMARK_BOLD;
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
        "icon-optional": false,
        "text-field": KO_TEXT,
        "text-font": ["case", boldWhen, FONT_BOLD_EXPR, FONT_REGULAR_EXPR],
        "text-size": anchorBand ? ["case", LANDMARK_ANCHOR, 13.5, 12.5] : 12.5,
        "text-variable-anchor": [...POI_VARIABLE_ANCHOR],
        "text-radial-offset": ICON_TEXT_RADIAL_OFFSET,
        "text-justify": "auto",
        "text-max-width": POI_TEXT_MAX_WIDTH,
        "text-padding": kind === "priority" ? 1 : PLACE_TEXT_PADDING,
        "icon-padding": kind === "priority" ? 0.5 : 1,
        "text-optional": kind === "priority",
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        "symbol-sort-key": anchorBand
          ? ["-", sortKey, ["case", LANDMARK_ANCHOR, 100, 0]]
          : sortKey,
        "symbol-z-order": "source",
      },
      paint: {
        "text-color": anchorBand
          ? ["case", LANDMARK_ANCHOR, ANCHOR_TEXT_COLOR, color]
          : color,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.75,
        "text-halo-blur": 0,
        "icon-opacity": 1,
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
    // Lower sort-key (places first) so city anchors beat dong/admin/POI badges.
    {
      id: "korea_landmark_tier1_far",
      tier: 1,
      minzoom: 11,
      maxzoom: 12.5,
      textSize: 14,
      sortBase: 90,
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
      sortBase: 100,
      filter: ["==", ["get", "tier"], 1],
    },
    // z13+: tier1 + tier2 (z11–12 stay tier1-only via this minzoom)
    {
      id: "korea_landmark_tier2",
      tier: 2,
      minzoom: 13,
      textSize: 13,
      sortBase: 110,
      filter: ["==", ["get", "tier"], 2],
    },
    {
      id: "korea_landmark_tier3",
      tier: 3,
      minzoom: 15,
      textSize: 13,
      sortBase: 120,
      filter: ["==", ["get", "tier"], 3],
    },
  ];
  for (const t of tiers) {
    // City-scale (z11–13): full anchors for coverage; street: left/right only.
    // Overlap=0: win via layer order (painted late) + low sort-key + tight padding.
    const anchor = t.minzoom < 14 ? PLACE_VARIABLE_ANCHOR : POI_VARIABLE_ANCHOR;
    const cityZoom = t.minzoom < 14;
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
        "icon-size": cityZoom ? 1 : 1.05,
        "icon-optional": false,
        "text-field": cityZoom ? GEOJSON_NAME_TEXT : POI_NAME_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": t.textSize,
        "text-variable-anchor": [...anchor],
        "text-radial-offset": cityZoom ? 0.9 : ICON_TEXT_RADIAL_OFFSET,
        "text-justify": "auto",
        "text-max-width": cityZoom ? 7 : POI_TEXT_MAX_WIDTH,
        "text-padding": cityZoom ? 1 : PLACE_TEXT_PADDING,
        "icon-padding": cityZoom ? 0.5 : 1,
        "text-optional": true,
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
  ["==", ["get", "class"], "fuel"],
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

/** Shop / 상가 names — kept a step below landmark / anchor text (12.5+). */
const SHOP_TEXT_SIZE: unknown = [
  "interpolate",
  ["linear"],
  ["zoom"],
  15,
  10.5,
  16,
  11,
  17,
  11.5,
  18,
  12,
];

/** HSL lightness × (1 − amount) for every #RRGGBB literal inside an expression. */
function darkenHexColors(expr: unknown, amount: number): unknown {
  if (typeof expr === "string" && /^#[0-9a-f]{6}$/i.test(expr)) {
    const n = (i: number) => parseInt(expr.slice(i, i + 2), 16) / 255;
    const [r, g, b] = [n(1), n(3), n(5)];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    h *= 60;
    const l2 = l * (1 - amount);
    const c = (1 - Math.abs(2 * l2 - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l2 - c / 2;
    const [r1, g1, b1] =
      h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const hex = (v: number) =>
      Math.round(Math.min(1, Math.max(0, v + m)) * 255)
        .toString(16)
        .padStart(2, "0");
    return `#${hex(r1)}${hex(g1)}${hex(b1)}`.toUpperCase();
  }
  if (Array.isArray(expr)) return expr.map((e) => darkenHexColors(e, amount));
  return expr;
}

/** z16+ shop names: category hue, ~15% darker for street-zoom legibility. */
function shopPoiColorStreet(theme: MapPreviewTheme): unknown {
  return darkenHexColors(shopPoiColor(theme), 0.15);
}

/** Category text colors — same family as icon fills (muted paper). */
function shopPoiColor(theme: MapPreviewTheme): unknown {
  return poiCategoryTextColorExpr(theme.id);
}

/** Same priority ladder as OMT shops; MapLibre lower sort-key places first in practice with layer order. */
function shopSortKeyExpr(): unknown {
  return [
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
}

function appendShopPoiLayers(layers: AnyLayer[], theme: MapPreviewTheme): void {
  const color = shopPoiColor(theme);
  const streetColor = shopPoiColorStreet(theme);
  // Stay below landmarks / stations / large apt. Painted after sangga so OMT-only wins.
  const sortKey: unknown = shopSortKeyExpr();

  // z13–14: markets / malls only (no street shops). z15: sparse top-rank food.
  // z16: most shops. z17+: remainder. Convenience from z16.
  const bands: Array<{
    idSuffix: string;
    minzoom: number;
    maxzoom?: number;
    classFilter: unknown;
    textPadding: unknown;
  }> = [
    {
      idSuffix: "z13",
      minzoom: 13,
      maxzoom: 14,
      // Market / mall only — no street cafes·restaurants.
      classFilter: [
        "any",
        ["==", ["get", "class"], "mall"],
        ["==", ["get", "class"], "department_store"],
        ["==", ["get", "subclass"], "department_store"],
        [
          "all",
          ["==", ["get", "class"], "grocery"],
          [
            "in",
            ["get", "subclass"],
            ["literal", ["marketplace", "supermarket"]],
          ],
        ],
      ],
      textPadding: 14,
    },
    {
      // Sparse anchors at z14 (e2e shopMin≥6); bulk street shops from z15.
      idSuffix: "z14",
      minzoom: 14,
      maxzoom: 15,
      classFilter: [
        "any",
        [
          "all",
          SHOP_BIG,
          ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 45],
        ],
        [
          "all",
          SHOP_FOOD,
          ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 28],
        ],
        SHOP_DAILY_NO_CONV,
      ],
      textPadding: 14,
    },
    {
      idSuffix: "z15",
      minzoom: 15,
      maxzoom: 16,
      // Sparse street shops (≈≤10/screen with padding).
      classFilter: [
        "any",
        SHOP_BIG,
        [
          "all",
          SHOP_FOOD,
          ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 22],
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
        11,
      ],
    },
    {
      idSuffix: "z16",
      minzoom: 16,
      // Cap density for e2e ≤50 unique labels (hongdae/gangnam).
      classFilter: [
        "all",
        SHOP_Z16,
        ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 18],
      ],
      textPadding: [
        "interpolate",
        ["linear"],
        ["zoom"],
        16,
        18,
        17,
        6,
        18,
        4,
      ],
    },
    {
      idSuffix: "z17",
      minzoom: 17,
      classFilter: [
        "all",
        SHOP_Z17_EXTRA,
        ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 90],
      ],
      textPadding: [
        "interpolate",
        ["linear"],
        ["zoom"],
        17,
        2.2,
        18,
        1.6,
      ],
    },
    {
      idSuffix: "z18",
      minzoom: 18,
      classFilter: SHOP_Z18_REMAINDER,
      textPadding: 0.5,
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
        "icon-padding": 0.5,
        "icon-optional": false,
        "text-field": SHOP_TEXT,
        // Regular stack → localIdeograph Hangul at weight 400 (Bold = 900)
        "text-font": ["Noto Sans Regular"],
        "text-size": SHOP_TEXT_SIZE,
        // Icon left, name right (left/right only — no top/bottom drift).
        "text-variable-anchor": [...POI_VARIABLE_ANCHOR],
        "text-radial-offset": ICON_TEXT_RADIAL_OFFSET,
        "text-justify": "auto",
        "text-max-width": POI_TEXT_MAX_WIDTH,
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
        "text-color": band.minzoom >= 16 ? streetColor : color,
        "text-opacity": 1,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.75,
        "text-halo-blur": 0,
        "icon-opacity": 1,
      },
    };
    if (typeof band.maxzoom === "number") {
      layerSpec.maxzoom = band.maxzoom;
    }
    layers.push(layerSpec);
  }
}

/**
 * TourAPI 명소 (admin self-tiles). Priority: below korea landmarks / stations,
 * above large apt + shops. z12+ for high-rank; denser ranks from z13.
 */
function appendKoreaTourLayers(
  layers: AnyLayer[],
  theme: MapPreviewTheme,
  style: { sources?: Record<string, unknown> },
): void {
  if (!style.sources?.[KOREA_TOUR_SOURCE]) return;
  const color =
    theme.id === "neon" ? "#A8B0E0" : theme.id === "white" ? "#4A5A78" : "#2E2E36";
  const bands: Array<{
    idSuffix: string;
    minzoom: number;
    maxzoom?: number;
    rankMax: number;
    textSize: number;
    /** Exclude TourAPI shopping until street zoom so city density stays intact. */
    excludeShop: boolean;
    /** z14–15: streets / markets / parks become dark bold anchors. */
    anchorBand?: boolean;
  }> = [
    {
      idSuffix: "z12",
      minzoom: 12,
      maxzoom: 13,
      rankMax: 16,
      textSize: 13,
      excludeShop: true,
    },
    {
      idSuffix: "z13",
      minzoom: 13,
      maxzoom: 14,
      rankMax: 24,
      textSize: 13,
      excludeShop: true,
    },
    {
      idSuffix: "z14",
      minzoom: 14,
      maxzoom: 15,
      rankMax: 24,
      textSize: 13,
      excludeShop: true,
      anchorBand: true,
    },
    {
      idSuffix: "z15",
      minzoom: 15,
      maxzoom: 16,
      // Tour shopping stays out except 시장 (anchor).
      rankMax: 28,
      textSize: 12.5,
      excludeShop: true,
      anchorBand: true,
    },
    {
      // Hangang / major parks via TourAPI at street zoom (OMT park often loses collision).
      idSuffix: "z16",
      minzoom: 16,
      rankMax: 12,
      textSize: 12.5,
      excludeShop: true,
    },
  ];
  const name: unknown = ["to-string", ["coalesce", ["get", "name"], ""]];
  const rank: unknown = ["to-number", ["coalesce", ["get", "rank"], 999]];
  const endsWith = (suffix: string): unknown => [
    "==",
    ["slice", name, -suffix.length],
    suffix,
  ];
  // 망리단길 · 경의선숲길 · 홍대걷고싶은거리 · …골목 · 망원시장. Tour "shop"
  // rows are often chain branches (렌즈미 홍대거리점) → only 시장/골목 names.
  const isStreetOrMarket: unknown = [
    "case",
    ["==", ["get", "class"], "shop"],
    ["any", endsWith("시장"), endsWith("골목")],
    [
      "any",
      ["in", "시장", name],
      ["in", "거리", name],
      ["in", "골목", name],
      endsWith("길"),
    ],
  ];
  const isAnchor: unknown = [
    "any",
    isStreetOrMarket,
    ["==", ["get", "class"], "park"],
  ];
  // 공원 names stay park-green at every zoom (anchor band keeps them bold).
  const isParkName: unknown = ["in", "공원", name];
  // Bold = anchors + 대표 명소 (z12-band ranks); other Tour POIs stay Regular.
  const isBold: unknown = ["any", isAnchor, ["<=", rank, 16]];
  for (const band of bands) {
    const filter: unknown[] = [
      "all",
      [">", ["length", name], 0],
      notDuplicateKoreaLandmarkName(),
    ];
    if (band.anchorBand) {
      filter.push([
        "any",
        [
          "all",
          ["<=", rank, band.rankMax],
          ["!", ["==", ["get", "class"], "shop"]],
        ],
        ["all", isStreetOrMarket, ["<=", rank, 40]],
      ]);
    } else {
      filter.push(["<=", rank, band.rankMax]);
      if (band.excludeShop) {
        filter.push(["!", ["==", ["get", "class"], "shop"]]);
      }
    }
    const baseSize = Math.min(band.textSize, 12.5);
    layers.push({
      id: `tour_poi_label_${band.idSuffix}`,
      type: "symbol",
      source: KOREA_TOUR_SOURCE,
      "source-layer": "tour",
      minzoom: band.minzoom,
      ...(band.maxzoom != null ? { maxzoom: band.maxzoom } : {}),
      filter,
      layout: {
        visibility: "visible",
        "icon-image": poiSpriteIcon(),
        "icon-size": 1,
        "icon-padding": 1,
        "icon-optional": false,
        "text-field": POI_NAME_TEXT,
        "text-font": ["case", isBold, FONT_BOLD_EXPR, FONT_REGULAR_EXPR],
        "text-size": band.anchorBand
          ? ["case", isAnchor, 14, baseSize]
          : baseSize,
        "text-variable-anchor": [
          ...(band.minzoom < 14 ? PLACE_VARIABLE_ANCHOR : POI_VARIABLE_ANCHOR),
        ],
        "text-radial-offset": ICON_TEXT_RADIAL_OFFSET,
        "text-justify": "auto",
        "text-max-width": band.minzoom < 14 ? 7 : POI_TEXT_MAX_WIDTH,
        "text-padding": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          14,
          15,
          10,
          16,
          8,
        ],
        "text-optional": false,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        // Lower rank → lower sort-key → placed first; anchors ahead in z14–15
        "symbol-sort-key": [
          "+",
          band.anchorBand ? ["case", isAnchor, 120, 220] : 220,
          ["to-number", ["coalesce", ["get", "rank"], 40]],
        ],
        "symbol-z-order": "source",
      },
      paint: {
        "text-color": [
          "case",
          isParkName,
          parkLabelColor(theme),
          ...(band.anchorBand ? [isStreetOrMarket, ANCHOR_TEXT_COLOR] : []),
          color,
        ],
        "text-opacity": 1,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.75,
        "text-halo-blur": 0,
        "icon-opacity": 1,
      },
    });
  }
}

/**
 * 상가(상권)정보 shop labels — same class/subclass/icon language as OMT shops.
 * Painted before OMT shop_poi; OMT-only wins collision; dups hidden via setFilter.
 */
function appendSanggaShopLayers(
  layers: AnyLayer[],
  theme: MapPreviewTheme,
  style: { sources?: Record<string, unknown> },
): void {
  if (!style.sources?.[KOREA_SANGGA_SOURCE]) return;
  const color = shopPoiColor(theme);
  const streetColor = shopPoiColorStreet(theme);
  const sortKey: unknown = shopSortKeyExpr();
  const hasName: unknown = [
    ">",
    ["length", ["to-string", ["coalesce", ["get", "name"], ""]]],
    0,
  ];
  const bands: Array<{
    idSuffix: string;
    minzoom: number;
    maxzoom?: number;
    classFilter: unknown;
    textPadding: unknown;
  }> = [
    {
      // Sparse anchors at z14 (align with OMT; e2e shopMin≥6).
      idSuffix: "z14",
      minzoom: 14,
      maxzoom: 15,
      classFilter: [
        "any",
        [
          "all",
          SHOP_BIG,
          ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 45],
        ],
        [
          "all",
          SHOP_FOOD,
          ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 28],
        ],
        SHOP_DAILY_NO_CONV,
      ],
      textPadding: 14,
    },
    {
      idSuffix: "z15",
      minzoom: 15,
      maxzoom: 16,
      classFilter: [
        "any",
        SHOP_BIG,
        [
          "all",
          SHOP_FOOD,
          ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 22],
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
        11,
      ],
    },
    {
      idSuffix: "z16",
      minzoom: 16,
      maxzoom: 17,
      classFilter: [
        "all",
        SHOP_Z16,
        ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 18],
      ],
      textPadding: 18,
    },
    {
      idSuffix: "z17",
      minzoom: 17,
      classFilter: [
        "all",
        SHOP_Z16,
        ["<=", ["to-number", ["coalesce", ["get", "rank"], 999]], 70],
      ],
      textPadding: [
        "interpolate",
        ["linear"],
        ["zoom"],
        17,
        2.2,
        18,
        1.6,
      ],
    },
  ];

  for (const band of bands) {
    const layerSpec: AnyLayer = {
      id: `sangga_shop_label_${band.idSuffix}`,
      type: "symbol",
      source: KOREA_SANGGA_SOURCE,
      "source-layer": "sangga",
      minzoom: band.minzoom,
      filter: ["all", hasName, band.classFilter],
      layout: {
        visibility: "visible",
        "icon-image": poiSpriteIcon(),
        "icon-size": 1,
        "icon-padding": 0.5,
        "icon-optional": false,
        "text-field": POI_NAME_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": SHOP_TEXT_SIZE,
        "text-variable-anchor": [...POI_VARIABLE_ANCHOR],
        "text-radial-offset": ICON_TEXT_RADIAL_OFFSET,
        "text-justify": "auto",
        "text-max-width": POI_TEXT_MAX_WIDTH,
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
        "text-color": band.minzoom >= 16 ? streetColor : color,
        "text-opacity": 1,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.75,
        "text-halo-blur": 0,
        "icon-opacity": 1,
      },
    };
    if (typeof band.maxzoom === "number") {
      layerSpec.maxzoom = band.maxzoom;
    }
    layers.push(layerSpec);
  }
}

/**
 * Bus stops (below shops/schools in collision):
 * - z17–18: small bus badge only (16–18px)
 * - z18+: icon + name
 * Never remap school-named stops to school icons (wrong location).
 */
function appendBusStopLayers(layers: AnyLayer[]): void {
  const busFilter: unknown = [
    "all",
    ["==", ["get", "class"], "bus"],
    ["==", ["get", "subclass"], "bus_stop"],
    ["has", "name"],
  ];
  // ~17px vs POI_ICON_CSS_PX 22 → icon-size ≈ 0.77
  const busIconSize = 17 / 22;
  // Higher than shop sort-keys (~400–850) → shops / schools place first
  const busSortKey = 1200;

  layers.push({
    id: "bus_stop_icon",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 17,
    maxzoom: 18,
    filter: busFilter,
    layout: {
      visibility: "visible",
      "icon-image": "pind-poi-bus",
      "icon-size": busIconSize,
      "icon-optional": false,
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "icon-padding": 1.5,
      "symbol-sort-key": busSortKey,
      "symbol-z-order": "source",
    },
    paint: {
      "icon-opacity": 0.9,
    },
  });
  layers.push({
    id: "bus_stop_label",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 18,
    filter: busFilter,
    layout: {
      visibility: "visible",
      "icon-image": "pind-poi-bus",
      "icon-size": busIconSize,
      "icon-optional": false,
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "icon-padding": 1.5,
      "text-field": KO_TEXT,
      "text-font": ["Noto Sans Regular"],
      "text-size": 10.5,
      "text-variable-anchor": [...PLACE_VARIABLE_ANCHOR],
      "text-radial-offset": 0.95,
      "text-max-width": 6,
      "text-padding": 4,
      "text-optional": true,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": busSortKey,
      "symbol-z-order": "source",
    },
    paint: {
      "icon-opacity": 0.9,
      "text-color": "#2C7BE5",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.2,
      "text-opacity": 0.9,
    },
  });
}

/**
 * Kakao-like major road names from OMT transportation_name.
 * - z13+: name ends with 대로, or class motorway/trunk/primary
 * - z15+: secondary/tertiary whose name ends with 로 (not 대로 — those already at z13)
 * - Hide: 길 alleys, minor/service/track/path, ref-only / Latin-only, route shields
 * Overlap=0: allow-overlap + ignore-placement both false. Painted before
 * shops/dong/stations (those layers come later → win collision); high sort-key
 * so road names drop when space is taken.
 */
function appendRoadNameLayers(
  layers: AnyLayer[],
  theme: MapPreviewTheme,
): void {
  const textColor =
    theme.id === "neon" ? "#9AA0A8" : theme.id === "white" ? "#7A7A82" : "#8A8A92";
  /** Prefer name:ko / nonlatin; empty → no label (hides ref-only / Latin-only). */
  const nameRaw: unknown = [
    "to-string",
    [
      "coalesce",
      ["get", "name:ko"],
      ["get", "name:nonlatin"],
      "",
    ],
  ];
  const hasKoName: unknown = [">", ["length", nameRaw], 0];
  const notGil: unknown = ["!=", ["slice", nameRaw, -1], "길"];
  const endsDaero: unknown = ["==", ["slice", nameRaw, -2], "대로"];
  const endsRo: unknown = ["==", ["slice", nameRaw, -1], "로"];
  const majorClass: unknown = [
    "match",
    ["get", "class"],
    ["motorway", "trunk", "primary"],
    true,
    false,
  ];
  const secondaryClass: unknown = [
    "match",
    ["get", "class"],
    ["secondary", "tertiary"],
    true,
    false,
  ];
  const excludedClass: unknown = [
    "match",
    ["get", "class"],
    [
      "minor",
      "service",
      "track",
      "path",
      "rail",
      "transit",
      "motorway_junction",
      "raceway",
      "minor_construction",
      "service_construction",
      "track_construction",
      "path_construction",
    ],
    true,
    false,
  ];

  const sharedLayout = {
    visibility: "visible" as const,
    "symbol-placement": "line" as const,
    // Wide repeat gap (Kakao-like); short segments still skip via line placement.
    "symbol-spacing": 420,
    "text-field": KO_TEXT,
    "text-font": ["Noto Sans Regular"],
    "text-size": [
      "interpolate",
      ["linear"],
      ["zoom"],
      13,
      10,
      15,
      11,
      17,
      12,
    ],
    "text-max-angle": 45,
    "text-rotation-alignment": "map",
    "text-pitch-alignment": "viewport",
    "text-keep-upright": true,
    // Tiny pad so labels fit along road centerlines between shop/dong pads.
    "text-padding": 0.5,
    "text-optional": true,
    // Overlap=0: reserve collision boxes; yield via early layer + high sort-key.
    "text-allow-overlap": false,
    "text-ignore-placement": false,
    // MapLibre 4.7: lower sort-key wins → HIGH so roads yield to shops/dong/stations.
    "symbol-sort-key": 1800,
  };
  const sharedPaint = {
    "text-color": textColor,
    "text-halo-color": "#FFFFFF",
    "text-halo-width": 1.35,
    "text-opacity": 0.9,
  };

  layers.push({
    id: "road_name_major",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "transportation_name",
    minzoom: 13,
    filter: [
      "all",
      hasKoName,
      notGil,
      ["!", excludedClass],
      ["any", endsDaero, majorClass],
    ],
    layout: { ...sharedLayout },
    paint: { ...sharedPaint },
  });

  layers.push({
    id: "road_name_secondary",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "transportation_name",
    minzoom: 15,
    filter: [
      "all",
      hasKoName,
      notGil,
      secondaryClass,
      endsRo,
      ["!", endsDaero],
    ],
    layout: {
      ...sharedLayout,
      "symbol-spacing": 420,
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        15,
        10.5,
        17,
        12,
      ],
    },
    paint: {
      ...sharedPaint,
      "text-opacity": 0.88,
    },
  });
}

/** Spec park label colour (#286E39); neon/white keep readable variants. */
function parkLabelColor(theme: MapPreviewTheme): string {
  return theme.id === "neon" ? "#7AB8A0" : theme.id === "white" ? "#5A7A58" : "#286E39";
}

/** Large park / garden names from OMT poi (Liberty has no park_label layer). */
function appendParkNameLayers(
  layers: AnyLayer[],
  theme: MapPreviewTheme,
): void {
  const color = parkLabelColor(theme);
  const bands: Array<{
    id: string;
    minzoom: number;
    maxzoom?: number;
    rankMax: number;
  }> = [
    // OMT park ranks are often 1–80; keep mid-zoom parks visible without flooding.
    { id: "park_name_label_z12", minzoom: 12, maxzoom: 14, rankMax: 40 },
    { id: "park_name_label_z14", minzoom: 14, maxzoom: 16, rankMax: 80 },
    { id: "park_name_label_z16", minzoom: 16, rankMax: 120 },
  ];
  for (const band of bands) {
    // z14–15 band = neighbourhood anchor (bold, a little larger; stays green).
    const anchorBand = band.minzoom === 14;
    layers.push({
      id: band.id,
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: band.minzoom,
      ...(band.maxzoom != null ? { maxzoom: band.maxzoom } : {}),
      filter: [
        "all",
        ["==", ["get", "class"], "park"],
        ["has", "name"],
        [
          "<=",
          ["to-number", ["coalesce", ["get", "rank"], 999]],
          band.rankMax,
        ],
      ],
      layout: {
        visibility: "visible",
        "text-field": KO_TEXT,
        "text-font": ["Noto Sans Bold"],
        "text-size": anchorBand
          ? ["interpolate", ["linear"], ["zoom"], 14, 14.5, 16, 15]
          : [
              "interpolate",
              ["linear"],
              ["zoom"],
              12,
              12,
              14,
              13.5,
              16,
              14.5,
            ],
        "text-max-width": 8,
        "text-padding": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          1.2,
          16,
          0.8,
        ],
        "text-variable-anchor": [...ADMIN_VARIABLE_ANCHOR],
        "text-optional": true,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        // MapLibre 4.7: lower sort-key wins — beat shops (~400–850), yield to stations.
        "symbol-sort-key": [
          "+",
          180,
          ["to-number", ["coalesce", ["get", "rank"], 50]],
        ],
      },
      paint: {
        "text-color": color,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.4,
        "text-opacity": anchorBand ? 1 : 0.92,
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

/** Paper arterials: paler below z15 so the city view isn't covered in orange. */
function paperArterialColor(lowZoom: string, street: string): unknown {
  return ["step", ["zoom"], lowZoom, 15, street];
}

function isPaperArterial(theme: MapPreviewTheme, kind: RoadKind): boolean {
  return (
    theme.id === "paper" &&
    (kind === "motorway" || kind === "trunk" || kind === "primary")
  );
}

/** Value of an ["interpolate", ["exponential", b] | ["linear"], ["zoom"], …] at z. */
function evalZoomInterpolate(expr: unknown[], z: number): number {
  const base =
    Array.isArray(expr[1]) && expr[1][0] === "exponential" ? Number(expr[1][1]) : 1;
  const stops: Array<[number, number]> = [];
  for (let i = 3; i + 1 < expr.length; i += 2) {
    stops.push([Number(expr[i]), Number(expr[i + 1])]);
  }
  if (z <= stops[0][0]) return stops[0][1];
  for (let i = 0; i + 1 < stops.length; i += 1) {
    const [z0, v0] = stops[i];
    const [z1, v1] = stops[i + 1];
    if (z > z1) continue;
    const t =
      base === 1
        ? (z - z0) / (z1 - z0)
        : (Math.pow(base, z - z0) - 1) / (Math.pow(base, z1 - z0) - 1);
    return v0 + (v1 - v0) * t;
  }
  return stops[stops.length - 1][1];
}

/** ~70% width below z15; z15+ unchanged (adds an exact z15 stop). */
function softenLowZoomWidth(width: unknown): unknown {
  if (!Array.isArray(width) || width[0] !== "interpolate") return width;
  const at15 = evalZoomInterpolate(width, 15);
  const out: unknown[] = width.slice(0, 3);
  let has15 = false;
  for (let i = 3; i + 1 < width.length; i += 2) {
    const z = Number(width[i]);
    const v = Number(width[i + 1]);
    if (z > 15 && !has15) {
      out.push(15, Number(at15.toFixed(3)));
      has15 = true;
    }
    if (z === 15) has15 = true;
    out.push(z, z < 15 ? Number((v * 0.7).toFixed(3)) : v);
  }
  if (!has15) out.push(15, Number(at15.toFixed(3)));
  return out;
}

function roadFillColor(
  theme: MapPreviewTheme,
  kind: RoadKind,
): unknown {
  // Paper/Naver: pale orange expressways, pale yellow 대로, white below.
  const arterial =
    kind === "motorway" || kind === "trunk" || kind === "primary";
  if (theme.id === "paper") {
    if (kind === "motorway" || kind === "trunk") {
      return paperArterialColor("#FBDDB5", "#F9C78A");
    }
    if (kind === "primary") return paperArterialColor("#FDF0C8", "#FCE3A0");
    return "#FFFFFF";
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
): unknown {
  const arterial =
    kind === "motorway" || kind === "trunk" || kind === "primary";
  if (theme.id === "paper") {
    // Very light gray casing — block edges read against white fill + paper land
    if (kind === "motorway" || kind === "trunk") {
      return paperArterialColor("#F0C597", "#E8A866");
    }
    if (kind === "primary") return paperArterialColor("#EEDDA6", "#E9C878");
    if (arterial) return "#C8C8C8";
    if (kind === "secondary" || kind === "tertiary") return "#D0D0D0";
    return "#D8D8D8";
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
  colorKind: RoadKind = kind,
) {
  // Hide mountain/foot path dashes entirely (always-hidden rule).
  if (kind === "path") {
    setVisibility(layer, false);
    return;
  }
  layer.minzoom = Math.max(layer.minzoom ?? 0, roadMinZoom(kind));
  if (layer.type === "line") {
    paintSet(
      layer,
      "line-color",
      casing ? roadCasingColor(theme, colorKind) : roadFillColor(theme, colorKind),
    );
    paintSet(layer, "line-opacity", 1);
    const width = casing ? roadCasingWidth(kind) : roadFillWidth(kind);
    paintSet(
      layer,
      "line-width",
      isPaperArterial(theme, colorKind) ? softenLowZoomWidth(width) : width,
    );
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

/** Ramps keep link widths but take the expressway colour. */
function detectRoadColorKind(id: string): RoadKind {
  if (id.includes("motorway")) return "motorway";
  return detectRoadKind(id);
}

/**
 * Admin paper self-tiles: Juso building_kr fill/outline above OMT building
 * (covers OMT where KR present; OMT remains where KR absent). Soft-fail if
 * source missing. Labels (houseno) at z17+ with lowest priority.
 */
function appendKoreaBuildingLayers(
  layers: AnyLayer[],
  theme: MapPreviewTheme,
  style: StyleJson,
): void {
  if (theme.id !== "paper") return;
  if (!style.sources?.[KOREA_BUILDINGS_SOURCE]) return;

  // Shop fill only when use=shop AND shop_n≥2 (large footprints with 1 shop stay white).
  // Color kept very light so neighborhoods do not read as solid apricot.
  const isShopFill: unknown = [
    "all",
    ["==", ["coalesce", ["get", "use"], ""], "shop"],
    [">=", ["to-number", ["coalesce", ["get", "shop_n"], 0]], 2],
  ];
  const fillColor: unknown = [
    "case",
    isShopFill,
    "#FDF1E6",
    ["==", ["coalesce", ["get", "use"], ""], "apt"],
    "#E8EEF2",
    "#FFFFFF",
  ];
  const outlineColor: unknown = [
    "case",
    isShopFill,
    "#F0DCC8",
    ["==", ["coalesce", ["get", "use"], ""], "apt"],
    "#C9D2DA",
    "#D9D9D9",
  ];
  const fillOpacity: unknown = [
    "interpolate",
    ["linear"],
    ["zoom"],
    14.99,
    0,
    15,
    0.92,
    16,
    0.96,
    17,
    1,
    18,
    1,
  ];
  const fillLayer: AnyLayer = {
    id: "building_kr_fill",
    type: "fill",
    source: KOREA_BUILDINGS_SOURCE,
    "source-layer": KOREA_BUILDINGS_LAYER,
    minzoom: 15,
    maxzoom: 22,
    layout: { visibility: "visible" },
    paint: {
      "fill-color": fillColor,
      "fill-opacity": fillOpacity,
      "fill-outline-color": outlineColor,
    },
  };
  const outlineLayer: AnyLayer = {
    id: "building_kr_outline",
    type: "line",
    source: KOREA_BUILDINGS_SOURCE,
    "source-layer": KOREA_BUILDINGS_LAYER,
    minzoom: 15,
    maxzoom: 22,
    layout: {
      visibility: "visible",
      "line-cap": "butt",
      "line-join": "miter",
    },
    paint: {
      "line-color": outlineColor,
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        15,
        0.55,
        17,
        0.95,
        18,
        1.15,
      ],
      "line-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        14.99,
        0,
        15,
        0.75,
        17,
        0.95,
      ],
    },
  };

  const buildingIdx = layers.findIndex((l) => l.id === "building");
  if (buildingIdx >= 0) {
    layers.splice(buildingIdx + 1, 0, fillLayer, outlineLayer);
  } else {
    layers.push(fillLayer, outlineLayer);
  }
}

/** z17+ houseno — lowest priority (below road names). No name/floors in Juso MST. */
function appendKoreaBuildingNumberLabels(
  layers: AnyLayer[],
  theme: MapPreviewTheme,
  style: StyleJson,
): void {
  if (theme.id !== "paper") return;
  if (!style.sources?.[KOREA_BUILDINGS_SOURCE]) return;
  layers.push({
    id: "building_kr_number",
    type: "symbol",
    source: KOREA_BUILDINGS_SOURCE,
    "source-layer": KOREA_BUILDINGS_LAYER,
    minzoom: 17,
    maxzoom: 22,
    filter: [
      ">",
      ["length", ["to-string", ["coalesce", ["get", "no"], ""]]],
      0,
    ],
    layout: {
      visibility: "visible",
      "text-field": ["to-string", ["get", "no"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        17,
        8.5,
        18,
        9.5,
        19,
        10,
      ],
      "text-padding": 3.5,
      "text-max-width": 5,
      "text-optional": true,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      // Highest sort-key + earliest among low-pri labels → yields to roads/shops/dong.
      "symbol-sort-key": 2500,
    },
    paint: {
      "text-color": "#B0B0B0",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1,
      "text-opacity": 0.75,
    },
  });
}

export type BuildPindmapStyleOptions = {
  /**
   * When true, skip sangga / tour / places-extra on the first style and
   * attach them via attachDeferredHeavyOverlays() after idle.
   * Default false — defer regressed cold 4G first-label in local measure.
   */
  deferHeavySources?: boolean;
};

export async function buildPindmapStyle(
  themeId: MapPreviewThemeId,
  opts?: BuildPindmapStyleOptions,
): Promise<StyleJson> {
  const theme = MAP_PREVIEW_THEMES[themeId];
  const style = await fetchLibertyStyle();
  // Admin self-tiles: PMTiles vector source + same-origin glyphs (full pack /
  // empty-PBF safety net). Keep OFM sprite for fill patterns.
  // On hard PMTiles failure, leave OFM tiles (already tracked as self_tiles_error).
  if (typeof window !== "undefined" && readSelfTilesEnabled()) {
    ensureSelfTilesProtocolRegistered();
    const ok = await warmSelfTilesOrBreak();
    if (ok) {
      applySelfTilesSource(style);
      applySelfHostedStyleAssets(style);
      // Juso buildings (NCP KR) — soft-fail; paper fill/labels only when source warms.
      ensureKoreaBuildingsSource(style);
      void warmKoreaBuildings();
      const deferHeavy = opts?.deferHeavySources === true;
      if (!deferHeavy) {
        // Apt / named-building overlay (separate PMTiles); empty if not uploaded yet.
        ensureKoreaPlacesExtraSource(style);
        void warmKoreaPlacesExtra();
        ensureKoreaSanggaSource(style);
        void warmKoreaSangga();
        ensureKoreaTourSource(style);
        void warmKoreaTour();
      }
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
    // Stronger forest green so Gangwon/mountain belts read vs flat gray land.
    const woodFill =
      theme.id === "white"
        ? "#E8F0E4"
        : theme.id === "neon"
          ? "#0A2424"
          : theme.id === "paper"
            ? "#BFD4AE"
            : "#E8F0E0";
    const buildingOutline =
      theme.id === "white"
        ? "#E6E6E6"
        : theme.id === "neon"
          ? "#242C5C"
          : theme.id === "paper"
            ? "#D9D9D9"
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
      applyGuideRoadStyle(layer, theme, kind, true, detectRoadColorKind(layer.id));
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
            0.35,
            8,
            0.55,
            9,
            0.72,
            11,
            0.85,
            13,
            0.9,
          ]);
        } else if (layer.id === "park" || layer.id.includes("grass")) {
          paintSet(layer, "fill-color", theme.park);
          paintSet(layer, "fill-opacity", [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.35,
            8,
            0.55,
            9,
            0.85,
            11,
            0.94,
            12,
            0.96,
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
      } else if (
        theme.id === "paper" &&
        style.sources?.[KOREA_BUILDINGS_SOURCE]
      ) {
        // building_kr present: hide OMT building at all zooms (KR overzooms z17+).
        setVisibility(layer, false);
      } else if (theme.id === "paper" || theme.id === "white") {
        // Paper without KR / white: light blocks
        paintSet(
          layer,
          "fill-color",
          theme.id === "paper" ? "#FFFFFF" : theme.building,
        );
        paintSet(layer, "fill-opacity", [
          "interpolate",
          ["linear"],
          ["zoom"],
          13.99,
          0,
          14,
          theme.id === "paper" ? 0.88 : 0.55,
          15,
          theme.id === "paper" ? 0.94 : 0.72,
          16,
          theme.id === "paper" ? 0.97 : 0.82,
          17,
          1,
          18,
          1,
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
          applyGuideRoadStyle(layer, theme, kind, false, detectRoadColorKind(layer.id));
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
        // Far: thin solid (z11+). OSM colour when present; else gray.
        // Seoul subway colours also painted by subway_overlay on top.
        layer.minzoom = Math.max(layer.minzoom ?? 0, 11);
        paintSet(layer, "line-color", [
          "coalesce",
          ["get", "colour"],
          ["get", "color"],
          theme.rail,
        ]);
        paintSet(layer, "line-opacity", theme.id === "neon" ? 0.5 : 0.62);
        paintSet(layer, "line-width", [
          "interpolate",
          ["linear"],
          ["zoom"],
          11,
          0.7,
          12,
          0.9,
          14,
          1.2,
          16,
          1.6,
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
        // Ocean/lake points early; river line labels from z11 (한강·소양강…).
        const isWaterwayLine = layer.id === "waterway_line_label";
        const isWaterNameLine = layer.id === "water_name_line_label";
        const isLineWater = isWaterwayLine || isWaterNameLine;
        // Rivers (한강) from z10; small waterways still fine at z10–11.
        layer.minzoom = isWaterwayLine || isWaterNameLine ? 10 : 5;
        if (layer.layout) {
          layer.layout["text-field"] = KO_TEXT;
          layer.layout["text-allow-overlap"] = false;
          layer.layout["text-optional"] = true;
        }
        paintSet(
          layer,
          "text-color",
          theme.id === "white"
            ? "#5A8AA8"
            : theme.id === "neon"
              ? "#8AA0D8"
              : "#3A7AA8",
        );
        paintSet(layer, "text-opacity", [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0.6,
          8,
          0.88,
          11,
          1,
        ]);
        paintSet(layer, "text-halo-color", theme.textHalo);
        paintSet(layer, "text-halo-width", 1.5);
        if (layer.layout) {
          layer.layout["text-font"] = ["Noto Sans Italic"];
          layer.layout["text-letter-spacing"] = 0.1;
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
          } else if (isLineWater) {
            layer.layout["symbol-placement"] = "line";
            // River names (한강) readable from z10 with the water_name_line minzoom.
            layer.layout["text-size"] = [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              11,
              11,
              11.5,
              13,
              12.5,
              15,
              14,
            ];
            // Higher sort-key → stronger placement vs gu overlays at mid zoom.
            layer.layout["symbol-sort-key"] = 200;
          } else {
            layer.layout["text-size"] = [
              "interpolate",
              ["linear"],
              ["zoom"],
              12,
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
              // Below landmarks/tour (~220) but above shops (~850) — 동네 > 가게
              "symbol-sort-key": [
                "+",
                480,
                ["to-number", ["coalesce", ["get", "rank"], 50]],
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
                "+",
                500,
                ["to-number", ["coalesce", ["get", "rank"], 50]],
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
            // z14–16 동네: below tour hubs, above street shops
            "symbol-sort-key": [
              "+",
              520,
              ["to-number", ["coalesce", ["get", "rank"], 50]],
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
      // Liberty highway-name-* / highway-shield-* stay in HIDE_LAYER_IDS; see road_name_*
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
        paintSet(layer, "text-color", theme.id === "white" ? "#5A7A58" : theme.id === "neon" ? "#7AB8A0" : "#286E39");
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

  // Juso building_kr fill/outline above OMT `building` (paper + self-tiles).
  appendKoreaBuildingLayers(layers, theme, style);

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
  // Legacy circle dots kept for e2e layer-id presence; hidden — line badges replace them.
  layers.push({
    id: "subway_station_dot",
    type: "circle",
    source: "korea_station_labels",
    minzoom: 11,
    maxzoom: 14,
    filter: ["==", ["get", "midzoom"], 1],
    layout: { visibility: "none" },
    paint: {
      "circle-radius": 2,
      "circle-color": theme.stationDot,
      "circle-opacity": 0,
    },
  });
  layers.push({
    id: "station_line_badge_0",
    type: "circle",
    source: "korea_station_labels",
    minzoom: 13,
    filter: ["==", ["get", "transfer"], 1],
    layout: { visibility: "none" },
    paint: {
      "circle-radius": 3,
      "circle-color": "#FFFFFF",
      "circle-opacity": 0,
    },
  });
  // Station name colour: dark gray (spec). Badge = line colour + ref glyph.
  const stationNameColor = "#1E2124";
  // z11–13: curated midzoom hubs only. z14+: all. Line-coloured number badges.
  layers.push({
    id: "poi_transit_mid",
    type: "symbol",
    source: "korea_station_labels",
    minzoom: 11,
    maxzoom: 14,
    filter: ["==", ["get", "midzoom"], 1],
    layout: {
      visibility: "visible",
      "icon-image": subwayStationIconImageExpr() as never,
      "icon-size": 1,
      "icon-padding": 0.5,
      "icon-optional": false,
      "text-field": GEOJSON_NAME_TEXT,
      "text-font": ["Noto Sans Bold"],
      "text-size": 13.5,
      "text-variable-anchor": [...POI_VARIABLE_ANCHOR],
      "text-radial-offset": ICON_TEXT_RADIAL_OFFSET,
      "text-max-width": 7,
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
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "symbol-sort-key": [
        "-",
        2200,
        ["to-number", ["coalesce", ["get", "merged"], 1]],
      ],
      "symbol-z-order": "source",
    },
    paint: {
      "text-color": stationNameColor,
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.75,
      "icon-opacity": 1,
    },
  });
  layers.push({
    id: "poi_transit",
    type: "symbol",
    source: "korea_station_labels",
    minzoom: 14,
    layout: {
      visibility: "visible",
      "icon-image": subwayStationIconImageExpr() as never,
      "icon-size": 1,
      "icon-padding": 0.5,
      "icon-optional": false,
      "text-field": GEOJSON_NAME_TEXT,
      "text-font": ["Noto Sans Bold"],
      "text-size": ["step", ["zoom"], 14.5, 16, 13.5],
      "text-variable-anchor": [...POI_VARIABLE_ANCHOR],
      "text-radial-offset": ICON_TEXT_RADIAL_OFFSET,
      "text-max-width": 7,
      "text-padding": PLACE_TEXT_PADDING,
      "text-optional": false,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "symbol-sort-key": [
        "-",
        2200,
        ["to-number", ["coalesce", ["get", "merged"], 1]],
      ],
      "symbol-z-order": "source",
    },
    paint: {
      "text-color": ["step", ["zoom"], ANCHOR_TEXT_COLOR, 16, stationNameColor],
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.75,
      "icon-opacity": 1,
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
      // Slightly roomier padding; yield to korea_landmark tiers (sort ~90–120).
      "text-padding": 2.5,
      "text-variable-anchor": [...ADMIN_VARIABLE_ANCHOR],
      "symbol-sort-key": 400,
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
        "text-color": theme.id === "neon" ? "#A09078" : "#6A5A48",
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
        // Hide when korea_landmarks GeoJSON already labels the same name.
        notDuplicateKoreaLandmarkName(),
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

  // Major road names: appendRoadNameLayers (after houseno, before shops). Shields stay hidden.

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

  // Mountain peaks (OMT) — major high peaks from z10; general from z12.
  const peakBands: Array<{
    id: string;
    minzoom: number;
    maxzoom?: number;
    rankMax: number;
    eleMin: number;
  }> = [
    { id: "mountain_peak_label_z10", minzoom: 10, maxzoom: 12, rankMax: 2, eleMin: 800 },
    { id: "mountain_peak_label", minzoom: 12, maxzoom: 13, rankMax: 3, eleMin: 250 },
    { id: "mountain_peak_label_z13", minzoom: 13, maxzoom: 14, rankMax: 5, eleMin: 200 },
    { id: "mountain_peak_label_z14", minzoom: 14, maxzoom: 15, rankMax: 8, eleMin: 150 },
    { id: "mountain_peak_label_z15", minzoom: 15, rankMax: 16, eleMin: 100 },
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
        [">=", ["to-number", ["coalesce", ["get", "ele"], 0]], band.eleMin],
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
          11.5,
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
          8,
          12,
          5,
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
        // Kakao-like brown-green for peaks
        "text-color": theme.id === "neon" ? "#A09078" : "#6A5A48",
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

  // Places-extra: small apts + named buildings BEFORE shops (yield to shops).
  // Large apts are inserted AFTER shops (see below) so they beat cafes/shops
  // but still lose to landmark tier1 / stations (later layers).
  // MapLibre: later symbol layers win cross-layer collision; within that,
  // higher symbol-sort-key wins (same convention as shop_poi ≤850).
  if (style.sources?.[KOREA_PLACES_EXTRA_SOURCE]) {
    // Apt / wing labels: Naver-like light gray tiny (dong-number feel), low priority
    const aptColor = theme.id === "neon" ? "#9A9A9A" : "#A8A8A8";
    layers.push({
      id: "apt_complex_label_small",
      type: "symbol",
      source: KOREA_PLACES_EXTRA_SOURCE,
      "source-layer": "apt_complex",
      minzoom: 14,
      // Tiny footprints → before shops (yield). OSM apt wings are often <150m².
      filter: ["<", ["to-number", ["coalesce", ["get", "area_m2"], 0]], 150],
      layout: {
        "text-field": GEOJSON_NAME_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": 10.5,
        "text-max-width": 8,
        "text-padding": PLACE_TEXT_PADDING,
        "text-variable-anchor": [...PLACE_VARIABLE_ANCHOR],
        "text-optional": true,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        // MapLibre: lower sort-key places first. Keep above 850 so shops win.
        "symbol-sort-key": [
          "+",
          900,
          ["to-number", ["coalesce", ["get", "rank"], 50]],
        ],
        visibility: "visible",
      },
      paint: {
        "text-color": aptColor,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.1,
        "text-opacity": 0.78,
      },
    });
    layers.push({
      id: "named_building_label",
      type: "symbol",
      source: KOREA_PLACES_EXTRA_SOURCE,
      "source-layer": "named_building",
      minzoom: 16,
      layout: {
        "text-field": GEOJSON_NAME_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": 10.5,
        "text-max-width": 7,
        "text-padding": PLACE_TEXT_PADDING,
        "text-variable-anchor": [...PLACE_VARIABLE_ANCHOR],
        "text-optional": true,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "symbol-sort-key": [
          "-",
          380,
          ["to-number", ["coalesce", ["get", "rank"], 50]],
        ],
        visibility: "visible",
      },
      paint: {
        "text-color": theme.id === "neon" ? "#9A9A9A" : "#A0A0A0",
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.1,
        "text-opacity": 0.8,
      },
    });
  }

  // Lowest priority first (later layers win collision): houseno → roads → shops…
  appendKoreaBuildingNumberLabels(layers, theme, style);
  // Road names before shops/dong/stations so those layers win; overlap=0 flags.
  appendRoadNameLayers(layers, theme);

  // 상가정보 first, then OMT shops: OMT-only wins collision; dups hidden via setFilter
  // (sangga preferred when name+50m match). Density still capped by padding/overlap=0.
  appendSanggaShopLayers(layers, theme, style);
  // Shop/facility names (z14+) below landmarks; adapter pins added later on top
  appendShopPoiLayers(layers, theme);
  appendBusStopLayers(layers);

  // Parks / culture / post — after shops, before large apt (large apt may displace these)
  appendLandmarkLayers(layers, theme, { kind: "secondary" });
  // OMT park names after shops/secondary landmarks so they keep corridor space at z15+.
  appendParkNameLayers(layers, theme);

  // Large apartment complexes — after shops + secondary landmarks so they keep
  // Kakao-like presence; school/civic/korea-tier1/stations still come later.
  if (style.sources?.[KOREA_PLACES_EXTRA_SOURCE]) {
    const aptColor = theme.id === "neon" ? "#9A9A9A" : "#A8A8A8";
    layers.push({
      id: "apt_complex_label",
      type: "symbol",
      source: KOREA_PLACES_EXTRA_SOURCE,
      "source-layer": "apt_complex",
      minzoom: 14,
      // Footprint ≥150m² (typical OSM apt/villa wing)
      filter: [">=", ["to-number", ["coalesce", ["get", "area_m2"], 0]], 150],
      layout: {
        "text-field": GEOJSON_NAME_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-max-width": 8,
        "text-padding": PLACE_TEXT_PADDING,
        "text-variable-anchor": [...PLACE_VARIABLE_ANCHOR],
        "text-optional": false,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        // Lower sort-key than shops (400–850) → places first; larger area wins
        "symbol-sort-key": [
          "-",
          350,
          [
            "min",
            200,
            ["/", ["to-number", ["coalesce", ["get", "area_m2"], 0]], 20],
          ],
        ],
        visibility: "visible",
      },
      paint: {
        "text-color": aptColor,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.1,
        "text-opacity": 0.9,
      },
    });
  }

  // TourAPI: after apt, before landmarks (later layers win → landmarks > tour > apt)
  appendKoreaTourLayers(layers, theme, style);

  // Admin place names after shops/apt/tour so they beat cafes & secondary POIs,
  // but before priority landmarks / stations (those paint later → win).
  // Same name as sparse OMT suburb: one label (overlap=0).
  if (style.sources?.[KOREA_PLACES_EXTRA_SOURCE]) {
    const sigunguColor = theme.id === "neon" ? "#9AA2B8" : "#5C5C64";
    const dongColor = theme.id === "neon" ? "#9AA2D0" : "#8A8A92";
    layers.push({
      id: "admin_sigungu_label",
      type: "symbol",
      source: KOREA_PLACES_EXTRA_SOURCE,
      "source-layer": "admin_sigungu",
      minzoom: 10,
      maxzoom: 13,
      // Drop names already covered by korea gu / si·gun place overlays.
      filter: [
        "!",
        [
          "match",
          ["to-string", ["coalesce", ["get", "name"], ""]],
          ADMIN_SIGUNGU_NAME_BLOCKLIST,
          true,
          false,
        ],
      ],
      layout: {
        "text-field": GEOJSON_NAME_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          13,
          12,
          15,
          13,
          16,
        ],
        "text-letter-spacing": 0.04,
        "text-max-width": 8,
        "text-padding": PLACE_TEXT_PADDING,
        "text-variable-anchor": [...ADMIN_VARIABLE_ANCHOR],
        "text-optional": false,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        // Below stations/landmarks (~200-220), above shops (~850)
        "symbol-sort-key": [
          "+",
          420,
          ["to-number", ["coalesce", ["get", "rank"], 50]],
        ],
        visibility: "visible",
      },
      paint: {
        "text-color": sigunguColor,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.6,
        "text-opacity": 0.95,
      },
    });
    layers.push({
      id: "admin_dong_label",
      type: "symbol",
      source: KOREA_PLACES_EXTRA_SOURCE,
      "source-layer": "admin_dong",
      // z13 covered by label_korea_dong_overlay_* (avoids same-name doubles).
      minzoom: 14,
      maxzoom: 16,
      layout: {
        "text-field": GEOJSON_NAME_TEXT,
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          13.5,
          14,
          14.5,
          16,
          15,
        ],
        "text-max-width": 7,
        "text-padding": PLACE_TEXT_PADDING,
        "text-variable-anchor": [...ADMIN_VARIABLE_ANCHOR],
        "text-optional": false,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "symbol-sort-key": [
          "+",
          500,
          ["to-number", ["coalesce", ["get", "rank"], 50]],
        ],
        visibility: "visible",
      },
      paint: {
        "text-color": dongColor,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.5,
        "text-opacity": 0.92,
      },
    });
  }

  // Gu/borough overlays must beat admin_sigungu (same z10–13 band) but still
  // yield to priority landmarks / korea tier1 / stations (those paint later).
  const guPriorityIds = new Set([
    "label_korea_gu_overlay",
    "label_borough_ko",
  ]);
  const guPriorityLayers = layers.filter((l) => guPriorityIds.has(l.id));
  if (guPriorityLayers.length) {
    const rest = layers.filter((l) => !guPriorityIds.has(l.id));
    layers.length = 0;
    layers.push(...rest, ...guPriorityLayers);
  }

  // Stations before korea tiers / school anchors (later layers place first).
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

  // Famous buildings (tier1 z11 / tier2 z13 / tier3 z15).
  appendKoreaLandmarkGeoLayers(layers, theme);
  // School / civic / hospital last so street anchors beat dense shops under overlap=0.
  appendLandmarkLayers(layers, theme, { kind: "priority" });

  // Final pass: overlap=0; weight hierarchy (Hangul weight via localIdeograph:
  // Bold stack = 900, Regular = 400). Bold only for stations · 동/구 · parks ·
  // 대표 명소; landmark / tour layers pick per-feature weight via expressions.
  // Shops, apt, roads, houseno stay Regular. Pins added by adapters.
  const boldLayer =
    /^(poi_transit|label_(dong|suburb|borough|korea_gu|korea_dong|korea_landmark)|admin_(dong|sigungu)_label|park_name_label|korea_landmark_tier)/;
  for (const layer of layers) {
    if (layer.type !== "symbol") continue;
    const id = layer.id;
    if (/pin|myloc|search|route|cluster/i.test(id)) continue;
    const prevFont = layer.layout?.["text-font"];
    const keepItalic =
      id.startsWith("water") &&
      Array.isArray(prevFont) &&
      String(prevFont[0] || "").includes("Italic");
    const fontExpr =
      Array.isArray(prevFont) &&
      ["case", "match", "step"].includes(String(prevFont[0]));
    const layout = { ...(layer.layout || {}) };
    if (layout["text-field"] != null) {
      if (keepItalic) layout["text-font"] = ["Noto Sans Italic"];
      else if (boldLayer.test(id)) layout["text-font"] = ["Noto Sans Bold"];
      else if (!fontExpr) layout["text-font"] = ["Noto Sans Regular"];
    }
    // Overlap=0 for every place label (road_name_* / building_kr_number / POI).
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

const HEAVY_SOURCE_IDS = new Set([
  KOREA_PLACES_EXTRA_SOURCE,
  KOREA_SANGGA_SOURCE,
  KOREA_TOUR_SOURCE,
]);

/**
 * After first idle: attach sangga / tour / places-extra sources + layers.
 * Basemap (OMT self-tiles) paints first without competing Range requests.
 */
/** Live MapLibre map — typed loosely to avoid circular maplibre imports here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function attachDeferredHeavyOverlays(
  map: any,
  themeId: MapPreviewThemeId,
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!readSelfTilesEnabled()) return;
  // Already attached (e.g. style built without defer).
  if (map.getSource(KOREA_SANGGA_SOURCE) || map.getSource(KOREA_TOUR_SOURCE)) {
    return;
  }
  const full = await buildPindmapStyle(themeId, { deferHeavySources: false });
  const sources = full.sources || {};
  for (const id of HEAVY_SOURCE_IDS) {
    const src = sources[id];
    if (!src || map.getSource(id)) continue;
    try {
      map.addSource(id, src);
    } catch {
      /* ignore */
    }
  }
  void warmKoreaPlacesExtra();
  void warmKoreaSangga();
  void warmKoreaTour();
  for (const layer of full.layers || []) {
    if (!layer?.id || map.getLayer(layer.id)) continue;
    const srcRaw = (layer as AnyLayer & { source?: unknown }).source;
    const srcId = typeof srcRaw === "string" ? srcRaw : "";
    if (!HEAVY_SOURCE_IDS.has(srcId)) continue;
    try {
      map.addLayer(layer);
    } catch {
      /* ignore */
    }
  }
}

/** @deprecated alias — prefer buildPindmapStyle */
export const buildPreviewStyle = buildPindmapStyle;
