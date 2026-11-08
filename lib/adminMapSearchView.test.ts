import { test } from "node:test";
import assert from "node:assert/strict";
import { planSearchCamera, shouldShowResearch } from "./adminMapSearchView";

const MANGWON = { lat: 37.556, lng: 126.9101 };
const near = (dLat: number) => ({ lat: MANGWON.lat + dLat, lng: MANGWON.lng });
const MYEONGDONG = { lat: 37.5636, lng: 126.9827 };

test("camera: results near the search point → fit the nearest ≤10, never fly to a far #1", () => {
  const ranked = [MYEONGDONG, near(0.002), near(-0.004), ...Array.from({ length: 12 }, (_, i) => near(0.0001 * (i + 1)))];
  const plan = planSearchCamera(ranked, MANGWON);
  assert.equal(plan.kind, "fit");
  if (plan.kind !== "fit") return;
  assert.equal(plan.points.length, 10);
  assert.ok(!plan.points.includes(MYEONGDONG));
});

test("camera: nothing near the search point → go to #1; no results → none", () => {
  assert.deepEqual(planSearchCamera([MYEONGDONG, { lat: 35.1, lng: 129.0 }], MANGWON), { kind: "goto", point: MYEONGDONG });
  assert.deepEqual(planSearchCamera([], MANGWON), { kind: "none" });
});

test("재검색: hidden without results; shown after ≥300m move or ≥1 level zoom", () => {
  const searchView = { center: MANGWON, level: 4 };
  assert.equal(shouldShowResearch({ hasResults: false, searchView, now: { center: near(0.01), level: 4 } }), false);
  assert.equal(shouldShowResearch({ hasResults: true, searchView: null, now: searchView }), false);
  assert.equal(shouldShowResearch({ hasResults: true, searchView, now: { center: near(0.0025), level: 4 } }), false); // ~280m
  assert.equal(shouldShowResearch({ hasResults: true, searchView, now: { center: near(0.0028), level: 4 } }), true); // ~311m
  assert.equal(shouldShowResearch({ hasResults: true, searchView, now: { center: MANGWON, level: 5 } }), true);
  assert.equal(shouldShowResearch({ hasResults: true, searchView, now: { center: MANGWON, level: 3 } }), true);
  assert.equal(shouldShowResearch({ hasResults: true, searchView, now: searchView }), false);
});
