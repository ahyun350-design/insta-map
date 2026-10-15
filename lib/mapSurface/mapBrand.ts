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
 *
 * Pretendard (OFL) decision (2026-10): do **not** put Pretendard here for Hangul.
 * Serving Hangul glyph PBFs or waiting on a full Pretendard webfont before first
 * paint adds hundreds of ms on cold load; device SDF is already Kakao-like and free.
 * Latin/digit labels keep Noto Sans Regular from same-origin `/map/glyphs` (or OFM).
 * If we ever brand Latin-only UI chrome, load a Pretendard Latin subset in CSS —
 * not in the MapLibre ideograph path.
 */
export const MAP_LOCAL_IDEOGRAPH_FONT_FAMILY =
  "'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";

/** Decision flag for reports / future toggles — Hangul stays on device fonts. */
export const MAP_USE_PRETENDARD_FOR_HANGUL = false;
