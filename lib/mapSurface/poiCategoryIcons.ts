/**
 * Code-generated POI category icons for MapLibre addImage.
 * Distinct category colors + shapes (18–20 CSS px) + white stroke + white glyph.
 * No external downloads. Registered with device pixelRatio (≤3).
 */

import { clampMapPinDpr, loadMapImageFromSvg } from "@/lib/mapPinImages";

/** Kakao-like street POI mark size (18–20px). */
export const POI_ICON_CSS_PX = 19;

/** Per-category icon fill + darker label text. */
export const POI_CATEGORY_COLORS = {
  food: { icon: "#E8873A", text: "#8A3A12" },
  cafe: { icon: "#B86A3A", text: "#6A3A1A" },
  bar: { icon: "#8A5AAA", text: "#4A2A6A" },
  bakery: { icon: "#D4A05A", text: "#7A4A1A" },
  fast_food: { icon: "#E07040", text: "#8A3010" },
  shopping: { icon: "#E070A0", text: "#8A2A5A" },
  convenience: { icon: "#3AAA5A", text: "#1A6A2A" },
  grocery: { icon: "#5ABA6A", text: "#2A6A2A" },
  life: { icon: "#5A6A9A", text: "#2A3A6A" },
  medical: { icon: "#E05050", text: "#8A1A1A" },
  pharmacy: { icon: "#2AAA6A", text: "#1A6A3A" },
  culture: { icon: "#9A6A8A", text: "#5A2E4A" },
  lodging: { icon: "#4A7ABA", text: "#1A3A6A" },
  park: { icon: "#4A7A44", text: "#2A4A28" },
  education: { icon: "#5A7AAA", text: "#2E4A7A" },
  transit: { icon: "#5A6A7A", text: "#2E3E4A" },
  other: { icon: "#8A8A92", text: "#4A4A52" },
  landmark: { icon: "#6A6A72", text: "#2A2A32" },
} as const;

export type PoiCategoryId =
  | "cafe"
  | "restaurant"
  | "bar"
  | "bakery"
  | "fast_food"
  | "convenience"
  | "grocery"
  | "mall"
  | "bank"
  | "pharmacy"
  | "hospital"
  | "school"
  | "college"
  | "town_hall"
  | "police"
  | "post"
  | "lodging"
  | "cinema"
  | "museum"
  | "park"
  | "parking"
  | "fuel"
  | "subway"
  | "bus"
  | "landmark"
  | "shop";

export function poiIconImageId(cat: PoiCategoryId): string {
  return `pind-poi-${cat}`;
}

function colorOf(cat: PoiCategoryId): { icon: string; text: string } {
  switch (cat) {
    case "cafe":
      return POI_CATEGORY_COLORS.cafe;
    case "restaurant":
      return POI_CATEGORY_COLORS.food;
    case "bar":
      return POI_CATEGORY_COLORS.bar;
    case "bakery":
      return POI_CATEGORY_COLORS.bakery;
    case "fast_food":
      return POI_CATEGORY_COLORS.fast_food;
    case "convenience":
      return POI_CATEGORY_COLORS.convenience;
    case "grocery":
      return POI_CATEGORY_COLORS.grocery;
    case "mall":
    case "shop":
      return POI_CATEGORY_COLORS.shopping;
    case "bank":
    case "post":
    case "town_hall":
    case "police":
    case "parking":
    case "fuel":
      return POI_CATEGORY_COLORS.life;
    case "pharmacy":
      return POI_CATEGORY_COLORS.pharmacy;
    case "hospital":
      return POI_CATEGORY_COLORS.medical;
    case "lodging":
      return POI_CATEGORY_COLORS.lodging;
    case "cinema":
    case "museum":
      return POI_CATEGORY_COLORS.culture;
    case "park":
      return POI_CATEGORY_COLORS.park;
    case "school":
    case "college":
      return POI_CATEGORY_COLORS.education;
    case "subway":
    case "bus":
      return POI_CATEGORY_COLORS.transit;
    case "landmark":
      return POI_CATEGORY_COLORS.landmark;
    default:
      return POI_CATEGORY_COLORS.other;
  }
}

/** Shape silhouette behind the glyph (viewBox 0 0 20 20). */
function shapePath(cat: PoiCategoryId, fill: string): string {
  switch (cat) {
    case "convenience":
    case "grocery":
    case "mall":
    case "shop":
      // Rounded square — shopping / convenience
      return `<rect x="1.5" y="1.5" width="17" height="17" rx="4.5" fill="${fill}" stroke="#FFFFFF" stroke-width="1.5"/>`;
    case "bar":
      // Soft diamond
      return `<path d="M10 1.6 L18.4 10 L10 18.4 L1.6 10 Z" fill="${fill}" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>`;
    case "hospital":
    case "pharmacy":
      // Soft octagon-ish rounded rect taller feel via circle still, slight square
      return `<rect x="1.8" y="1.8" width="16.4" height="16.4" rx="5" fill="${fill}" stroke="#FFFFFF" stroke-width="1.5"/>`;
    case "lodging":
      // Rounded rectangle (landscape)
      return `<rect x="1.2" y="3.2" width="17.6" height="13.6" rx="4" fill="${fill}" stroke="#FFFFFF" stroke-width="1.5"/>`;
    case "park":
      // Soft hex
      return `<path d="M10 1.5 L16.8 5.2 V14.8 L10 18.5 L3.2 14.8 V5.2 Z" fill="${fill}" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>`;
    default:
      return `<circle cx="10" cy="10" r="9.25" fill="${fill}" stroke="#FFFFFF" stroke-width="1.5"/>`;
  }
}

/** Simple white path inside the 20×20 mark. */
function glyphPath(cat: PoiCategoryId): string {
  switch (cat) {
    case "cafe":
      return `<path d="M7 8h6v4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8zm6 1h1.2a1.3 1.3 0 0 1 0 2.6H13" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`;
    case "restaurant":
      return `<path d="M8 6v8M8 6c0 2 .8 3 2 3M12 6v8M12 6v3c0 1.2.6 2 1.5 2" fill="none" stroke="#fff" stroke-width="1.25" stroke-linecap="round"/>`;
    case "bar":
      return `<path d="M7 6.5h6l-1.2 3.5H8.2L7 6.5zm1.5 3.5v4h3v-4" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "bakery":
      return `<path d="M6.5 12c0-2.5 1.5-4.5 3.5-4.5S13.5 9.5 13.5 12H6.5zM8 8.5c.3-1.2 1-2 2-2s1.7.8 2 2" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`;
    case "fast_food":
      return `<path d="M7 9h6v5H7zM8.5 9V7.5M11.5 9V7.5M7 11h6" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`;
    case "convenience":
      return `<path d="M7 7h6v6H7zM9.5 9.5v3M8 11h3" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`;
    case "grocery":
      return `<path d="M6.5 8h7l-.5 6h-6L6.5 8zm2 0V7a1.5 1.5 0 0 1 3 0v1" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "mall":
      return `<path d="M6 13V8l4-2 4 2v5M8 13v-3h4v3" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "bank":
      return `<path d="M6 8.5l4-2.5 4 2.5M6.5 9.5h7M7.5 9.5v3.5M10 9.5v3.5M12.5 9.5v3.5M6.5 13.5h7" fill="none" stroke="#fff" stroke-width="1.15" stroke-linecap="round"/>`;
    case "pharmacy":
      return `<path d="M9.2 6.5h1.6v7H9.2zM6.5 9.2h7v1.6h-7z" fill="#fff"/>`;
    case "hospital":
      return `<path d="M9.1 6.2h1.8v7.6H9.1zM6.2 9.1h7.6v1.8H6.2z" fill="#fff"/>`;
    case "school":
      return `<path d="M6 9.5l4-2.5 4 2.5-4 2.5-4-2.5zm0 0v3.5l4 2 4-2V9.5" fill="none" stroke="#fff" stroke-width="1.15" stroke-linejoin="round"/>`;
    case "college":
      return `<path d="M6 10l4-2.5 4 2.5M7.5 10.5v2.5c1.2.8 2.5 1.2 2.5 1.2s1.3-.4 2.5-1.2V10.5" fill="none" stroke="#fff" stroke-width="1.15" stroke-linecap="round"/>`;
    case "town_hall":
      return `<path d="M6 13V9l4-2.5L14 9v4M8 13v-2.5h4V13" fill="none" stroke="#fff" stroke-width="1.15" stroke-linejoin="round"/>`;
    case "police":
      return `<path d="M10 6.2l2.8 1.2v2.8c0 2.2-1.4 3.6-2.8 4.2-1.4-.6-2.8-2-2.8-4.2V7.4L10 6.2z" fill="none" stroke="#fff" stroke-width="1.15"/>`;
    case "post":
      return `<path d="M6.5 7.5h7v5h-7zM6.5 7.5L10 10.5 13.5 7.5" fill="none" stroke="#fff" stroke-width="1.15" stroke-linejoin="round"/>`;
    case "lodging":
      return `<path d="M6 13V9.5h8V13M6.5 9.5V8h3v1.5M7 11h1.5M11 11h1.5" fill="none" stroke="#fff" stroke-width="1.15" stroke-linecap="round"/>`;
    case "cinema":
      return `<path d="M6.5 7.5h7v5h-7zM8 9.5l3 1.5-3 1.5v-3z" fill="none" stroke="#fff" stroke-width="1.15" stroke-linejoin="round"/>`;
    case "museum":
      return `<path d="M6 12.5V9l4-2.5 4 2.5v3.5M7.5 12.5v-2h5v2" fill="none" stroke="#fff" stroke-width="1.15" stroke-linejoin="round"/>`;
    case "park":
      return `<path d="M10 13V9M7 10.5c0-2 1.3-3.5 3-3.5s3 1.5 3 3.5" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`;
    case "parking":
      return `<path d="M7.5 6.5h3.2a2.3 2.3 0 0 1 0 4.6H7.5V6.5zm0 4.6V13.5" fill="none" stroke="#fff" stroke-width="1.25" stroke-linecap="round"/>`;
    case "fuel":
      return `<path d="M7 6.5h4.5v7H7zM11.5 9h1.2v3.2a1 1 0 0 0 1 1" fill="none" stroke="#fff" stroke-width="1.15" stroke-linecap="round"/>`;
    case "subway":
      return `<circle cx="10" cy="10" r="3.2" fill="none" stroke="#fff" stroke-width="1.25"/><path d="M10 6.2v1.2M10 12.6v1.2M6.2 10h1.2M12.6 10h1.2" stroke="#fff" stroke-width="1.15" stroke-linecap="round"/>`;
    case "bus":
      return `<path d="M6.5 7.5h7v5.5h-7zM8 13v1M12 13v1M6.5 10.5h7" fill="none" stroke="#fff" stroke-width="1.15" stroke-linecap="round"/>`;
    case "landmark":
      return `<path d="M7 13V8.5l3-2.5 3 2.5V13M8.5 13v-2.5h3V13" fill="none" stroke="#fff" stroke-width="1.15" stroke-linejoin="round"/>`;
    default:
      return `<circle cx="10" cy="10" r="2.2" fill="#fff"/>`;
  }
}

export function poiCategoryIconSvg(cat: PoiCategoryId): string {
  const fill = colorOf(cat).icon;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  ${shapePath(cat, fill)}
  ${glyphPath(cat)}
</svg>`;
}

export const ALL_POI_CATEGORY_IDS: PoiCategoryId[] = [
  "cafe",
  "restaurant",
  "bar",
  "bakery",
  "fast_food",
  "convenience",
  "grocery",
  "mall",
  "bank",
  "pharmacy",
  "hospital",
  "school",
  "college",
  "town_hall",
  "police",
  "post",
  "lodging",
  "cinema",
  "museum",
  "park",
  "parking",
  "fuel",
  "subway",
  "bus",
  "landmark",
  "shop",
];

/**
 * MapLibre icon-image expression — custom pind-poi-* ids (replaces *_11 sprites).
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
    ["==", ["get", "class"], "fast_food"],
    poiIconImageId("fast_food"),
    ["==", ["get", "class"], "bakery"],
    poiIconImageId("bakery"),
    [
      "any",
      ["==", ["get", "class"], "bar"],
      ["==", ["get", "class"], "beer"],
    ],
    poiIconImageId("bar"),
    ["==", ["get", "class"], "pharmacy"],
    poiIconImageId("pharmacy"),
    ["==", ["get", "class"], "bank"],
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
      ["==", ["get", "class"], "cinema"],
      ["==", ["get", "subclass"], "cinema"],
      ["==", ["get", "class"], "theatre"],
      ["==", ["get", "class"], "theater"],
    ],
    poiIconImageId("cinema"),
    ["==", ["get", "class"], "museum"],
    poiIconImageId("museum"),
    [
      "any",
      ["==", ["get", "class"], "mall"],
      ["==", ["get", "subclass"], "department_store"],
      ["==", ["get", "class"], "department_store"],
    ],
    poiIconImageId("mall"),
    [
      "any",
      ["all", ["==", ["get", "class"], "shop"], ["==", ["get", "subclass"], "convenience"]],
    ],
    poiIconImageId("convenience"),
    [
      "any",
      ["==", ["get", "class"], "grocery"],
      ["all", ["==", ["get", "class"], "shop"], ["==", ["get", "subclass"], "supermarket"]],
    ],
    poiIconImageId("grocery"),
    ["==", ["get", "class"], "hospital"],
    poiIconImageId("hospital"),
    ["==", ["get", "class"], "college"],
    poiIconImageId("college"),
    [
      "any",
      ["==", ["get", "class"], "school"],
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
    ["==", ["get", "class"], "post"],
    poiIconImageId("post"),
    ["==", ["get", "class"], "town_hall"],
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
    ],
    poiIconImageId("subway"),
    ["==", ["get", "class"], "bus"],
    poiIconImageId("bus"),
    ["==", ["get", "class"], "shop"],
    poiIconImageId("shop"),
    poiIconImageId("shop"),
  ];
}

/** Category text-color expression (darker for readability; neon/white variants). */
export function poiCategoryTextColorExpr(themeId: string): unknown {
  const food =
    themeId === "neon" ? "#D4A090" : themeId === "white" ? "#8A3A12" : POI_CATEGORY_COLORS.food.text;
  const cafe =
    themeId === "neon" ? "#D4A090" : themeId === "white" ? "#6A3A1A" : POI_CATEGORY_COLORS.cafe.text;
  const bar =
    themeId === "neon" ? "#C8A0E0" : themeId === "white" ? "#4A2A6A" : POI_CATEGORY_COLORS.bar.text;
  const bakery =
    themeId === "neon" ? "#E0C090" : themeId === "white" ? "#7A4A1A" : POI_CATEGORY_COLORS.bakery.text;
  const shopping =
    themeId === "neon" ? "#E0A0C0" : themeId === "white" ? "#8A2A5A" : POI_CATEGORY_COLORS.shopping.text;
  const convenience =
    themeId === "neon" ? "#7ABA8A" : themeId === "white" ? "#1A6A2A" : POI_CATEGORY_COLORS.convenience.text;
  const life =
    themeId === "neon" ? "#8A9AC8" : themeId === "white" ? "#2A3A6A" : POI_CATEGORY_COLORS.life.text;
  const medical =
    themeId === "neon" ? "#E08080" : themeId === "white" ? "#8A1A1A" : POI_CATEGORY_COLORS.medical.text;
  const pharmacy =
    themeId === "neon" ? "#7ABA9A" : themeId === "white" ? "#1A6A3A" : POI_CATEGORY_COLORS.pharmacy.text;
  const culture =
    themeId === "neon" ? "#C898B0" : themeId === "white" ? "#5A2E4A" : POI_CATEGORY_COLORS.culture.text;
  const lodging =
    themeId === "neon" ? "#9AB8D0" : themeId === "white" ? "#1A3A6A" : POI_CATEGORY_COLORS.lodging.text;
  const park =
    themeId === "neon" ? "#7AB8A0" : themeId === "white" ? "#2A4A28" : POI_CATEGORY_COLORS.park.text;
  const education =
    themeId === "neon" ? "#8AA0D0" : themeId === "white" ? "#2E4A7A" : POI_CATEGORY_COLORS.education.text;
  const other =
    themeId === "neon" ? "#A0A0B0" : themeId === "white" ? "#4A4A52" : POI_CATEGORY_COLORS.other.text;

  return [
    "case",
    [
      "any",
      ["==", ["get", "class"], "cafe"],
      ["all", ["==", ["get", "class"], "shop"], ["==", ["get", "subclass"], "coffee"]],
    ],
    cafe,
    [
      "any",
      ["==", ["get", "class"], "bar"],
      ["==", ["get", "class"], "beer"],
    ],
    bar,
    ["==", ["get", "class"], "bakery"],
    bakery,
    [
      "any",
      ["==", ["get", "class"], "restaurant"],
      ["==", ["get", "class"], "fast_food"],
      ["==", ["get", "class"], "ice_cream"],
    ],
    food,
    [
      "any",
      ["all", ["==", ["get", "class"], "shop"], ["==", ["get", "subclass"], "convenience"]],
    ],
    convenience,
    [
      "any",
      ["==", ["get", "class"], "shop"],
      ["==", ["get", "class"], "grocery"],
      ["==", ["get", "class"], "clothes"],
      ["==", ["get", "class"], "mall"],
      ["==", ["get", "class"], "department_store"],
      ["==", ["get", "subclass"], "department_store"],
      ["==", ["get", "subclass"], "supermarket"],
    ],
    shopping,
    ["==", ["get", "class"], "pharmacy"],
    pharmacy,
    [
      "any",
      ["==", ["get", "class"], "bank"],
      ["==", ["get", "class"], "post"],
      ["==", ["get", "class"], "town_hall"],
      ["==", ["get", "class"], "police"],
      ["==", ["get", "class"], "parking"],
      ["==", ["get", "class"], "fuel"],
    ],
    life,
    ["==", ["get", "class"], "hospital"],
    medical,
    [
      "any",
      ["==", ["get", "class"], "hotel"],
      ["==", ["get", "class"], "lodging"],
    ],
    lodging,
    [
      "any",
      ["==", ["get", "class"], "cinema"],
      ["==", ["get", "class"], "theatre"],
      ["==", ["get", "class"], "theater"],
      ["==", ["get", "class"], "museum"],
    ],
    culture,
    ["==", ["get", "class"], "park"],
    park,
    [
      "any",
      ["==", ["get", "class"], "school"],
      ["==", ["get", "class"], "college"],
      ["==", ["get", "subclass"], "university"],
    ],
    education,
    other,
  ];
}

export async function ensurePoiCategoryIcons(
  map: Parameters<typeof loadMapImageFromSvg>[0],
): Promise<void> {
  const dpr =
    typeof window !== "undefined" ? clampMapPinDpr(window.devicePixelRatio || 2) : 2;
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
