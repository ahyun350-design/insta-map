/**
 * Building glyph for korea-landmarks symbol layers (MapLibre addImage).
 * Unified with POI category icon set (20px circle). Not stored in storage.
 */

import { loadMapImageFromSvg } from "@/lib/mapPinImages";
import {
  POI_ICON_CSS_PX,
  poiCategoryIconSvg,
  poiIconImageId,
} from "@/lib/mapSurface/poiCategoryIcons";

/** Legacy id kept for existing layer layout references. */
export const KOREA_LANDMARK_ICON_ID = "korea-landmark-building";

export function koreaLandmarkBuildingSvg(): string {
  return poiCategoryIconSvg("landmark");
}

export async function ensureKoreaLandmarkIcon(
  map: Parameters<typeof loadMapImageFromSvg>[0],
): Promise<void> {
  try {
    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2;
    const svg = koreaLandmarkBuildingSvg();
    await loadMapImageFromSvg(
      map,
      KOREA_LANDMARK_ICON_ID,
      svg,
      POI_ICON_CSS_PX,
      POI_ICON_CSS_PX,
      dpr,
    );
    // Alias under category id for shared lookups
    await loadMapImageFromSvg(
      map,
      poiIconImageId("landmark"),
      svg,
      POI_ICON_CSS_PX,
      POI_ICON_CSS_PX,
      dpr,
    );
  } catch {
    /* ignore — labels still render without icon */
  }
}
