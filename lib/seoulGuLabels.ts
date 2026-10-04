/**
 * Seoul 자치구 label anchors — OpenMapTiles only includes `place.class=borough`
 * (강서구 등) from z14 tiles. For city-scale (z9–13) we overlay these points.
 */
export type SeoulGuLabel = { name: string; lng: number; lat: number };

export const SEOUL_GU_LABELS: readonly SeoulGuLabel[] = [
  { name: "종로구", lng: 126.9793, lat: 37.5735 },
  { name: "중구", lng: 126.9975, lat: 37.5636 },
  { name: "용산구", lng: 126.981, lat: 37.5326 },
  { name: "성동구", lng: 127.037, lat: 37.5633 },
  { name: "광진구", lng: 127.0824, lat: 37.5385 },
  { name: "동대문구", lng: 127.0396, lat: 37.5744 },
  { name: "중랑구", lng: 127.0928, lat: 37.6063 },
  { name: "성북구", lng: 127.0167, lat: 37.5894 },
  { name: "강북구", lng: 127.0255, lat: 37.6396 },
  { name: "도봉구", lng: 127.0472, lat: 37.6688 },
  { name: "노원구", lng: 127.075, lat: 37.6542 },
  { name: "은평구", lng: 126.9291, lat: 37.6027 },
  { name: "서대문구", lng: 126.9368, lat: 37.5791 },
  { name: "마포구", lng: 126.9087, lat: 37.5663 },
  { name: "양천구", lng: 126.8664, lat: 37.517 },
  { name: "강서구", lng: 126.8495, lat: 37.5509 },
  { name: "구로구", lng: 126.8875, lat: 37.4954 },
  { name: "금천구", lng: 126.8955, lat: 37.4569 },
  { name: "영등포구", lng: 126.8962, lat: 37.5264 },
  { name: "동작구", lng: 126.9393, lat: 37.5124 },
  { name: "관악구", lng: 126.9516, lat: 37.4784 },
  { name: "서초구", lng: 127.0324, lat: 37.4837 },
  { name: "강남구", lng: 127.0474, lat: 37.5172 },
  { name: "송파구", lng: 127.105, lat: 37.5145 },
  { name: "강동구", lng: 127.1238, lat: 37.5301 },
] as const;

export function seoulGuLabelsGeoJson() {
  return {
    type: "FeatureCollection" as const,
    features: SEOUL_GU_LABELS.map((g) => ({
      type: "Feature" as const,
      properties: { name: g.name },
      geometry: {
        type: "Point" as const,
        coordinates: [g.lng, g.lat],
      },
    })),
  };
}
