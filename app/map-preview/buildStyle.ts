/**
 * /map-preview re-exports shared MapLibre styles.
 * Production themes live in lib/pindmapMapStyle (paper, white).
 */
export {
  MAP_PREVIEW_THEME_ORDER,
  MAP_PREVIEW_THEMES,
  buildPindmapStyle,
  buildPreviewStyle,
  parseMapPreviewThemeId,
  type MapPreviewTheme,
  type MapPreviewThemeId,
} from "@/lib/pindmapMapStyle";
