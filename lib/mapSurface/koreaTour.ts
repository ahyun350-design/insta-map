/**
 * Admin self-tiles: TourAPI 명소 from Supabase map-tiles/korea-tour.geojson.
 * HTTP cache only — never localStorage/IndexedDB.
 */

export const KOREA_TOUR_SOURCE = "korea_tour";

export function getKoreaTourPublicUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (!base) return "";
  return `${base}/storage/v1/object/public/map-tiles/korea-tour.geojson`;
}

export function ensureKoreaTourSource(style: {
  sources?: Record<string, unknown>;
}): void {
  if (!style.sources) style.sources = {};
  if (style.sources[KOREA_TOUR_SOURCE]) return;
  const url = getKoreaTourPublicUrl();
  if (!url) return;
  style.sources[KOREA_TOUR_SOURCE] = {
    type: "geojson",
    data: url,
    attribution: "한국관광공사",
  };
}
