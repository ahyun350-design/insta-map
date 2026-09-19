import {
  FEED_POST_CATEGORIES,
  type FeedPostCategory,
} from "@/lib/feedPost";

export type CategoryAppearanceCategory = FeedPostCategory;

export type CategoryColorOverrides = Partial<Record<FeedPostCategory, string>> | null | undefined;

export type CategoryPinStyle = { color: string; emoji: string };

/** Map pin fill + emoji — pre-refactor CATEGORY_PIN from app/page.tsx */
export const DEFAULT_CATEGORY_PIN: Record<FeedPostCategory, CategoryPinStyle> = {
  맛집: { color: "#513229", emoji: "🍽️" },
  술집: { color: "#722F37", emoji: "🍺" },
  카페: { color: "#FCE6B7", emoji: "☕" },
  쇼핑: { color: "#D8EBF9", emoji: "🛍️" },
  숙소: { color: "#D7D4B1", emoji: "🏠" },
  놀거리: { color: "#c4b5fd", emoji: "🎮" },
  여행지: { color: "#99e9f2", emoji: "🗺️" },
};

/** UI chips / text accents — pre-refactor CATEGORY_COLORS from app/page.tsx */
export const DEFAULT_CATEGORY_COLORS: Record<FeedPostCategory, string> = {
  맛집: "#513229",
  술집: "#722F37",
  카페: "#b08d57",
  쇼핑: "#4a7fa5",
  숙소: "#7a7a50",
  놀거리: "#6d4bd6",
  여행지: "#1b9aad",
};

/** List folder color presets — Pantone TCX set (distinct from category 7) */
export const LIST_COLOR_PRESETS: Readonly<Record<string, string>> = {
  sunOrange: "#F48037",
  beetroot: "#A9226B",
  peach: "#F5B8AE",
  foliage: "#7BA640",
  spring: "#5CC49B",
  bronze: "#525F48",
  persian: "#6E7FBE",
  windward: "#6E8CA3",
  violet: "#B085B7",
};

export type ListColorPresetId = keyof typeof LIST_COLOR_PRESETS;

function isFeedPostCategory(value: string): value is FeedPostCategory {
  return (FEED_POST_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Pin fill hex for maps. null / undefined / {} overrides → identical to DEFAULT_CATEGORY_PIN.
 * Unknown category → soft fallback (should not appear in normal UI).
 */
export function resolvePinColor(
  category: string,
  overrides?: CategoryColorOverrides,
): string {
  const fromOverride =
    overrides && typeof overrides === "object"
      ? overrides[category as FeedPostCategory]
      : undefined;
  if (typeof fromOverride === "string" && fromOverride.trim()) {
    return fromOverride.trim();
  }
  if (isFeedPostCategory(category)) {
    return DEFAULT_CATEGORY_PIN[category].color;
  }
  return "#e05555";
}

/**
 * UI accent hex (chips, row bars, headers). Same override rules as resolvePinColor.
 */
export function resolveUiColor(
  category: string,
  overrides?: CategoryColorOverrides,
): string {
  const fromOverride =
    overrides && typeof overrides === "object"
      ? overrides[category as FeedPostCategory]
      : undefined;
  if (typeof fromOverride === "string" && fromOverride.trim()) {
    return fromOverride.trim();
  }
  if (isFeedPostCategory(category)) {
    return DEFAULT_CATEGORY_COLORS[category];
  }
  return "#1a2a7a";
}

export type ResolveNativeMarkerColorHexInput = {
  category?: string;
  /** When set (list map mode), pin fill uses list preset; omit for category default */
  listPresetId?: string | null;
  categoryOverrides?: CategoryColorOverrides;
};

/**
 * Single decision point for native MarkerInput.colorHex.
 * List mode: valid preset → hex. Otherwise undefined → native category palette (1.7/1.8 safe).
 */
export function resolveNativeMarkerColorHex(
  input?: ResolveNativeMarkerColorHexInput,
): string | undefined {
  const raw = input?.listPresetId;
  if (typeof raw !== "string") return undefined;
  const key = raw.trim();
  if (!key) return undefined;
  return LIST_COLOR_PRESETS[key];
}

/** Props helper — pin record via resolvePinColor (emoji from defaults). */
export function buildCategoryPinRecord(
  overrides?: CategoryColorOverrides,
): Record<FeedPostCategory, CategoryPinStyle> {
  const out = {} as Record<FeedPostCategory, CategoryPinStyle>;
  for (const cat of FEED_POST_CATEGORIES) {
    out[cat] = {
      color: resolvePinColor(cat, overrides),
      emoji: DEFAULT_CATEGORY_PIN[cat].emoji,
    };
  }
  return out;
}

/** Props helper — UI colors via resolveUiColor. */
export function buildCategoryColorsRecord(
  overrides?: CategoryColorOverrides,
): Record<FeedPostCategory, string> {
  const out = {} as Record<FeedPostCategory, string>;
  for (const cat of FEED_POST_CATEGORIES) {
    out[cat] = resolveUiColor(cat, overrides);
  }
  return out;
}

/**
 * Attach colorHex for native markers via resolveNativeMarkerColorHex.
 * Strips listPresetId so it never reaches the plugin bridge.
 */
export function withNativeMarkerColorHex<
  T extends { category?: string; colorHex?: string; listPresetId?: string | null },
>(
  marker: T,
  input?: Omit<ResolveNativeMarkerColorHexInput, "category" | "listPresetId">,
): Omit<T, "colorHex" | "listPresetId"> & { colorHex?: string } {
  const colorHex = resolveNativeMarkerColorHex({
    category: marker.category,
    listPresetId: marker.listPresetId,
    categoryOverrides: input?.categoryOverrides,
  });
  const { colorHex: _drop, listPresetId: _list, ...rest } = marker;
  if (colorHex === undefined) {
    return rest;
  }
  return { ...rest, colorHex };
}
