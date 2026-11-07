import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAIN_ALIASES,
  KAKAO_FILL_BELOW,
  RECENT_MAX,
  chainAliasQuery,
  collapseSamePlaces,
  unionPlaceHits,
  clearRecentSearches,
  dedupeRows,
  hitToMapPoiTap,
  kakaoDocToHit,
  looksLikeRoadAddress,
  nameMatchTier,
  placeDisplayName,
  rankMergedHits,
  rankQueries,
  searchRowPoiCategory,
  type KakaoKeywordHit,
  type OurHit,
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
  assert.equal(chainAliasQuery("이디야커피 망원"), "이디야 망원");
  assert.equal(chainAliasQuery("컴포즈커피"), "컴포즈");
  assert.equal(chainAliasQuery("투썸 플레이스"), "투썸");
  assert.equal(chainAliasQuery("매머드커피 강남"), "매머드 강남");
  assert.equal(chainAliasQuery("백다방"), "빽다방");
  assert.equal(chainAliasQuery("빽다방"), null);
  assert.equal(chainAliasQuery("이디야 강남"), null);
});

test("CHAIN_ALIASES: 20+ chains, keys normalised, no self-maps", () => {
  const keys = Object.keys(CHAIN_ALIASES);
  assert.ok(keys.length >= 20);
  for (const k of keys) {
    assert.equal(k, k.toLowerCase().replace(/\s+/g, ""));
    assert.notEqual(CHAIN_ALIASES[k]!.toLowerCase().replace(/\s+/g, ""), k);
  }
});

test("rerank: 경복궁 (no 역) puts the same-name 관광/랜드마크 before the station", () => {
  const st = place({ id: "st", source: "station", name: "경복궁역", branch: null, category: "지하철역", score: 310.6, distM: 4724 });
  const t = place({ id: "t", source: "tour", name: "경복궁", branch: null, category: "관광명소", score: 309.6, distM: 4992 });
  const lm = place({ id: "lm", source: "landmark", name: "경복궁", branch: null, category: "랜드마크", score: 309.3, distM: 5185 });
  const shop = place({ id: "s", name: "경복궁", branch: "서교점", score: 319, distM: 500 });
  assert.deepEqual(rerankPlaceHits([st, t, lm, shop], "경복궁").map((h) => h.id), ["t", "st", "lm", "s"]);
  assert.deepEqual(rerankPlaceHits([st, t, lm, shop], "경복궁역").map((h) => h.id), ["st", "t", "lm", "s"]);
  assert.deepEqual(
    collapseSamePlaces(rerankPlaceHits([st, t, lm, shop], "경복궁")).map((h) => h.source),
    ["landmark", "station", "sangga"],
  );
});

test("rerank: station stays ahead when the 관광 hit is a weaker match, or names differ", () => {
  const st = place({ id: "st", source: "station", name: "한강진역", branch: null, score: 315, distM: 3000 });
  const weak = place({ id: "t", source: "tour", name: "한강진", branch: null, score: 205, distM: 3100 });
  assert.deepEqual(rerankPlaceHits([st, weak], "한강진").map((h) => h.id), ["st", "t"]);
  const other = place({ id: "o", source: "tour", name: "한강진카페거리", branch: null, score: 309, distM: 3100 });
  assert.deepEqual(rerankPlaceHits([st, other], "한강진").map((h) => h.id), ["st", "o"]);
});

test("unionPlaceHits keeps the first copy of each id", () => {
  const a = place({ id: "x", score: 300 });
  const b = place({ id: "x", score: 1 });
  const c = place({ id: "y" });
  assert.deepEqual(unionPlaceHits([a], [b, c]).map((h) => [h.id, h.score]), [["x", 300], ["y", 335]]);
});

test("collapseSamePlaces: 경복궁 관광+랜드마크 → one landmark row with the tour category", () => {
  const station = place({ id: "station:1", source: "station", name: "경복궁역", branch: null, category: "지하철역", lat: 37.5758, lng: 126.9735 });
  const tour = place({ id: "tour:1", source: "tour", name: "경복궁", branch: null, category: "관광명소", lat: 37.5760307, lng: 126.9767219, score: 309.6 });
  const lm1 = place({ id: "landmark:1", source: "landmark", name: "경복궁", branch: null, category: "랜드마크", lat: 37.5795, lng: 126.977, score: 309.3 });
  const lm2 = place({ id: "major:1", source: "landmark", name: "경복궁", branch: null, category: "랜드마크", lat: 37.5800, lng: 126.9772, score: 309.2 });
  const far = place({ id: "tour:2", source: "tour", name: "경복궁", branch: null, category: "관광명소", lat: 35.0, lng: 129.0 });
  const shopA = place({ id: "s1", name: "이디야커피", branch: null, lat: 37.55, lng: 126.92 });
  const shopB = place({ id: "s2", name: "이디야커피", branch: null, lat: 37.5501, lng: 126.9201 });
  const dongA = place({ id: "d1", source: "dong", name: "신사동", branch: null, lat: 37.52, lng: 127.02 });
  const dongB = place({ id: "d2", source: "dong", name: "신사동", branch: null, lat: 37.5201, lng: 127.0201 });
  const out = collapseSamePlaces([station, tour, lm1, lm2, far, shopA, shopB, dongA, dongB]);
  assert.deepEqual(out.map((h) => h.id), ["station:1", "landmark:1", "tour:2", "s1", "s2", "d1", "d2"]);
  assert.equal(out[1]!.category, "관광명소");
  assert.equal(out[1]!.score, 309.6);
});

const MANGWON = { lat: 37.556, lng: 126.9101 };
const kakao = (id: string, name: string, lat: number, lng: number): KakaoKeywordHit => ({
  kind: "kakao", id, name, category: "가정,생활 > 패션잡화", address: null, phone: null, placeUrl: null, lat, lng,
});

test("merge: exact Kakao-only name beats our prefix match (지구샵 vs 지구샵그로서리)", () => {
  const ours = [
    place({ id: "g1", name: "지구샵그로서리", branch: null, lat: 37.5646, lng: 126.9216, distM: 1381 }),
    place({ id: "g2", name: "지구샵네일", branch: null, lat: 36.6, lng: 127.3, distM: 111960 }),
    place({ id: "g3", name: "지구", branch: null, lat: 37.45, lng: 127.0, distM: 15413 }),
  ];
  const k = [kakao("k1", "지구샵", 37.5585, 126.9061), kakao("k2", "지구샵네일", 36.6001, 127.3001)];
  const out = rankMergedHits(ours, k, "지구샵", MANGWON);
  assert.equal(out[0]!.kind, "kakao");
  assert.equal((out[0] as KakaoKeywordHit).name, "지구샵");
  assert.equal(out.filter((h) => h.kind !== "address" && placeDisplayName(h as never) === "지구샵네일").length, 1, "same place kept once (ours)");
  assert.equal(out.find((h) => h.kind !== "address" && placeDisplayName(h as never) === "지구샵네일")!.kind, "place");
});

test("merge: same tier → our 관광 before a same-name shop, then distance; addresses lead", () => {
  const tour = place({ id: "t", source: "tour", name: "경복궁", branch: null, category: "관광명소", lat: 37.5796, lng: 126.977 });
  const shop = place({ id: "s", name: "경복궁", branch: null, lat: 37.5576, lng: 126.9182 });
  const addr: OurHit = { kind: "address", id: "juso:1", roadAddr: "서울특별시 종로구 사직로 161", jibunAddr: null, buildingName: null };
  const out = rankMergedHits([shop, tour, addr], [], "경복궁", { lat: 37.5563, lng: 126.9236 });
  assert.deepEqual(out.map((h) => h.id), ["juso:1", "t", "s"]);
});

test("merge: chain aliases share a tier, so the nearest store wins (메가커피)", () => {
  const farExact = place({ id: "far", name: "메가커피", branch: "수색자이", lat: 37.58, lng: 126.89 });
  const aliasNear = place({ id: "mid", name: "메가엠지씨커피", branch: "망원우체국 사거리점", lat: 37.5585, lng: 126.9095 });
  const k = [kakao("kk", "메가MGC커피 망원역점", 37.5562, 126.9103)];
  assert.deepEqual(rankMergedHits([farExact, aliasNear], k, "메가커피", MANGWON).map((h) => h.id), ["kk", "mid", "far"]);
  assert.equal(nameMatchTier(rankQueries("메가커피"), ["메가MGC커피 망원역점", "메가MGC커피"]), 1);
  assert.equal(nameMatchTier(rankQueries("지구샵"), ["지구샵그로서리"]), 2);
  assert.equal(nameMatchTier(rankQueries("지구샵"), ["지구"]), 3);
});

test("merge: Kakao 경복궁 ~300m from our landmark point is the same place (kept once)", () => {
  const lm = place({ id: "lm", source: "landmark", name: "경복궁", branch: null, category: "관광명소", lat: 37.5795, lng: 126.977 });
  const k = [kakao("kp", "경복궁", 37.5768, 126.9768)];
  assert.deepEqual(rankMergedHits([lm], k, "경복궁", MANGWON).map((h) => h.id), ["lm"]);
  const shop = place({ id: "s", name: "경복궁", branch: null, lat: 37.5576, lng: 126.9182 });
  const k2 = [kakao("ks", "경복궁", 37.5585, 126.9182)]; // same name, ~100m: a different shop
  assert.equal(rankMergedHits([shop], k2, "경복궁", MANGWON).length, 2);
});

test("merge: our chain store scored 300 by the RPC ranks with Kakao exact names (nearest first)", () => {
  const glued = place({ id: "near", name: "컴포즈커피홍대", branch: "서교점", score: 318, lat: 37.5571, lng: 126.9233 });
  const k = [kakao("kfar", "컴포즈커피 합정점", 37.5495, 126.9135)];
  assert.deepEqual(rankMergedHits([glued], k, "컴포즈커피", { lat: 37.5563, lng: 126.9236 }).map((h) => h.id), ["near", "kfar"]);
  const prefixOnly = place({ id: "gro", name: "지구샵그로서리", branch: null, score: 217, lat: 37.5646, lng: 126.9216 });
  assert.equal(nameMatchTier(rankQueries("지구샵"), ["지구샵그로서리"]), 2);
  assert.equal(rankMergedHits([prefixOnly], [kakao("j", "지구샵", 37.5585, 126.9061)], "지구샵", MANGWON)[0]!.id, "j");
});

test("merge: typo query (all similar) keeps 경복궁 before 경복궁역", () => {
  const st = place({ id: "st", source: "station", name: "경복궁역", branch: null, category: "지하철역", score: 88, lat: 37.5758, lng: 126.9735 });
  const lm = place({ id: "lm", source: "landmark", name: "경복궁", branch: null, category: "관광명소", score: 87, lat: 37.5795, lng: 126.977 });
  const shop = place({ id: "s", name: "경복궁", branch: "서교점", score: 80, lat: 37.5576, lng: 126.9182 });
  assert.deepEqual(rankMergedHits([st, lm, shop], [], "경복구", { lat: 37.5563, lng: 126.9236 }).map((h) => h.id), ["lm", "st", "s"]);
  assert.deepEqual(rankMergedHits([st, lm], [], "경복궁역", { lat: 37.5563, lng: 126.9236 }).map((h) => h.id), ["st", "lm"]);
});

test("merge: Kakao timeout → ours only, still tiered by name then distance", () => {
  const a = place({ id: "a", name: "이디야커피", branch: "망원점", score: 319, lat: 37.5565, lng: 126.9105 });
  const b = place({ id: "b", name: "이디야", branch: "안산점", score: 300, lat: 37.32, lng: 126.83 });
  const c = place({ id: "c", name: "이디야음악", branch: null, score: 220, lat: 37.5561, lng: 126.9102 });
  assert.deepEqual(rankMergedHits([b, c, a], [], "이디야", MANGWON).map((h) => h.id), ["a", "b", "c"]);
});

test("merge: '…역' query puts the station before a same-tier 관광 name", () => {
  const tour = place({ id: "t", source: "tour", name: "강남", branch: null, score: 300.6, lat: 37.5172, lng: 127.0473 });
  const st = place({ id: "st", source: "station", name: "강남역", branch: null, score: 300, lat: 37.4979, lng: 127.0276 });
  const origin = { lat: 37.5563, lng: 126.9236 };
  assert.deepEqual(rankMergedHits([tour, st], [], "강남역", origin).map((h) => h.id), ["st", "t"]);
  assert.deepEqual(rankMergedHits([tour, st], [], "강남", origin).map((h) => h.id), ["t", "st"]);
});

test("result pin badge: our source / 상가 class, Kakao category text", () => {
  assert.equal(searchRowPoiCategory(toSearchRow(place({ category: "cafe" }))), "cafe");
  assert.equal(searchRowPoiCategory(toSearchRow(place({ category: "doctors" }))), "hospital");
  assert.equal(searchRowPoiCategory(toSearchRow(place({ source: "station", category: "지하철역" }))), "subway");
  assert.equal(searchRowPoiCategory(toSearchRow(place({ source: "tour", category: "관광명소" }))), "landmark");
  assert.equal(searchRowPoiCategory({ id: "k", place_name: "x", category_name: "음식점 > 카페 > 커피전문점" }), "cafe");
  assert.equal(searchRowPoiCategory({ id: "k", place_name: "x", category_name: "음식점 > 술집 > 호프,요리주점" }), "bar");
  assert.equal(searchRowPoiCategory({ id: "k", place_name: "x", category_name: "가정,생활 > 패션잡화" }), "shop");
});

test("kakaoDocToHit: display-only fields, null without coordinates", () => {
  const h = kakaoDocToHit({ id: "1", place_name: "지구샵", x: "126.9", y: "37.5", place_url: "http://place.map.kakao.com/1" });
  assert.equal(h?.kind, "kakao");
  assert.equal(toSearchRow(h!)._pindHit, undefined);
  assert.equal(kakaoDocToHit({ id: "2", place_name: "x" }), null);
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
