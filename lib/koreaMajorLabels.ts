/**
 * Major 동 + landmark anchors for z13+ (OMT place/poi tiles omit these until z14).
 * Coords sampled from OpenMapTiles; names shortened for map labels.
 */

export type KoreaMajorLabel = {
  name: string;
  lng: number;
  lat: number;
  kind: "dong" | "landmark";
};

/** Mapo / Hongdae / Yeonhui major dongs — visible from z13. */
const DONGS: readonly KoreaMajorLabel[] = [
  { name: "망원동", lng: 126.90087, lat: 37.55586, kind: "dong" },
  { name: "합정동", lng: 126.9084, lat: 37.54678, kind: "dong" },
  { name: "성산동", lng: 126.90263, lat: 37.56775, kind: "dong" },
  { name: "연남동", lng: 126.92196, lat: 37.56258, kind: "dong" },
  { name: "상수동", lng: 126.92473, lat: 37.54743, kind: "dong" },
  { name: "서교동", lng: 126.9182, lat: 37.55317, kind: "dong" },
  { name: "동교동", lng: 126.92619, lat: 37.55714, kind: "dong" },
  { name: "상암동", lng: 126.87752, lat: 37.57092, kind: "dong" },
  { name: "당인동", lng: 126.91885, lat: 37.5437, kind: "dong" },
  { name: "창전동", lng: 126.92938, lat: 37.55007, kind: "dong" },
  { name: "연희동", lng: 126.93084, lat: 37.57234, kind: "dong" },
  { name: "양화동", lng: 126.88614, lat: 37.54719, kind: "dong" },
  { name: "중동", lng: 126.90557, lat: 37.57191, kind: "dong" },
  { name: "북가좌동", lng: 126.91156, lat: 37.57953, kind: "dong" },
  { name: "남가좌동", lng: 126.9179, lat: 37.57744, kind: "dong" },
  { name: "대흥동", lng: 126.94016, lat: 37.54956, kind: "dong" },
  { name: "신수동", lng: 126.93728, lat: 37.54821, kind: "dong" },
  { name: "노고산동", lng: 126.93731, lat: 37.55388, kind: "dong" },
  { name: "공덕동", lng: 126.95468, lat: 37.54771, kind: "dong" },
  { name: "아현동", lng: 126.95552, lat: 37.55395, kind: "dong" },
  { name: "도화동", lng: 126.94897, lat: 37.53842, kind: "dong" },
  { name: "염리동", lng: 126.94915, lat: 37.54914, kind: "dong" },
  { name: "홍제동", lng: 126.94676, lat: 37.5871, kind: "dong" },
  { name: "목동", lng: 126.87585, lat: 37.53608, kind: "dong" },
];

/** Large parks / universities / stadiums — z13 anchors. */
const LANDMARKS: readonly KoreaMajorLabel[] = [
  { name: "망원한강공원", lng: 126.90216, lat: 37.55019, kind: "landmark" },
  { name: "서울월드컵경기장", lng: 126.89725, lat: 37.5683, kind: "landmark" },
  { name: "홍익대학교", lng: 126.92544, lat: 37.55035, kind: "landmark" },
  { name: "서강대학교", lng: 126.94099, lat: 37.55209, kind: "landmark" },
  { name: "연세대학교", lng: 126.93938, lat: 37.56784, kind: "landmark" },
  { name: "선유도공원", lng: 126.90032, lat: 37.54342, kind: "landmark" },
  { name: "평화의공원", lng: 126.89429, lat: 37.56278, kind: "landmark" },
  { name: "양화한강공원", lng: 126.89994, lat: 37.54027, kind: "landmark" },
  { name: "마포구청", lng: 126.9017, lat: 37.56633, kind: "landmark" },
  { name: "망원시장", lng: 126.90605, lat: 37.55662, kind: "landmark" },
  { name: "마포농수산물시장", lng: 126.89849, lat: 37.56519, kind: "landmark" },
  { name: "경의선숲길", lng: 126.92265, lat: 37.56217, kind: "landmark" },
];

export const KOREA_MAJOR_LABELS: readonly KoreaMajorLabel[] = [
  ...DONGS,
  ...LANDMARKS,
];

export function koreaMajorLabelsGeoJson() {
  return {
    type: "FeatureCollection" as const,
    features: KOREA_MAJOR_LABELS.map((g) => ({
      type: "Feature" as const,
      properties: { name: g.name, kind: g.kind },
      geometry: {
        type: "Point" as const,
        coordinates: [g.lng, g.lat],
      },
    })),
  };
}
