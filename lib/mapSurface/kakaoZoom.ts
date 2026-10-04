/**
 * Kakao JS Map level (smaller = closer) ↔ MapLibre zoom (larger = closer).
 * Tuned so common app levels feel similar: L4≈neighborhood, L9≈city.
 */
export function kakaoLevelToMapLibreZoom(level: number): number {
  const lv = Number.isFinite(level) ? level : 9;
  return Math.max(1, Math.min(20, 20 - lv));
}

export function mapLibreZoomToKakaoLevel(zoom: number): number {
  const z = Number.isFinite(zoom) ? zoom : 11;
  return Math.max(1, Math.min(14, Math.round(20 - z)));
}
