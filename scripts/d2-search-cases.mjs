/**
 * D-2 search measurement cases (shared by measure-d2-search.mjs / measure-d2-tune.ts).
 * A first result is correct when its name matches and it lies within `at.r` metres
 * (address cases: the road address matches).
 */
export const CENTER = { lat: 37.5563, lng: 126.9236 };
const near = (lat, lng, r) => ({ lat, lng, r });
const HONGDAE_STN = near(37.5572, 126.9245, 800);
/** 경복궁 queries mean the palace — 경복궁역 first is wrong. */
const GYEONGBOKGUNG = /경복궁(?!역)/;

export const QUERIES = [
  { q: "스타벅스", name: /스타벅스/, at: near(CENTER.lat, CENTER.lng, 1000), type: "가게(체인)" },
  { q: "스타벅스 홍대", name: /스타벅스/, at: HONGDAE_STN, type: "체인+지역" },
  { q: "이디야 강남", name: /이디야/, at: near(37.4979, 127.0276, 1000), type: "체인+지역" },
  { q: "메가커피 성수", name: /메가/, at: near(37.5446, 127.056, 1000), type: "체인+지역" },
  { q: "투썸 플레이스", name: /투썸/, at: near(CENTER.lat, CENTER.lng, 1000), type: "가게(띄어쓰기)" },
  { q: "홍대입구역", name: /홍대입구/, at: near(37.5572, 126.9245, 400), type: "역" },
  { q: "망원역", name: /망원/, at: near(37.556, 126.9101, 400), type: "역" },
  { q: "강남역", name: /강남/, at: near(37.4979, 127.0276, 400), type: "역" },
  { q: "한강진", name: /한강진/, at: near(37.5398, 127.0017, 400), type: "역" },
  { q: "경복궁", name: GYEONGBOKGUNG, at: near(37.5796, 126.977, 600), type: "관광지" },
  { q: "남산서울타워", name: /서울타워|남산타워/, at: near(37.5512, 126.9882, 400), type: "관광지" },
  { q: "북촌한옥마을", name: /북촌/, at: near(37.5826, 126.9836, 800), type: "관광지" },
  { q: "코엑스", name: /코엑스/, at: near(37.5118, 127.0592, 600), type: "랜드마크" },
  { q: "가로수길", name: /가로수길/, at: near(37.5205, 127.023, 800), type: "관광지" },
  { q: "연남동", name: /연남/, at: near(37.566, 126.9255, 1200), type: "동" },
  { q: "마포구", name: /마포구/, at: near(37.5638, 126.9084, 3000), type: "구" },
  { q: "망원로4길 3", addr: "망원로4길 3", type: "도로명주소" },
  { q: "세종대로 175", addr: "세종대로 175", type: "도로명주소" },
  { q: "스타벅수", name: /스타벅스/, at: near(CENTER.lat, CENTER.lng, 1000), type: "오타 1글자" },
  { q: "경복구", name: GYEONGBOKGUNG, at: near(37.5796, 126.977, 600), type: "오타 1글자" },
  { q: "빽다방", name: /빽다방/, at: near(CENTER.lat, CENTER.lng, 1000), type: "체인(추가)" },
  { q: "컴포즈커피", name: /컴포즈/, at: near(CENTER.lat, CENTER.lng, 1000), type: "체인(추가)" },
  { q: "이디야커피 망원", name: /이디야/, at: near(37.556, 126.9101, 1000), type: "체인+지역(추가)" },
];

export function distM(a, b) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const squash = (s) => String(s || "").replace(/\s+/g, "");

/** top: { name, addr?, lat?, lng? } | null */
export function judge(t, top) {
  if (!top) return false;
  if (t.addr) return squash(top.addr).includes(squash(t.addr));
  if (!t.name.test(top.name || "")) return false;
  if (!Number.isFinite(top.lat) || !Number.isFinite(top.lng)) return false;
  return distM(t.at, top) <= t.at.r;
}
