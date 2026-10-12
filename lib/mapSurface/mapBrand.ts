/**
 * MapLibre brand tokens — keep in sync with CSS `--map-navy` (.screenMapTab).
 * Cluster circles and route lines must use MAP_BRAND_NAVY (no scattered hex literals).
 */
export const MAP_BRAND_NAVY = "#1a2a7a";
export const MAP_ROUTE_CASING_WHITE = "#FFFFFF";
export const MAP_ROUTE_PREVIEW_GRAY = "#B5BAC6";

/**
 * Neon accent — CourseMapDesignOverlay number-pin fill (#F0E4C3).
 * Path on that overlay was white dashed; core uses a near-white cream tint.
 */
export const MAP_NEON_ACCENT = "#F0E4C3";
export const MAP_NEON_CORE = "#FFF8E6";
export const MAP_NEON_PREVIEW = "#C9CEF5";
export const MAP_NEON_CLUSTER_FILL = "#12183A";

/** Directions chrome (admin MapLibre) — lime path / endpoint accent. */
export const MAP_DIRECTIONS_LIME = "#D9F45B";

/**
 * MapLibre `localIdeographFontFamily` — CJK/Hangul via device fonts (TinySDF),
 * avoiding Hangul glyph `.pbf` round-trips. Default library value is `sans-serif`.
 */
export const MAP_LOCAL_IDEOGRAPH_FONT_FAMILY =
  "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
