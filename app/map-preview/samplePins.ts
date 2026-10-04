import type { FeedPostCategory } from "@/lib/feedPost";
import { FEED_POST_CATEGORIES } from "@/lib/feedPost";

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
  { id: "s01", name: "성수연방", lng: 127.0558, lat: 37.5446, category: "카페" },
  { id: "s02", name: "어니언 성수", lng: 127.0516, lat: 37.5444, category: "카페" },
  { id: "s03", name: "대림창고", lng: 127.0549, lat: 37.5439, category: "놀거리" },
  { id: "s04", name: "성수낙낙", lng: 127.0569, lat: 37.5472, category: "쇼핑" },
  { id: "s05", name: "성수서울숲", lng: 127.0413, lat: 37.5446, category: "여행지" },
  { id: "y01", name: "연남동경의선책거리", lng: 126.9255, lat: 37.5598, category: "여행지" },
  { id: "y02", name: "연남동카페거리", lng: 126.9238, lat: 37.5624, category: "카페" },
  { id: "h01", name: "한남더힐인근", lng: 127.0028, lat: 37.5358, category: "여행지" },
  { id: "h02", name: "한남동카페", lng: 127.0009, lat: 37.5346, category: "카페" },
  { id: "h10", name: "블루보틀 한남", lng: 127.0021, lat: 37.5375, category: "카페" },
];

export const MAP_PREVIEW_CENTER: [number, number] = [127.055, 37.544];
export const MAP_PREVIEW_ZOOM = 14;

/** City hubs for national synthetic load tests (not real places / not user data). */
const DEMO_CITY_BOXES: ReadonlyArray<{
  name: string;
  lngMin: number;
  lngMax: number;
  latMin: number;
  latMax: number;
  weight: number;
}> = [
  { name: "서울", lngMin: 126.82, lngMax: 127.18, latMin: 37.45, latMax: 37.7, weight: 28 },
  { name: "인천", lngMin: 126.6, lngMax: 126.8, latMin: 37.38, latMax: 37.55, weight: 8 },
  { name: "수원", lngMin: 126.95, lngMax: 127.1, latMin: 37.22, latMax: 37.35, weight: 6 },
  { name: "대전", lngMin: 127.3, lngMax: 127.5, latMin: 36.28, latMax: 36.42, weight: 10 },
  { name: "대구", lngMin: 128.5, lngMax: 128.7, latMin: 35.8, latMax: 35.95, weight: 12 },
  { name: "부산", lngMin: 128.95, lngMax: 129.15, latMin: 35.1, latMax: 35.25, weight: 14 },
  { name: "울산", lngMin: 129.25, lngMax: 129.4, latMin: 35.5, latMax: 35.6, weight: 5 },
  { name: "광주", lngMin: 126.8, lngMax: 126.95, latMin: 35.1, latMax: 35.22, weight: 9 },
  { name: "제주", lngMin: 126.45, lngMax: 126.65, latMin: 33.35, latMax: 33.52, weight: 8 },
];

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickCity(rnd: () => number) {
  const total = DEMO_CITY_BOXES.reduce((a, c) => a + c.weight, 0);
  let r = rnd() * total;
  for (const c of DEMO_CITY_BOXES) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return DEMO_CITY_BOXES[0]!;
}

/**
 * Deterministic synthetic pins across major Korean cities for MapLibre perf tests.
 * Never user / DB data.
 */
export function generateKoreaDemoPins(count: number): MapPreviewPin[] {
  const n = Math.max(0, Math.min(5000, Math.floor(count)));
  const rnd = mulberry32(20261004);
  const cats = FEED_POST_CATEGORIES;
  const out: MapPreviewPin[] = [];
  for (let i = 0; i < n; i++) {
    const city = pickCity(rnd);
    const lng = city.lngMin + rnd() * (city.lngMax - city.lngMin);
    const lat = city.latMin + rnd() * (city.latMax - city.latMin);
    const category = cats[Math.floor(rnd() * cats.length)]!;
    out.push({
      id: `demo-${i}`,
      name: `${city.name} 데모 ${i + 1}`,
      lng: Math.round(lng * 1e6) / 1e6,
      lat: Math.round(lat * 1e6) / 1e6,
      category,
    });
  }
  return out;
}

/** @deprecated alias — use generateKoreaDemoPins */
export const generateSeoulDemoPins = generateKoreaDemoPins;
