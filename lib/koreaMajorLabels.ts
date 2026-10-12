/**
 * Major 동 + landmark anchors for z11–14 (OMT place/poi tiles are sparse until z14).
 * Coords sampled from OpenMapTiles; names shortened for map labels.
 * Lower `priority` = more important (used as symbol-sort-key).
 */

export type KoreaMajorLabel = {
  name: string;
  lng: number;
  lat: number;
  kind: "dong" | "landmark" | "mountain";
  /** Placement priority (lower wins). Famous hubs ~1–20. */
  priority?: number;
};

/** Famous / large 동 across Seoul — visible from z11. */
const DONGS: readonly KoreaMajorLabel[] = [
  // Mapo / Hongdae / northwest
  { name: "상암동", lng: 126.87752, lat: 37.57092, kind: "dong", priority: 2 },
  { name: "망원동", lng: 126.90087, lat: 37.55586, kind: "dong", priority: 3 },
  { name: "합정동", lng: 126.9084, lat: 37.54678, kind: "dong", priority: 3 },
  { name: "성산동", lng: 126.90263, lat: 37.56775, kind: "dong", priority: 8 },
  { name: "연남동", lng: 126.92196, lat: 37.56258, kind: "dong", priority: 5 },
  { name: "상수동", lng: 126.92473, lat: 37.54743, kind: "dong", priority: 10 },
  { name: "서교동", lng: 126.9182, lat: 37.55317, kind: "dong", priority: 6 },
  { name: "동교동", lng: 126.92619, lat: 37.55714, kind: "dong", priority: 10 },
  { name: "당인동", lng: 126.91885, lat: 37.5437, kind: "dong", priority: 18 },
  { name: "창전동", lng: 126.92938, lat: 37.55007, kind: "dong", priority: 16 },
  { name: "연희동", lng: 126.93084, lat: 37.57234, kind: "dong", priority: 4 },
  { name: "신촌", lng: 126.9368, lat: 37.5551, kind: "dong", priority: 2 },
  { name: "양화동", lng: 126.88614, lat: 37.54719, kind: "dong", priority: 14 },
  { name: "중동", lng: 126.90557, lat: 37.57191, kind: "dong", priority: 16 },
  { name: "북가좌동", lng: 126.91156, lat: 37.57953, kind: "dong", priority: 14 },
  { name: "남가좌동", lng: 126.9179, lat: 37.57744, kind: "dong", priority: 14 },
  { name: "대흥동", lng: 126.94016, lat: 37.54956, kind: "dong", priority: 12 },
  { name: "신수동", lng: 126.93728, lat: 37.54821, kind: "dong", priority: 14 },
  { name: "노고산동", lng: 126.93731, lat: 37.55388, kind: "dong", priority: 16 },
  { name: "공덕동", lng: 126.95468, lat: 37.54771, kind: "dong", priority: 6 },
  { name: "아현동", lng: 126.95552, lat: 37.55395, kind: "dong", priority: 12 },
  { name: "도화동", lng: 126.94897, lat: 37.53842, kind: "dong", priority: 14 },
  { name: "염리동", lng: 126.94915, lat: 37.54914, kind: "dong", priority: 16 },
  { name: "홍제동", lng: 126.94676, lat: 37.5871, kind: "dong", priority: 10 },
  { name: "목동", lng: 126.87585, lat: 37.53608, kind: "dong", priority: 5 },
  { name: "여의도", lng: 126.9245, lat: 37.5219, kind: "dong", priority: 1 },
  { name: "영등포동", lng: 126.907, lat: 37.5185, kind: "dong", priority: 8 },
  { name: "문래동", lng: 126.8948, lat: 37.5178, kind: "dong", priority: 10 },
  { name: "당산동", lng: 126.9022, lat: 37.5342, kind: "dong", priority: 12 },
  // Eunpyeong / northwest
  { name: "연신내", lng: 126.9212, lat: 37.619, kind: "dong", priority: 6 },
  { name: "불광동", lng: 126.9298, lat: 37.6105, kind: "dong", priority: 10 },
  { name: "응암동", lng: 126.9185, lat: 37.5985, kind: "dong", priority: 12 },
  { name: "수색동", lng: 126.8955, lat: 37.5808, kind: "dong", priority: 14 },
  { name: "증산동", lng: 126.906, lat: 37.5835, kind: "dong", priority: 16 },
  // Central / north
  { name: "이태원", lng: 126.994, lat: 37.5345, kind: "dong", priority: 2 },
  { name: "한남동", lng: 127.0085, lat: 37.5348, kind: "dong", priority: 6 },
  { name: "삼청동", lng: 126.9815, lat: 37.5825, kind: "dong", priority: 8 },
  { name: "인사동", lng: 126.9855, lat: 37.5715, kind: "dong", priority: 8 },
  { name: "명동", lng: 126.985, lat: 37.5635, kind: "dong", priority: 3 },
  { name: "종로", lng: 126.9895, lat: 37.5705, kind: "dong", priority: 5 },
  { name: "혜화동", lng: 127.0015, lat: 37.5825, kind: "dong", priority: 8 },
  { name: "성수동", lng: 127.0565, lat: 37.5445, kind: "dong", priority: 2 },
  { name: "왕십리", lng: 127.0295, lat: 37.5615, kind: "dong", priority: 8 },
  { name: "건대", lng: 127.0705, lat: 37.5405, kind: "dong", priority: 5 },
  { name: "화양동", lng: 127.0685, lat: 37.5435, kind: "dong", priority: 12 },
  // Gangnam / southeast
  { name: "역삼동", lng: 127.0365, lat: 37.5005, kind: "dong", priority: 4 },
  { name: "삼성동", lng: 127.0595, lat: 37.5085, kind: "dong", priority: 5 },
  { name: "청담동", lng: 127.0475, lat: 37.5235, kind: "dong", priority: 6 },
  { name: "압구정", lng: 127.0285, lat: 37.5275, kind: "dong", priority: 4 },
  { name: "신사동", lng: 127.0205, lat: 37.5165, kind: "dong", priority: 6 },
  { name: "논현동", lng: 127.0285, lat: 37.5115, kind: "dong", priority: 8 },
  { name: "대치동", lng: 127.0575, lat: 37.4935, kind: "dong", priority: 5 },
  { name: "도곡동", lng: 127.04, lat: 37.4895, kind: "dong", priority: 8 },
  { name: "개포동", lng: 127.0575, lat: 37.4785, kind: "dong", priority: 10 },
  { name: "수서", lng: 127.1015, lat: 37.4875, kind: "dong", priority: 8 },
  { name: "양재", lng: 127.0365, lat: 37.4845, kind: "dong", priority: 6 },
  { name: "서초동", lng: 127.0195, lat: 37.4905, kind: "dong", priority: 5 },
  { name: "반포동", lng: 126.9955, lat: 37.5045, kind: "dong", priority: 7 },
  { name: "잠원동", lng: 127.01, lat: 37.5155, kind: "dong", priority: 10 },
  { name: "방배동", lng: 126.9945, lat: 37.4815, kind: "dong", priority: 9 },
  { name: "교대", lng: 127.0145, lat: 37.4935, kind: "dong", priority: 7 },
  { name: "강남", lng: 127.0276, lat: 37.4979, kind: "dong", priority: 1 },
  { name: "선릉", lng: 127.0485, lat: 37.5045, kind: "dong", priority: 6 },
  { name: "학동", lng: 127.0325, lat: 37.5145, kind: "dong", priority: 9 },
  { name: "언주", lng: 127.0345, lat: 37.5075, kind: "dong", priority: 11 },
  { name: "신논현", lng: 127.0255, lat: 37.5045, kind: "dong", priority: 8 },
  { name: "논현", lng: 127.0235, lat: 37.511, kind: "dong", priority: 10 },
  { name: "청담", lng: 127.047, lat: 37.52, kind: "dong", priority: 9 },
  { name: "대치", lng: 127.055, lat: 37.4945, kind: "dong", priority: 10 },
  { name: "도곡", lng: 127.038, lat: 37.491, kind: "dong", priority: 12 },
  { name: "개포", lng: 127.055, lat: 37.482, kind: "dong", priority: 14 },
  { name: "일원동", lng: 127.0825, lat: 37.4835, kind: "dong", priority: 14 },
  { name: "잠실", lng: 127.1005, lat: 37.5135, kind: "dong", priority: 3 },
  { name: "천호동", lng: 127.1245, lat: 37.5385, kind: "dong", priority: 10 },
  // Mapo fill for z13
  { name: "서강", lng: 126.9355, lat: 37.5505, kind: "dong", priority: 12 },
  { name: "광흥창", lng: 126.9325, lat: 37.5475, kind: "dong", priority: 14 },
  { name: "마포", lng: 126.9455, lat: 37.5395, kind: "dong", priority: 8 },
  { name: "공덕", lng: 126.9515, lat: 37.5445, kind: "dong", priority: 9 },
  { name: "애오개", lng: 126.9565, lat: 37.5505, kind: "dong", priority: 15 },
  { name: "충정로", lng: 126.9645, lat: 37.5605, kind: "dong", priority: 12 },
  // Southwest
  { name: "신림동", lng: 126.9295, lat: 37.4845, kind: "dong", priority: 6 },
  { name: "봉천동", lng: 126.9415, lat: 37.4825, kind: "dong", priority: 10 },
  { name: "노량진", lng: 126.9425, lat: 37.5135, kind: "dong", priority: 6 },
  { name: "흑석동", lng: 126.9635, lat: 37.5085, kind: "dong", priority: 12 },
];

/** Large parks / universities / stadiums / palaces — z11–12 anchors. */
const LANDMARKS: readonly KoreaMajorLabel[] = [
  { name: "망원한강공원", lng: 126.90216, lat: 37.55019, kind: "landmark", priority: 8 },
  { name: "서울월드컵경기장", lng: 126.89725, lat: 37.5683, kind: "landmark", priority: 3 },
  { name: "홍익대학교", lng: 126.92544, lat: 37.55035, kind: "landmark", priority: 4 },
  { name: "서강대학교", lng: 126.94099, lat: 37.55209, kind: "landmark", priority: 6 },
  { name: "연세대학교", lng: 126.93938, lat: 37.56784, kind: "landmark", priority: 3 },
  { name: "이화여대", lng: 126.9465, lat: 37.5615, kind: "landmark", priority: 5 },
  { name: "선유도공원", lng: 126.90032, lat: 37.54342, kind: "landmark", priority: 10 },
  { name: "평화의공원", lng: 126.89429, lat: 37.56278, kind: "landmark", priority: 10 },
  { name: "양화한강공원", lng: 126.89994, lat: 37.54027, kind: "landmark", priority: 12 },
  { name: "마포구청", lng: 126.9017, lat: 37.56633, kind: "landmark", priority: 8 },
  { name: "망원시장", lng: 126.90605, lat: 37.55662, kind: "landmark", priority: 14 },
  { name: "마포농수산물시장", lng: 126.89849, lat: 37.56519, kind: "landmark", priority: 16 },
  { name: "경의선숲길", lng: 126.92265, lat: 37.56217, kind: "landmark", priority: 12 },
  { name: "국회의사당", lng: 126.917, lat: 37.532, kind: "landmark", priority: 2 },
  { name: "여의도한강공원", lng: 126.9325, lat: 37.5285, kind: "landmark", priority: 6 },
  { name: "경복궁", lng: 126.977, lat: 37.5795, kind: "landmark", priority: 2 },
  { name: "창덕궁", lng: 126.9915, lat: 37.5795, kind: "landmark", priority: 5 },
  { name: "덕수궁", lng: 126.975, lat: 37.5658, kind: "landmark", priority: 6 },
  { name: "N서울타워", lng: 126.9882, lat: 37.5512, kind: "landmark", priority: 2 },
  { name: "남산", lng: 126.988, lat: 37.5515, kind: "landmark", priority: 4 },
  { name: "서울숲", lng: 127.0375, lat: 37.5445, kind: "landmark", priority: 5 },
  { name: "한양대학교", lng: 127.0445, lat: 37.557, kind: "landmark", priority: 6 },
  { name: "건국대학교", lng: 127.0795, lat: 37.5415, kind: "landmark", priority: 6 },
  { name: "서울대학교", lng: 126.9525, lat: 37.46, kind: "landmark", priority: 3 },
  { name: "고려대학교", lng: 127.0275, lat: 37.5895, kind: "landmark", priority: 4 },
  { name: "코엑스", lng: 127.059, lat: 37.5125, kind: "landmark", priority: 4 },
  { name: "봉은사", lng: 127.0575, lat: 37.5155, kind: "landmark", priority: 8 },
  { name: "선정릉", lng: 127.049, lat: 37.509, kind: "landmark", priority: 9 },
  { name: "강남파이낸스센터", lng: 127.0272, lat: 37.4968, kind: "landmark", priority: 7 },
  { name: "교보타워", lng: 127.0288, lat: 37.5045, kind: "landmark", priority: 8 },
  { name: "삼성역", lng: 127.063, lat: 37.5085, kind: "landmark", priority: 12 },
  { name: "고속터미널", lng: 127.0055, lat: 37.5048, kind: "landmark", priority: 6 },
  { name: "국립중앙도서관", lng: 127.0035, lat: 37.4965, kind: "landmark", priority: 10 },
  { name: "양재시민의숲", lng: 127.0375, lat: 37.4705, kind: "landmark", priority: 11 },
  { name: "롯데월드타워", lng: 127.1025, lat: 37.5125, kind: "landmark", priority: 2 },
  { name: "올림픽공원", lng: 127.1225, lat: 37.5215, kind: "landmark", priority: 5 },
  { name: "잠실종합운동장", lng: 127.073, lat: 37.5155, kind: "landmark", priority: 5 },
  { name: "국립중앙박물관", lng: 126.9805, lat: 37.524, kind: "landmark", priority: 6 },
  { name: "김포공항", lng: 126.8015, lat: 37.5585, kind: "landmark", priority: 2 },
  { name: "세브란스병원", lng: 126.941, lat: 37.5625, kind: "landmark", priority: 10 },
];

/** Major peaks — OMT peak POIs are sparse / hidden with generic poi_* layers. */
const MOUNTAINS: readonly KoreaMajorLabel[] = [
  { name: "북한산", lng: 126.977, lat: 37.6585, kind: "mountain", priority: 1 },
  { name: "관악산", lng: 126.96, lat: 37.4455, kind: "mountain", priority: 2 },
  { name: "도봉산", lng: 127.0155, lat: 37.6985, kind: "mountain", priority: 3 },
  { name: "인왕산", lng: 126.96, lat: 37.5855, kind: "mountain", priority: 4 },
  { name: "안산", lng: 126.9455, lat: 37.5755, kind: "mountain", priority: 5 },
  { name: "백련산", lng: 126.9285, lat: 37.5925, kind: "mountain", priority: 6 },
  { name: "남산", lng: 126.988, lat: 37.5515, kind: "mountain", priority: 3 },
  { name: "아차산", lng: 127.1035, lat: 37.5525, kind: "mountain", priority: 7 },
  { name: "청계산", lng: 127.0435, lat: 37.4235, kind: "mountain", priority: 6 },
  { name: "우면산", lng: 127.01, lat: 37.4685, kind: "mountain", priority: 8 },
  { name: "대모산", lng: 127.0785, lat: 37.4755, kind: "mountain", priority: 8 },
  { name: "봉산", lng: 126.92, lat: 37.6055, kind: "mountain", priority: 9 },
  { name: "와우산", lng: 126.9265, lat: 37.5525, kind: "mountain", priority: 7 },
  { name: "성산", lng: 126.9085, lat: 37.5655, kind: "mountain", priority: 10 },
  { name: "구룡산", lng: 127.0585, lat: 37.4685, kind: "mountain", priority: 9 },
];

export const KOREA_MAJOR_LABELS: readonly KoreaMajorLabel[] = [
  ...DONGS,
  ...LANDMARKS,
  ...MOUNTAINS,
];

export function koreaMajorLabelsGeoJson() {
  return {
    type: "FeatureCollection" as const,
    features: KOREA_MAJOR_LABELS.map((g) => ({
      type: "Feature" as const,
      properties: {
        name: g.name,
        kind: g.kind,
        priority: g.priority ?? 50,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [g.lng, g.lat],
      },
    })),
  };
}
