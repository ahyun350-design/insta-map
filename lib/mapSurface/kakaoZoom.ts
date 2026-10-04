/**
 * Kakao JS Map level ↔ MapLibre zoom for matching on-screen ground span.
 *
 * Model:
 * - Kakao level L ≈ WebMercator 256-tile zoom Z256 = 20 - L
 * - OpenMapTiles / MapLibre vector sources default to tileSize 512, which is
 *   one zoom step tighter than the 256-tile reference at the same numeric zoom
 *   → MapLibre zoom Zml = Z256 - 1 = 19 - L
 * - Latitude enters ground-distance via cos(lat) (same on both sides).
 */

const EARTH_CIRCUMFERENCE_M = 40075016.68557849;

export function kakaoLevelToMapLibreZoom(level: number): number {
  const lv = Number.isFinite(level) ? level : 9;
  const z256 = 20 - lv;
  const zml = z256 - 1; // 512-tile offset vs 256 reference
  return Math.max(1, Math.min(20, zml));
}

export function mapLibreZoomToKakaoLevel(zoom: number): number {
  const zml = Number.isFinite(zoom) ? zoom : 10;
  const z256 = zml + 1;
  return Math.max(1, Math.min(14, Math.round(20 - z256)));
}

/** Meters per CSS pixel at lat for a 256-tile WebMercator zoom. */
export function metersPerPixelAtLatZoom256(lat: number, zoom256: number): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  return (EARTH_CIRCUMFERENCE_M * cos) / (256 * 2 ** zoom256);
}

/** Horizontal ground span (km) for Kakao level in a container width (css px). */
export function kakaoLevelWidthKm(level: number, lat: number, widthPx: number): number {
  const z256 = 20 - level;
  return (metersPerPixelAtLatZoom256(lat, z256) * widthPx) / 1000;
}

/** Horizontal ground span (km) for MapLibre zoom (512-corrected model). */
export function mapLibreZoomWidthKm(zoomMl: number, lat: number, widthPx: number): number {
  // Numeric ML zoom covers the same ground as 256-tile zoom (zoomMl + 1)
  const z256Equivalent = zoomMl + 1;
  return (metersPerPixelAtLatZoom256(lat, z256Equivalent) * widthPx) / 1000;
}

export function horizontalSpanKmForMapLibreZoom(
  zoom: number,
  lat: number,
  widthPx: number,
): number {
  return mapLibreZoomWidthKm(zoom, lat, widthPx);
}
