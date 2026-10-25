/**
 * Code-generated POI category icons for MapLibre addImage.
 * 24px color badges + bold white glyphs (Material Symbols–style, Apache-2.0;
 * see lib/mapSurface/icons/LICENSE.md). Registered at device pixelRatio ≤3.
 */

import { clampMapPinDpr, loadMapImageFromSvg } from "@/lib/mapPinImages";

/** Street POI badge size (22–24px). Glyph draws at ~62% of badge. */
export const POI_ICON_CSS_PX = 23;

/** Per-category icon fill + darker label text. */
export const POI_CATEGORY_COLORS = {
  food: { icon: "#E8873A", text: "#8A3A12" },
  cafe: { icon: "#B86A3A", text: "#6A3A1A" },
  bar: { icon: "#8A5AAA", text: "#4A2A6A" },
  bakery: { icon: "#D4A05A", text: "#7A4A1A" },
  // Amber (not red) — avoid red badge + bar glyph reading as “no entry”.
  fast_food: { icon: "#D4A05A", text: "#7A4A1A" },
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

/** Badge behind glyph (viewBox 0 0 24 24). */
function shapePath(cat: PoiCategoryId, fill: string): string {
  const stroke = `#FFFFFF`;
  switch (cat) {
    case "convenience":
    case "grocery":
    case "mall":
    case "shop":
      return `<rect x="1.25" y="1.25" width="21.5" height="21.5" rx="5.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    case "bar":
      return `<path d="M12 1.8 L22.2 12 L12 22.2 L1.8 12 Z" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
    case "hospital":
    case "pharmacy":
      return `<rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    case "lodging":
      return `<rect x="1.2" y="3.5" width="21.6" height="17" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    case "park":
      return `<path d="M12 1.6 L19.8 6.2 V17.8 L12 22.4 L4.2 17.8 V6.2 Z" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
    default:
      return `<circle cx="12" cy="12" r="10.25" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  }
}

/**
 * Bold filled glyphs (~15px / 62% of 24). Adapted from Material Symbols forms.
 */
function glyphPath(cat: PoiCategoryId): string {
  switch (cat) {
    case "cafe":
      // coffee cup
      return `<path fill="#fff" d="M7.2 8.2h8.2v5.1c0 1.7-1.4 3.1-3.1 3.1H10.3c-1.7 0-3.1-1.4-3.1-3.1V8.2zm8.2 1.2h1.6c1.1 0 2 .9 2 2s-.9 2-2 2h-1.6v-4zm-7.4 9.1h8.4v1.4H8z"/>`;
    case "restaurant":
      // Fork + spoon (wide silhouette; avoids vertical fork/knife reading as ||).
      return `<path fill="#fff" d="M7.8 5.4c.5 0 .9.7.9 1.55v2.6c0 .45-.35.8-.7.8h-.4c-.35 0-.7-.35-.7-.8V6.95c0-.85.4-1.55.9-1.55zm-.2 5.1h.55v8.5H7.05v-8.5H7.6zm7.2-4.7c1.65 0 3 1.25 3 2.8 0 1.05-.6 1.95-1.5 2.45v7.25h-1.5V10.05c-.9-.5-1.5-1.4-1.5-2.45 0-1.55 1.35-2.8 3-2.8z"/>`;
    case "bar":
      // beer mug
      return `<path fill="#fff" d="M7 6.4h7.2l-.9 4.4H7.9L7 6.4zm1.4 4.8h4.4v5.6H8.4v-5.6zm7.2-3.2h1.5c1.2 0 2.1 1 2.1 2.2v2.4c0 1.2-.9 2.2-2.1 2.2h-1.5V8z"/>`;
    case "bakery":
      // bread loaf
      return `<path fill="#fff" d="M6.4 13.2c0-2.8 2.1-5 4.8-5h1.6c2.7 0 4.8 2.2 4.8 5H6.4zm2.2-4.6c.5-1.5 1.7-2.5 3.4-2.5s2.9 1 3.4 2.5H8.6z"/>`;
    case "fast_food":
      // Recognizable burger: curved top bun + oval patty + bottom bun (no full-width bars).
      return `<path fill="#fff" d="M7.2 10.2c0-2.4 2.1-4 4.8-4s4.8 1.6 4.8 4H7.2zm.4 1.1h8.8c.5 0 .9.4.9.9v.35c0 .5-.4.9-.9.9H7.6c-.5 0-.9-.4-.9-.9v-.35c0-.5.4-.9.9-.9zm.3 3.1h8.2c.7 0 1.2.5 1.2 1.1 0 .4-.2.7-.5.9H7.2c-.3-.2-.5-.5-.5-.9 0-.6.5-1.1 1.2-1.1z"/>`;
    case "convenience":
      // storefront 24
      return `<path fill="#fff" d="M6.2 9.2 7.5 6.6h9l1.3 2.6H6.2zm0 1.3h11.6v6.9H6.2v-6.9zm3.2 1.5v3.9h1.5v-3.9H9.4zm3.7 0v3.9H14.6v-3.9h-1.5z"/>`;
    case "grocery":
      // shopping cart
      return `<path fill="#fff" d="M6.2 7.2h1.7l.5 2.1h8.9l-1.1 4.4H8.2L6.2 7.2zm3.1 8.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm5.2 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"/>`;
    case "mall":
    case "shop":
      // shopping bag
      return `<path fill="#fff" d="M8.2 9.2V8a3.8 3.8 0 0 1 7.6 0v1.2h1.5v9.2H6.7V9.2h1.5zm1.5 0h4.6V8a2.3 2.3 0 0 0-4.6 0v1.2z"/>`;
    case "bank":
      return `<path fill="#fff" d="M5.8 9.2 12 5.6l6.2 3.6v1.3H5.8V9.2zm1.2 2.1h1.8v4.6H7V11.3zm3.1 0h1.8v4.6h-1.8v-4.6zm3.1 0h1.8v4.6h-1.8v-4.6zm-7.4 5.4h12.4v1.5H5.8v-1.5z"/>`;
    case "pharmacy":
      // pill / cross soft
      return `<path fill="#fff" d="M10.2 6.2h3.6v11.6h-3.6zM6.2 10.2h11.6v3.6H6.2z"/>`;
    case "hospital":
      return `<path fill="#fff" d="M10 5.8h4v12.4h-4zM5.8 10h12.4v4H5.8z"/>`;
    case "school":
    case "college":
      return `<path fill="#fff" d="M12 6.2 5.6 9.6v.9L12 13.9l6.4-3.4v-.9L12 6.2zm-5.2 5.5v3.2L12 18.2l5.2-3.3v-3.2L12 15.5 6.8 11.7z"/>`;
    case "town_hall":
      return `<path fill="#fff" d="M6.2 16.8V9.6L12 6.4l5.8 3.2v7.2h-2.2v-4.2h-7.2v4.2H6.2z"/>`;
    case "police":
      return `<path fill="#fff" d="M12 5.6 16.8 7.4v3.6c0 3.2-2.2 5.4-4.8 6.4-2.6-1-4.8-3.2-4.8-6.4V7.4L12 5.6z"/>`;
    case "post":
      return `<path fill="#fff" d="M5.8 7.6h12.4v8.8H5.8V7.6zm1.3 1.2 5 3.6 4.9-3.6v1.5l-4.9 3.5-5-3.5V8.8z"/>`;
    case "lodging":
      // bed
      return `<path fill="#fff" d="M5.6 15.6V10.8h12.8v4.8h-1.3v-2.2H6.9v2.2H5.6zm1.5-5.6V8.6h4.2v1.4H7.1zm6.2 0V8.6h3.6c.7 0 1.3.6 1.3 1.3v.1h-4.9z"/>`;
    case "cinema":
      return `<path fill="#fff" d="M5.8 7.4h12.4v9.2H5.8V7.4zm3.2 2.2 5.2 2.6-5.2 2.6V9.6z"/>`;
    case "museum":
      return `<path fill="#fff" d="M5.8 16.4V9.4L12 6.2l6.2 3.2v7H5.8zm2.4 0h8v-3.2h-8v3.2z"/>`;
    case "park":
      // tree
      return `<path fill="#fff" d="M12 5.6c2.8 0 5 2.1 5 4.7 0 .4 0 .8-.1 1.1H17c1.4 0 2.5 1.1 2.5 2.5S18.4 16.4 17 16.4H7c-1.4 0-2.5-1.1-2.5-2.5S5.6 11.4 7 11.4h.1c-.1-.3-.1-.7-.1-1.1 0-2.6 2.2-4.7 5-4.7zm-1.1 10.8h2.2v2.2h-2.2v-2.2z"/>`;
    case "parking":
      return `<path fill="#fff" d="M8.2 6.2h4.4c2.3 0 4.1 1.8 4.1 4.1S15 14.4 12.6 14.4H9.7v3.4H8.2V6.2zm1.5 1.5v5.2h2.9c1.4 0 2.6-1.1 2.6-2.6S13.9 7.7 12.5 7.7H9.7z"/>`;
    case "fuel":
      return `<path fill="#fff" d="M7 6.2h5.6v11.6H7V6.2zm5.6 3.2h1.8v4.6c0 1.3 1 2.3 2.3 2.3h.4v-1.5h-.4c-.4 0-.8-.4-.8-.8V9.1c0-.9-.7-1.6-1.6-1.6h-1.7v1.9z"/>`;
    case "subway":
      return `<path fill="#fff" d="M12 6.2a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6zm0 2.2a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z"/>`;
    case "bus":
      return `<path fill="#fff" d="M6.4 7.2h11.2v8.4H6.4V7.2zm1.6 9.2h1.6v1.4H8V16.4zm6.4 0h1.6v1.4h-1.6v-1.4zM7.6 9.8h8.8v2.8H7.6V9.8z"/>`;
    case "landmark":
      // star
      return `<path fill="#fff" d="M12 5.4 13.9 10h4.7l-3.8 2.9 1.4 4.7L12 14.9 7.8 17.6l1.4-4.7L5.4 10h4.7L12 5.4z"/>`;
    default:
      return `<circle cx="12" cy="12" r="3.2" fill="#fff"/>`;
  }
}

export function poiCategoryIconSvg(cat: PoiCategoryId): string {
  const fill = colorOf(cat).icon;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
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
