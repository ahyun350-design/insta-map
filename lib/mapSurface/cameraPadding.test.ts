import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ZERO_PADDING,
  fitSearchResultsOn,
  resultCameraPadding,
  searchFitPadding,
  visibleSheetInset,
  type CameraPadding,
} from "./cameraPadding";

const MAP = { top: 0, bottom: 844 };

test("sheet inset: only the part of the map the sheet covers now", () => {
  assert.equal(visibleSheetInset(MAP, { top: 584, bottom: 844 }), 260);
  // Sheet lifted by the keyboard: it still covers from its top down.
  assert.equal(visibleSheetInset(MAP, { top: 300, bottom: 560 }), 544);
  // Closed / off-screen sheet → nothing.
  assert.equal(visibleSheetInset(MAP, null), 0);
  assert.equal(visibleSheetInset(MAP, { top: 900, bottom: 1160 }), 0);
  assert.equal(visibleSheetInset(null, { top: 584, bottom: 844 }), 0);
});

test("search fit padding: the visible sheet only (no card height carried over)", () => {
  assert.deepEqual(searchFitPadding(260), { top: 108, right: 28, bottom: 280, left: 28 });
  assert.deepEqual(searchFitPadding(0), { top: 108, right: 28, bottom: 28, left: 28 });
  assert.deepEqual(searchFitPadding(-5), searchFitPadding(0));
});

test("search fit: an earlier card's inset on the map is cleared before fitting", () => {
  // Fake map holding a card camera's inset; fitBounds adds the map's inset to `padding`.
  const calls: string[] = [];
  let inset: CameraPadding = { top: 96, right: 36, bottom: 420, left: 36 };
  let fittedWith: { inset: CameraPadding; padding: CameraPadding; bounds: unknown } | null = null;
  const map = {
    setPadding: (p: CameraPadding) => {
      calls.push("setPadding");
      inset = p;
    },
    fitBounds: (bounds: [[number, number], [number, number]], opts: { padding: CameraPadding }) => {
      calls.push("fitBounds");
      fittedWith = { inset: { ...inset }, padding: opts.padding, bounds };
    },
  };
  const points = [
    { lat: 37.556, lng: 126.91 },
    { lat: 37.558, lng: 126.905 },
    { lat: 37.553, lng: 126.912 },
  ];
  assert.equal(fitSearchResultsOn(map, points, searchFitPadding(260)), true);
  assert.deepEqual(calls, ["setPadding", "fitBounds"]);
  assert.deepEqual(fittedWith!.inset, ZERO_PADDING);
  assert.deepEqual(fittedWith!.padding, { top: 108, right: 28, bottom: 280, left: 28 });
  assert.deepEqual(fittedWith!.bounds, [[126.905, 37.553], [126.912, 37.558]]);
  // One point is not a fit (the caller goes to it instead); the map is left alone.
  calls.length = 0;
  assert.equal(fitSearchResultsOn(map, [points[0]!], searchFitPadding(260)), false);
  assert.deepEqual(calls, []);
});

test("single result camera: a visible sheet sets an explicit inset (replaces a card's)", () => {
  assert.deepEqual(resultCameraPadding({ paddingBottom: 280 }), { padding: { top: 96, right: 36, bottom: 280, left: 36 } });
  assert.deepEqual(resultCameraPadding({ paddingBottom: 0 }), {});
});
