import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_CHIPS,
  CATEGORY_FALLBACK_RADIUS_M,
  categoryEventMeta,
  categorySearchArea,
  defaultSortMode,
  hasKakaoRows,
  mergeKakaoPages,
  sortRowsByDistance,
  type KakaoPlaceDoc,
} from "./adminMapCategory";

const doc = (id: string, distance: number): KakaoPlaceDoc => ({
  id,
  place_name: id,
  x: "126.92",
  y: "37.55",
  distance: String(distance),
});

test("13 chips in order; 술집·빵디저트 use keyword search, the rest a category code", () => {
  assert.deepEqual(
    CATEGORY_CHIPS.map((c) => c.label),
    ["음식점", "카페", "술집", "빵·디저트", "편의점", "마트·시장", "약국", "병원", "은행", "주차장", "주유소", "숙박", "관광명소"],
  );
  const keyword = CATEGORY_CHIPS.filter((c) => "queries" in c.kakao).map((c) => c.id);
  assert.deepEqual(keyword, ["bar", "bakery"]);
  assert.equal(new Set(CATEGORY_CHIPS.map((c) => c.icon)).size, 13);
});

test("search area: small viewport → rect, wide viewport / none → 1km circle", () => {
  const c = { lat: 37.5563, lng: 126.9236 };
  const small = categorySearchArea(c, { sw: { lat: 37.552, lng: 126.919 }, ne: { lat: 37.5606, lng: 126.9282 } });
  assert.ok("rect" in small);
  assert.equal(small.rect, "126.919,37.552,126.9282,37.5606");
  const wide = categorySearchArea(c, { sw: { lat: 37.53, lng: 126.89 }, ne: { lat: 37.58, lng: 126.96 } });
  assert.deepEqual(wide, { radius: CATEGORY_FALLBACK_RADIUS_M });
  assert.deepEqual(categorySearchArea(c, null), { radius: CATEGORY_FALLBACK_RADIUS_M });
});

test("merge pages: dedupe by id, distance order across queries, cap", () => {
  const q1 = [doc("a", 50), doc("b", 300), doc("c", 120)];
  const q2 = [doc("b", 300), doc("d", 10)];
  assert.deepEqual(mergeKakaoPages([q1, q2], "distance").map((d) => d.id), ["d", "a", "c", "b"]);
  assert.deepEqual(mergeKakaoPages([q1, q2], "accuracy").map((d) => d.id), ["a", "b", "d", "c"]);
  const many = Array.from({ length: 40 }, (_, i) => doc(`p${i}`, 40 - i));
  assert.equal(mergeKakaoPages([many], "distance").length, 30);
});

test("default sort: name search → accuracy, chip → distance", () => {
  assert.equal(defaultSortMode("name"), "accuracy");
  assert.equal(defaultSortMode("category"), "distance");
});

test("client distance sort keeps rows without coords last", () => {
  const rows = [
    { id: "far", y: "37.60", x: "126.92" },
    { id: "none" },
    { id: "near", y: "37.5565", x: "126.9236" },
  ];
  assert.deepEqual(
    sortRowsByDistance(rows, { lat: 37.5563, lng: 126.9236 }).map((r) => r.id),
    ["near", "far", "none"],
  );
  assert.deepEqual(sortRowsByDistance(rows, null).map((r) => r.id), ["far", "none", "near"]);
});

test("Kakao credit only when a row is not ours; event meta has no query text", () => {
  assert.equal(hasKakaoRows([{ _pindHit: {} }]), false);
  assert.equal(hasKakaoRows([{ _pindHit: {} }, {}]), true);
  assert.deepEqual(categoryEventMeta("cafe", 30, "ok"), { chip: "cafe", n: 30, code: "ok" });
});
