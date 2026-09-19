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

/** List folder color presets (a) — id → hex */
export const LIST_COLOR_PRESETS: Readonly<Record<string, string>> = {
  coral: "#E85D4C",
  orange: "#F0982B",
  yellow: "#E6C200",
  lime: "#7CB342",
  green: "#2E7D57",
  sky: "#2B8CEE",
  violet: "#8E24AA",
  pink: "#E91E8C",
  slate: "#5C6B7A",
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
  listPresetId?: string | null;
  categoryOverrides?: CategoryColorOverrides;
};

/**
 * Single decision point for native MarkerInput.colorHex.
 * Phase 1: always undefined so 1.8 uses built-in category palette (same as today).
 * Later: list preset / category overrides plug in here.
 */
export function resolveNativeMarkerColorHex(
  _input?: ResolveNativeMarkerColorHexInput,
): string | undefined {
  return undefined;
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
 * Attach phase-1 colorHex to a native marker payload.
 * Always omits colorHex today; later list/category overrides resolve here.
 */
export function withNativeMarkerColorHex<T extends { category?: string; colorHex?: string }>(
  marker: T,
  input?: Omit<ResolveNativeMarkerColorHexInput, "category">,
): Omit<T, "colorHex"> & { colorHex?: string } {
  const colorHex = resolveNativeMarkerColorHex({
    category: marker.category,
    listPresetId: input?.listPresetId,
    categoryOverrides: input?.categoryOverrides,
  });
  const { colorHex: _drop, ...rest } = marker;
  if (colorHex === undefined) {
    return rest;
  }
  return { ...rest, colorHex };
}
