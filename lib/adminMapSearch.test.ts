import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KAKAO_FILL_BELOW,
  RECENT_MAX,
  clearRecentSearches,
  dedupeRows,
  hitToMapPoiTap,
  looksLikeRoadAddress,
  mergeOursWithKakao,
  pushRecentSearch,
  readRecentSearches,
  searchEventMeta,
  toSearchRow,
  type OurPlaceHit,
} from "./adminMapSearch";

const place = (over: Partial<OurPlaceHit>): OurPlaceHit => ({
  kind: "place",
  id: "a",
  source: "sangga",
  name: "스타벅스",
  branch: "홍대역8번출구",
  category: "cafe",
  address: "서울특별시 마포구 양화로 160",
  floor: "1",
  lat: 37.5572,
  lng: 126.9245,
  distM: 70,
  score: 335,
  ...over,
});

test("looksLikeRoadAddress: 도로명 + 건물번호 only", () => {
  assert.ok(looksLikeRoadAddress("망원로4길 3"));
  assert.ok(looksLikeRoadAddress("세종대로 175"));
  assert.ok(looksLikeRoadAddress("올림픽로 300-1"));
  assert.ok(!looksLikeRoadAddress("가로수길"));
  assert.ok(!looksLikeRoadAddress("스타벅스 홍대"));
  assert.ok(!looksLikeRoadAddress("1호선"));
});

test("dedupe: same name within 50m keeps the first (ours)", () => {
  const ours = toSearchRow(place({}));
  const kakaoSame = { place_name: "스타벅스 홍대역8번출구점", y: "37.55725", x: "126.92455" };
  const kakaoFar = { place_name: "스타벅스 홍대역8번출구점", y: "37.5600", x: "126.9245" };
  const kakaoOther = { place_name: "투썸플레이스 홍대", y: "37.5572", x: "126.9245" };
  const out = dedupeRows([ours, kakaoSame, kakaoFar, kakaoOther]);
  assert.deepEqual(
    out.map((r) => r.place_name),
    ["스타벅스 홍대역8번출구", "스타벅스 홍대역8번출구점", "투썸플레이스 홍대"],
  );
});

test("merge: Kakao only fills when ours are fewer than the threshold", () => {
  const kakao = [{ place_name: "카카오 결과", y: "37.5", x: "127.0" }];
  const few = [toSearchRow(place({ id: "1" }))];
  assert.equal(mergeOursWithKakao(few, kakao).length, 2);
  const many = Array.from({ length: KAKAO_FILL_BELOW }, (_, i) =>
    toSearchRow(place({ id: String(i), name: `가게${i}`, branch: null, lat: 37.5 + i * 0.01 })),
  );
  const merged = mergeOursWithKakao(many, kakao);
  assert.equal(merged.length, KAKAO_FILL_BELOW);
  assert.ok(merged.every((r) => "_pindHit" in r));
});

test("hitToMapPoiTap: sangga keeps poi class, station keeps lines", () => {
  const s = hitToMapPoiTap(place({}));
  assert.equal(s.kind, "sangga");
  assert.equal(s.name, "스타벅스 홍대역8번출구");
  assert.equal(s.cls, "cafe");
  const st = hitToMapPoiTap(
    place({ source: "station", name: "망원역", branch: null, category: "지하철역", lines: ["6"], lineColour: "#7C4932" }),
  );
  assert.equal(st.kind, "station");
  assert.equal(st.lineRef, "6");
  const t = hitToMapPoiTap(place({ source: "tour", name: "경복궁", branch: null, category: "관광명소" }));
  assert.equal(t.kind, "tour");
  assert.equal(t.tourType, "12");
});

test("searchEventMeta never carries the query text", () => {
  const meta = searchEventMeta("  스타벅스 홍대 ", 8, "ok");
  assert.deepEqual(meta, { len: 7, n: 8, code: "ok" });
  assert.ok(!JSON.stringify(meta).includes("스타벅스"));
});

test("recent searches: newest first, unique, max 10, clear", () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  for (let i = 0; i < 12; i++) pushRecentSearch(storage, `q${i}`);
  pushRecentSearch(storage, "q5");
  const list = readRecentSearches(storage);
  assert.equal(list.length, RECENT_MAX);
  assert.equal(list[0], "q5");
  assert.equal(list.filter((s) => s === "q5").length, 1);
  clearRecentSearches(storage);
  assert.deepEqual(readRecentSearches(storage), []);
});
