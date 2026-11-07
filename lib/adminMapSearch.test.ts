import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KAKAO_FILL_BELOW,
  RECENT_MAX,
  chainAliasQuery,
  collapseSamePlaces,
  unionPlaceHits,
  clearRecentSearches,
  dedupeRows,
  hitToMapPoiTap,
  looksLikeRoadAddress,
  mergeOursWithKakao,
  pushRecentSearch,
  readRecentSearches,
  rerankPlaceHits,
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

test("rerank: famous place beats a same-name shop, …역 prefers the station", () => {
  const shop = place({ id: "s", name: "경복궁", branch: "서교점", score: 319, distM: 500 });
  const tour = place({ id: "t", source: "tour", name: "경복궁", branch: null, score: 309.6, distM: 5177 });
  assert.deepEqual(rerankPlaceHits([shop, tour], "경복궁").map((h) => h.id), ["t", "s"]);
  const tourGangnam = place({ id: "tg", source: "tour", name: "강남", branch: null, score: 300.6, distM: 9700 });
  const station = place({ id: "st", source: "station", name: "강남역", branch: null, score: 300, distM: 11314 });
  assert.deepEqual(rerankPlaceHits([tourGangnam, station], "강남역").map((h) => h.id), ["st", "tg"]);
  assert.deepEqual(rerankPlaceHits([tourGangnam, station], "강남").map((h) => h.id), ["tg", "st"]);
});

test("chainAliasQuery: first word (or two) → registered 상호, rest kept", () => {
  assert.equal(chainAliasQuery("메가커피 성수"), "메가엠지씨커피 성수");
  assert.equal(chainAliasQuery("메가 커피"), "메가엠지씨커피");
  assert.equal(chainAliasQuery("KFC 강남"), "케이에프씨 강남");
  assert.equal(chainAliasQuery("gs25"), "지에스25");
  assert.equal(chainAliasQuery("스타벅스 홍대"), null);
  assert.equal(chainAliasQuery("이디야커피 망원"), null);
});

test("unionPlaceHits keeps the first copy of each id", () => {
  const a = place({ id: "x", score: 300 });
  const b = place({ id: "x", score: 1 });
  const c = place({ id: "y" });
  assert.deepEqual(unionPlaceHits([a], [b, c]).map((h) => [h.id, h.score]), [["x", 300], ["y", 335]]);
});

test("collapseSamePlaces: 경복궁 관광+랜드마크 → one landmark row with the tour category", () => {
  const station = place({ id: "station:1", source: "station", name: "경복궁역", branch: null, category: "지하철역", lat: 37.5758, lng: 126.9735 });
  const tour = place({ id: "tour:1", source: "tour", name: "경복궁", branch: null, category: "관광명소", lat: 37.5796, lng: 126.977, score: 309.6 });
  const lm1 = place({ id: "landmark:1", source: "landmark", name: "경복궁", branch: null, category: "랜드마크", lat: 37.5797, lng: 126.9769, score: 309.3 });
  const lm2 = place({ id: "major:1", source: "landmark", name: "경복궁", branch: null, category: "랜드마크", lat: 37.5800, lng: 126.9772, score: 309.2 });
  const far = place({ id: "tour:2", source: "tour", name: "경복궁", branch: null, category: "관광명소", lat: 35.0, lng: 129.0 });
  const shopA = place({ id: "s1", name: "이디야커피", branch: null, lat: 37.55, lng: 126.92 });
  const shopB = place({ id: "s2", name: "이디야커피", branch: null, lat: 37.5501, lng: 126.9201 });
  const out = collapseSamePlaces([station, tour, lm1, lm2, far, shopA, shopB]);
  assert.deepEqual(out.map((h) => h.id), ["station:1", "landmark:1", "tour:2", "s1", "s2"]);
  assert.equal(out[1]!.category, "관광명소");
  assert.equal(out[1]!.score, 309.6);
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
