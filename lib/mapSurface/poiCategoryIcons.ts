/**
 * Code-generated POI category icons for MapLibre addImage.
 * Circle badges (≈22px), white 1.5px stroke, glyphs at 64% of badge.
 * Registered at device pixelRatio 2–3.
 */

import { clampMapPinDpr, loadMapImageFromSvg } from "@/lib/mapPinImages";
import {
  ALL_POI_MAP_CATEGORY_IDS,
  POI_MAP_COLORS,
  type PoiMapCategoryId,
} from "@/lib/mapSurface/poiCategoryMapping";

/** Street POI badge CSS size (20–22px). */
export const POI_ICON_CSS_PX = 22;

/** @deprecated use POI_MAP_COLORS — kept for import compatibility. */
export const POI_CATEGORY_COLORS = {
  food: POI_MAP_COLORS.restaurant,
  cafe: POI_MAP_COLORS.cafe,
  bar: POI_MAP_COLORS.bar,
  bakery: POI_MAP_COLORS.bakery,
  fast_food: POI_MAP_COLORS.fast_food,
  shopping: POI_MAP_COLORS.shop,
  convenience: POI_MAP_COLORS.convenience,
  grocery: POI_MAP_COLORS.grocery,
  life: POI_MAP_COLORS.town_hall,
  medical: POI_MAP_COLORS.hospital,
  pharmacy: POI_MAP_COLORS.pharmacy,
  culture: POI_MAP_COLORS.landmark,
  lodging: POI_MAP_COLORS.lodging,
  park: POI_MAP_COLORS.park,
  education: POI_MAP_COLORS.school,
  transit: POI_MAP_COLORS.subway,
  other: { icon: "#8A8A92", text: "#4A4A52" },
  landmark: POI_MAP_COLORS.landmark,
  beauty: POI_MAP_COLORS.beauty,
  bank: POI_MAP_COLORS.bank,
} as const;

export type PoiCategoryId =
  | PoiMapCategoryId
  | "mall"
  | "college"
  | "cinema"
  | "museum"
  | "bus";

export function poiIconImageId(cat: PoiCategoryId): string {
  return `pind-poi-${cat}`;
}

function resolveMapCat(cat: PoiCategoryId): PoiMapCategoryId {
  switch (cat) {
    case "mall":
      return "shop";
    case "college":
      return "school";
    case "cinema":
    case "museum":
      return "landmark";
    case "bus":
      return "subway";
    default:
      return cat;
  }
}

function colorOf(cat: PoiCategoryId): { icon: string; text: string } {
  return POI_MAP_COLORS[resolveMapCat(cat)];
}

function circleBadge(fill: string): string {
  return `<circle cx="12" cy="12" r="10.25" fill="${fill}" stroke="#FFFFFF" stroke-width="1.5"/>`;
}

/** Glyph paths (viewBox 0–24). Detail strokes use badge color `c`. */
function glyphInner(cat: PoiMapCategoryId, c: string): string {
  switch (cat) {
    case "restaurant":
      return `<path fill="#fff" d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0z"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" d="M13.2 3.2 9.6 11M18.2 3.4 13.4 11"/>`;
    case "fast_food":
      return `<ellipse cx="14.6" cy="9.2" rx="6.2" ry="5.4" fill="#fff" transform="rotate(-40 14.6 9.2)"/><path fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" d="M10.4 13.6 6.6 17.4"/><circle cx="5.3" cy="16.9" r="1.8" fill="#fff"/><circle cx="7.1" cy="18.7" r="1.8" fill="#fff"/>`;
    case "cafe":
      return `<path fill="#fff" d="M4.5 9.5h11.5v4.5a5.2 5.2 0 0 1-5.2 5.2h-1.1a5.2 5.2 0 0 1-5.2-5.2z"/><path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" d="M16 10.6h1.6a2.6 2.6 0 0 1 0 5.2H16"/><path fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" d="M8.5 3.5c-.9 1 .9 2 0 3M12 3.5c-.9 1 .9 2 0 3"/>`;
    case "bakery":
      return `<path fill="#fff" d="M3.5 14c0-4.4 3.8-7.8 8.5-7.8s8.5 3.4 8.5 7.8v4.3a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2z"/><path fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" d="M8.4 10.2l1.6 2.6M12 9.4v3M15.6 10.2 14 12.8"/>`;
    case "bar":
      return `<rect x="5" y="8.5" width="10" height="12" rx="1.6" fill="#fff"/><circle cx="7" cy="7.6" r="2" fill="#fff"/><circle cx="10" cy="6.8" r="2.3" fill="#fff"/><circle cx="13" cy="7.6" r="2" fill="#fff"/><path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" d="M15 11h1.8a2.2 2.2 0 0 1 2.2 2.2v2.4a2.2 2.2 0 0 1-2.2 2.2H15"/><path fill="none" stroke="${c}" stroke-width="1.3" stroke-linecap="round" d="M8.3 12v5.5M11.7 12v5.5"/>`;
    case "convenience":
      return `<path fill="#fff" d="M3.5 9.5 5 5h14l1.5 4.5z"/><rect x="5" y="10.5" width="14" height="9" fill="#fff"/><rect x="10" y="13.5" width="4" height="6" fill="${c}"/>`;
    case "grocery":
      return `<path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M2.5 4.5h2.8l2.2 9.6h10.2l2.1-6.8H6.6"/><path fill="#fff" d="M7 7.6h12.6l-1.8 5.6H8.2z"/><circle cx="9.2" cy="18.3" r="1.7" fill="#fff"/><circle cx="16.2" cy="18.3" r="1.7" fill="#fff"/>`;
    case "shop":
      return `<rect x="4.5" y="8" width="15" height="12.5" rx="2" fill="#fff"/><path fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" d="M8.8 10V7.2a3.2 3.2 0 0 1 6.4 0V10"/>`;
    case "lodging":
      return `<rect x="2.8" y="6" width="2.2" height="13" fill="#fff"/><rect x="2.8" y="13" width="18.4" height="3.6" fill="#fff"/><rect x="19" y="13" width="2.2" height="6" fill="#fff"/><rect x="6.2" y="9.6" width="4.6" height="2.8" rx="1.2" fill="#fff"/><path fill="#fff" d="M12 12.4v-1.6a1.6 1.6 0 0 1 1.6-1.6h5.6a2 2 0 0 1 2 2v1.2"/>`;
    case "hospital":
      return `<path fill="#fff" d="M9.3 4.5h5.4v4.8h4.8v5.4h-4.8v4.8H9.3v-4.8H4.5V9.3h4.8z"/>`;
    case "pharmacy":
      return `<g transform="rotate(-45 12 12)"><rect x="4" y="8.6" width="16" height="6.8" rx="3.4" fill="#fff"/><rect x="12" y="8.6" width="8" height="6.8" fill="${c}" fill-opacity="0.35"/><path stroke="${c}" stroke-width="1.2" d="M12 8.6v6.8"/></g>`;
    case "bank":
      return `<text x="12" y="16.2" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="800" fill="#fff">₩</text>`;
    case "beauty":
      return `<circle cx="7" cy="17" r="2.8" fill="none" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="2.8" fill="none" stroke="#fff" stroke-width="2"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" d="M8.9 15 17.5 4M15.1 15 6.5 4"/>`;
    case "school":
      return `<path fill="#fff" d="M12 4.5 22 9l-10 4.5L2 9z"/><path fill="#fff" d="M6.6 11.4v4.2c0 1.6 2.4 2.9 5.4 2.9s5.4-1.3 5.4-2.9v-4.2L12 13.8z"/>`;
    case "park":
      return `<circle cx="12" cy="9.6" r="6" fill="#fff"/><rect x="10.9" y="13" width="2.2" height="7.5" fill="#fff"/>`;
    case "landmark":
      return `<path fill="#fff" d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.4l-5.4 3 1.2-5.9L3.4 9.4l6-.7z"/>`;
    case "town_hall":
      return `<path fill="#fff" d="M12 3.5 21 8H3z"/><rect x="5" y="9.4" width="2.2" height="8" fill="#fff"/><rect x="10.9" y="9.4" width="2.2" height="8" fill="#fff"/><rect x="16.8" y="9.4" width="2.2" height="8" fill="#fff"/><rect x="3.5" y="18.4" width="17" height="2.2" fill="#fff"/>`;
    case "police":
      return `<path fill="#fff" d="M12 3 19.5 6v5.6c0 4.6-3.2 8-7.5 9.4-4.3-1.4-7.5-4.8-7.5-9.4V6z"/>`;
    case "post":
      return `<rect x="3.5" y="6" width="17" height="12.5" rx="1.6" fill="#fff"/><path fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M4.5 7.4 12 13l7.5-5.6"/>`;
    case "fuel":
      return `<rect x="4.5" y="4" width="9.5" height="16" rx="1.4" fill="#fff"/><rect x="6.5" y="6.2" width="5.5" height="4" fill="${c}"/><path fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M14 9h2.2a1.6 1.6 0 0 1 1.6 1.6v6a1.4 1.4 0 0 0 2.8 0V8.4L18 5.6"/>`;
    case "parking":
      return `<text x="12" y="16.4" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="14" font-weight="800" fill="#fff">P</text>`;
    case "subway":
      return `<circle cx="12" cy="12" r="5.2" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="12" cy="12" r="2.2" fill="#fff"/>`;
    default:
      return `<circle cx="12" cy="12" r="3.2" fill="#fff"/>`;
  }
}

function glyphScaled(cat: PoiMapCategoryId, badge: string): string {
  // 64% of badge — scale around center.
  return `<g transform="translate(12 12) scale(0.64) translate(-12 -12)">${glyphInner(cat, badge)}</g>`;
}

export function poiCategoryIconSvg(cat: PoiCategoryId): string {
  const mapCat = resolveMapCat(cat);
  const fill = colorOf(cat).icon;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  ${circleBadge(fill)}
  ${glyphScaled(mapCat, fill)}
</svg>`;
}

/** Dynamic subway line badge (line colour + ref glyph). */
export function subwayLineBadgeSvg(
  colour: string,
  ref: string,
): string {
  const label = (ref || "?").slice(0, 2);
  const fontSize = label.length > 1 ? 9 : 11;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  ${circleBadge(colour)}
  <text x="12" y="15.5" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}" font-weight="800" fill="#fff">${label}</text>
</svg>`;
}

export const ALL_POI_CATEGORY_IDS: PoiCategoryId[] = [
  ...ALL_POI_MAP_CATEGORY_IDS,
  "mall",
  "college",
  "cinema",
  "museum",
  "bus",
];

/**
 * MapLibre icon-image expression — custom pind-poi-* ids.
 */
export function poiCategoryIconImageExpr(): unknown {
  return [
    "case",
    [
      "any",
      ["==", ["get", "class"], "cafe"],
      ["all", ["==", ["get", "class"], "shop"], ["==", ["get", "subclass"], "coffee"]],
    ],
    poiIconImageId("cafe"),
    ["==", ["get", "class"], "restaurant"],
    poiIconImageId("restaurant"),
    [
      "any",
      ["==", ["get", "class"], "fast_food"],
      ["==", ["get", "subclass"], "chicken"],
    ],
    poiIconImageId("fast_food"),
    [
      "any",
      ["==", ["get", "class"], "bakery"],
      ["==", ["get", "class"], "ice_cream"],
      ["==", ["get", "class"], "pastry"],
      ["==", ["get", "class"], "confectionery"],
    ],
    poiIconImageId("bakery"),
    [
      "any",
      ["==", ["get", "class"], "bar"],
      ["==", ["get", "class"], "beer"],
      ["==", ["get", "class"], "pub"],
      ["==", ["get", "class"], "alcohol"],
      ["==", ["get", "class"], "wine"],
    ],
    poiIconImageId("bar"),
    ["==", ["get", "class"], "pharmacy"],
    poiIconImageId("pharmacy"),
    [
      "any",
      ["==", ["get", "class"], "bank"],
      ["==", ["get", "class"], "atm"],
    ],
    poiIconImageId("bank"),
    [
      "any",
      ["==", ["get", "class"], "hotel"],
      ["==", ["get", "class"], "lodging"],
      ["==", ["get", "subclass"], "hotel"],
    ],
    poiIconImageId("lodging"),
    [
      "any",
      ["==", ["get", "class"], "hairdresser"],
      ["==", ["get", "class"], "beauty"],
      ["==", ["get", "subclass"], "hairdresser"],
      ["==", ["get", "subclass"], "beauty"],
    ],
    poiIconImageId("beauty"),
    [
      "any",
      ["==", ["get", "class"], "cinema"],
      ["==", ["get", "subclass"], "cinema"],
      ["==", ["get", "class"], "theatre"],
      ["==", ["get", "class"], "theater"],
      ["==", ["get", "class"], "museum"],
      ["==", ["get", "class"], "attraction"],
    ],
    poiIconImageId("landmark"),
    [
      "any",
      ["==", ["get", "class"], "mall"],
      ["==", ["get", "subclass"], "department_store"],
      ["==", ["get", "class"], "department_store"],
    ],
    poiIconImageId("shop"),
    [
      "any",
      [
        "all",
        ["==", ["get", "class"], "shop"],
        ["==", ["get", "subclass"], "convenience"],
      ],
    ],
    poiIconImageId("convenience"),
    [
      "any",
      ["==", ["get", "class"], "grocery"],
      [
        "all",
        ["==", ["get", "class"], "shop"],
        ["==", ["get", "subclass"], "supermarket"],
      ],
    ],
    poiIconImageId("grocery"),
    [
      "any",
      ["==", ["get", "class"], "hospital"],
      ["==", ["get", "class"], "doctors"],
      ["==", ["get", "class"], "clinic"],
      ["==", ["get", "class"], "dentist"],
    ],
    poiIconImageId("hospital"),
    [
      "any",
      ["==", ["get", "class"], "college"],
      ["==", ["get", "class"], "school"],
      ["==", ["get", "class"], "kindergarten"],
      ["==", ["get", "subclass"], "university"],
    ],
    poiIconImageId("school"),
    [
      "any",
      ["==", ["get", "class"], "park"],
      ["==", ["get", "class"], "playground"],
      ["==", ["get", "subclass"], "playground"],
    ],
    poiIconImageId("park"),
    ["==", ["get", "class"], "police"],
    poiIconImageId("police"),
    [
      "any",
      ["==", ["get", "class"], "post"],
      ["==", ["get", "subclass"], "post_office"],
    ],
    poiIconImageId("post"),
    [
      "any",
      ["==", ["get", "class"], "town_hall"],
      ["==", ["get", "class"], "community_centre"],
      ["==", ["get", "class"], "library"],
    ],
    poiIconImageId("town_hall"),
    [
      "any",
      ["==", ["get", "class"], "parking"],
      ["==", ["get", "subclass"], "parking"],
    ],
    poiIconImageId("parking"),
    [
      "any",
      ["==", ["get", "class"], "fuel"],
      ["==", ["get", "subclass"], "fuel"],
    ],
    poiIconImageId("fuel"),
    [
      "any",
      ["==", ["get", "class"], "railway"],
      ["==", ["get", "class"], "rail"],
      ["==", ["get", "class"], "subway"],
    ],
    poiIconImageId("subway"),
    ["==", ["get", "class"], "bus"],
    poiIconImageId("bus"),
    [
      "any",
      ["==", ["get", "class"], "clothes"],
      ["==", ["get", "class"], "shoes"],
      ["==", ["get", "class"], "florist"],
      ["==", ["get", "class"], "books"],
      ["==", ["get", "class"], "gift"],
      ["==", ["get", "class"], "jewelry"],
      ["==", ["get", "class"], "cosmetics"],
      ["==", ["get", "class"], "shop"],
    ],
    poiIconImageId("shop"),
    poiIconImageId("shop"),
  ];
}

/** Category text-color expression (darker for readability). */
export function poiCategoryTextColorExpr(themeId: string): unknown {
  const c = (id: PoiMapCategoryId) => {
    const t = POI_MAP_COLORS[id].text;
    if (themeId === "neon") return t;
    if (themeId === "white") return t;
    return t;
  };
  // Subway station names: dark gray per spec.
  const subwayName = "#1E2124";

  return [
    "case",
    [
      "any",
      ["==", ["get", "class"], "cafe"],
      ["all", ["==", ["get", "class"], "shop"], ["==", ["get", "subclass"], "coffee"]],
    ],
    c("cafe"),
    [
      "any",
      ["==", ["get", "class"], "bar"],
      ["==", ["get", "class"], "beer"],
      ["==", ["get", "class"], "pub"],
    ],
    c("bar"),
    [
      "any",
      ["==", ["get", "class"], "bakery"],
      ["==", ["get", "class"], "ice_cream"],
    ],
    c("bakery"),
    ["==", ["get", "class"], "fast_food"],
    c("fast_food"),
    ["==", ["get", "class"], "restaurant"],
    c("restaurant"),
    [
      "all",
      ["==", ["get", "class"], "shop"],
      ["==", ["get", "subclass"], "convenience"],
    ],
    c("convenience"),
    [
      "any",
      ["==", ["get", "class"], "grocery"],
      ["==", ["get", "subclass"], "supermarket"],
      ["==", ["get", "subclass"], "marketplace"],
    ],
    c("grocery"),
    [
      "any",
      ["==", ["get", "class"], "hairdresser"],
      ["==", ["get", "class"], "beauty"],
    ],
    c("beauty"),
    ["==", ["get", "class"], "pharmacy"],
    c("pharmacy"),
    [
      "any",
      ["==", ["get", "class"], "bank"],
      ["==", ["get", "class"], "atm"],
    ],
    c("bank"),
    [
      "any",
      ["==", ["get", "class"], "hospital"],
      ["==", ["get", "class"], "doctors"],
      ["==", ["get", "class"], "clinic"],
      ["==", ["get", "class"], "dentist"],
    ],
    c("hospital"),
    [
      "any",
      ["==", ["get", "class"], "hotel"],
      ["==", ["get", "class"], "lodging"],
    ],
    c("lodging"),
    ["==", ["get", "class"], "park"],
    c("park"),
    [
      "any",
      ["==", ["get", "class"], "school"],
      ["==", ["get", "class"], "college"],
      ["==", ["get", "class"], "kindergarten"],
    ],
    c("school"),
    ["==", ["get", "class"], "police"],
    c("police"),
    ["==", ["get", "class"], "post"],
    c("post"),
    [
      "any",
      ["==", ["get", "class"], "town_hall"],
      ["==", ["get", "class"], "library"],
    ],
    c("town_hall"),
    ["==", ["get", "class"], "fuel"],
    c("fuel"),
    ["==", ["get", "class"], "parking"],
    c("parking"),
    [
      "any",
      ["==", ["get", "class"], "railway"],
      ["==", ["get", "class"], "rail"],
      ["==", ["get", "class"], "subway"],
    ],
    subwayName,
    [
      "any",
      ["==", ["get", "class"], "attraction"],
      ["==", ["get", "class"], "museum"],
      ["==", ["get", "class"], "cinema"],
    ],
    c("landmark"),
    [
      "any",
      ["==", ["get", "class"], "shop"],
      ["==", ["get", "class"], "clothes"],
      ["==", ["get", "class"], "mall"],
    ],
    c("shop"),
    c("shop"),
  ];
}

export async function ensurePoiCategoryIcons(
  map: Parameters<typeof loadMapImageFromSvg>[0],
): Promise<void> {
  const raw =
    typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2;
  // Prefer 2–3 as specified.
  const dpr = Math.max(2, clampMapPinDpr(raw));
  await Promise.all(
    ALL_POI_CATEGORY_IDS.map((cat) =>
      loadMapImageFromSvg(
        map,
        poiIconImageId(cat),
        poiCategoryIconSvg(cat),
        POI_ICON_CSS_PX,
        POI_ICON_CSS_PX,
        dpr,
      ).catch(() => undefined),
    ),
  );
}
