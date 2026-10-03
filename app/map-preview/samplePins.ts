import type { FeedPostCategory } from "@/lib/feedPost";

export type MapPreviewPin = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  category: FeedPostCategory;
};

/**
 * Demo pins only — public landmarks / well-known spots around
 * Seongsu · Yeonnam · Hannam. Not user data.
 */
export const MAP_PREVIEW_PINS: MapPreviewPin[] = [
  // 성수
  { id: "s01", name: "성수연방", lng: 127.0558, lat: 37.5446, category: "카페" },
  { id: "s02", name: "어니언 성수", lng: 127.0516, lat: 37.5444, category: "카페" },
  { id: "s03", name: "대림창고", lng: 127.0549, lat: 37.5439, category: "놀거리" },
  { id: "s04", name: "성수낙낙", lng: 127.0569, lat: 37.5472, category: "쇼핑" },
  { id: "s05", name: "성수서울숲", lng: 127.0413, lat: 37.5446, category: "여행지" },
  { id: "s06", name: "수퍼마리오성수", lng: 127.0532, lat: 37.5461, category: "쇼핑" },
  { id: "s07", name: "성수시장", lng: 127.0552, lat: 37.5421, category: "맛집" },
  { id: "s08", name: "카페레이어드 성수", lng: 127.0508, lat: 37.5455, category: "카페" },
  { id: "s09", name: "성수 수제화거리", lng: 127.0564, lat: 37.5449, category: "쇼핑" },
  { id: "s10", name: "뚝섬한강공원", lng: 127.0665, lat: 37.5295, category: "여행지" },
  { id: "s11", name: "성수맥주", lng: 127.0524, lat: 37.5432, category: "술집" },
  { id: "s12", name: "성수호텔카페", lng: 127.0498, lat: 37.5468, category: "카페" },
  // 연남
  { id: "y01", name: "연남동경의선책거리", lng: 126.9255, lat: 37.5598, category: "여행지" },
  { id: "y02", name: "연남동카페거리", lng: 126.9238, lat: 37.5624, category: "카페" },
  { id: "y03", name: "연트럴파크", lng: 126.9259, lat: 37.5592, category: "여행지" },
  { id: "y04", name: "동진시장", lng: 126.9218, lat: 37.5611, category: "맛집" },
  { id: "y05", name: "연남방앗간", lng: 126.9246, lat: 37.5631, category: "카페" },
  { id: "y06", name: "연남동수제버거", lng: 126.9229, lat: 37.5642, category: "맛집" },
  { id: "y07", name: "연남살롱", lng: 126.9268, lat: 37.5618, category: "술집" },
  { id: "y08", name: "홍대입구역", lng: 126.9237, lat: 37.5572, category: "놀거리" },
  { id: "y09", name: "연남동빈티지샵", lng: 126.9241, lat: 37.5655, category: "쇼핑" },
  { id: "y10", name: "연남동게스트하우스", lng: 126.9275, lat: 37.5638, category: "숙소" },
  // 한남
  { id: "h01", name: "한남더힐인근", lng: 127.0028, lat: 37.5358, category: "여행지" },
  { id: "h02", name: "한남동카페", lng: 127.0009, lat: 37.5346, category: "카페" },
  { id: "h03", name: "한강진성당", lng: 127.0016, lat: 37.5401, category: "여행지" },
  { id: "h04", name: "이태원세계음식거리", lng: 126.9942, lat: 37.5345, category: "맛집" },
  { id: "h05", name: "한남동와인바", lng: 127.0039, lat: 37.5369, category: "술집" },
  { id: "h06", name: "한남동편집샵", lng: 127.0012, lat: 37.5338, category: "쇼핑" },
  { id: "h07", name: "남산한옥마을전망", lng: 126.9947, lat: 37.5522, category: "여행지" },
  { id: "h08", name: "한남동브런치", lng: 126.9995, lat: 37.5352, category: "카페" },
  { id: "h09", name: "한남동갤러리", lng: 127.0048, lat: 37.5341, category: "놀거리" },
  { id: "h10", name: "블루보틀 한남", lng: 127.0021, lat: 37.5375, category: "카페" },
];

export const MAP_PREVIEW_CENTER: [number, number] = [127.055, 37.544]; // 성수
export const MAP_PREVIEW_ZOOM = 14;
