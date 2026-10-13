/**
 * Building glyph for korea-landmarks symbol layers (MapLibre addImage).
 * Not stored in localStorage / IndexedDB.
 */

import { loadMapImageFromSvg } from "@/lib/mapPinImages";

export const KOREA_LANDMARK_ICON_ID = "korea-landmark-building";

export function koreaLandmarkBuildingSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect x="3" y="3" width="26" height="26" rx="6" fill="#5A6B8C"/>
  <rect x="9" y="10" width="5" height="5" rx="1" fill="#FFFFFF" opacity="0.92"/>
  <rect x="18" y="10" width="5" height="5" rx="1" fill="#FFFFFF" opacity="0.92"/>
  <rect x="9" y="18" width="5" height="5" rx="1" fill="#FFFFFF" opacity="0.92"/>
  <rect x="18" y="18" width="5" height="5" rx="1" fill="#FFFFFF" opacity="0.92"/>
</svg>`;
}

export async function ensureKoreaLandmarkIcon(
  map: Parameters<typeof loadMapImageFromSvg>[0],
): Promise<void> {
  try {
    await loadMapImageFromSvg(
      map,
      KOREA_LANDMARK_ICON_ID,
      koreaLandmarkBuildingSvg(),
      14,
      14,
      typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2,
    );
  } catch {
    /* ignore — labels still render without icon */
  }
}
