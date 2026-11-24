import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUS_LINE_COLOUR,
  TRANSIT_NO_RESULTS_MESSAGE,
  WALK_LINE_COLOUR,
  formatTransitMinutes,
  formatTransitStepLabel,
  mapKakaoHttpError,
  mapTransitStatusToError,
  parseKakaoPublicTraffic,
  subwayRefFromVehicleName,
  transitRouteToMapSegments,
  transitStepColour,
} from "./mapTransit";
import { subwayRefColour } from "./mapSurface/poiCategoryIcons";

const sampleOk = {
  status: "OK",
  properties: { total: 2 },
  routes: [
    {
      properties: {
        type: "SUBWAY",
        totalDistance: 2000,
        totalTime: 749,
        transfers: 0,
        fare: { value: 1400 },
      },
      steps: [
        {
          properties: {
            type: "WALKING",
            time: 120,
            distance: 150,
            guidance: "walk",
            stops: [],
            vehicles: [],
          },
          path: { points: [[126.91, 37.556], [126.911, 37.5561]] },
        },
        {
          properties: {
            type: "SUBWAY",
            time: 480,
            distance: 1700,
            guidance: "subway",
            stops: [{ name: "망원" }, { name: "합정" }, { name: "홍대입구" }],
            vehicles: [{ type: "지하철", name: "2호선" }],
          },
          path: {
            points: [
              [126.911, 37.5561],
              [126.914, 37.5565],
              [126.923, 37.5567],
            ],
          },
        },
        {
          properties: {
            type: "WALKING",
            time: 149,
            distance: 150,
            guidance: "walk2",
            stops: [],
            vehicles: [],
          },
          path: { points: [[126.923, 37.5567], [126.924, 37.557]] },
        },
      ],
    },
    {
      properties: {
        type: "BUS",
        totalTime: 900,
        transfers: 0,
        fare: { value: 1500 },
      },
      steps: [
        {
          properties: {
            type: "BUS",
            time: 600,
            distance: 3000,
            stops: [{ name: "A" }, { name: "B" }],
            vehicles: [{ type: "마을", name: "마포09" }],
          },
          path: { points: [[126.91, 37.55], [126.92, 37.56]] },
        },
      ],
    },
  ],
};

test("parseKakaoPublicTraffic: OK routes capped + walk/fare/transfers", () => {
  const r = parseKakaoPublicTraffic(sampleOk);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.routes.length, 2);
  assert.equal(r.routes[0]!.totalTimeSec, 749);
  assert.equal(r.routes[0]!.transfers, 0);
  assert.equal(r.routes[0]!.walkTimeSec, 120 + 149);
  assert.equal(r.routes[0]!.fareWon, 1400);
  assert.equal(r.routes[0]!.steps.length, 3);
  assert.equal(r.routes[0]!.steps[1]!.type, "SUBWAY");
  assert.equal(r.routes[0]!.steps[1]!.path.length, 3);
  assert.equal(r.routes[0]!.vehicles[0]!.name, "2호선");
});

test("parseKakaoPublicTraffic: NO_RESULTS / EQUAL_POINTS → error codes", () => {
  const a = parseKakaoPublicTraffic({ status: "NO_RESULTS", routes: [] });
  assert.equal(a.ok, false);
  if (a.ok) return;
  assert.equal(a.error, "no_results");
  assert.equal(a.status, "NO_RESULTS");

  const b = parseKakaoPublicTraffic({ status: "EQUAL_POINTS" });
  assert.equal(b.ok, false);
  if (b.ok) return;
  assert.equal(b.error, "too_close");
  assert.equal(mapTransitStatusToError("EQUAL_POINTS"), "too_close");
  assert.equal(mapTransitStatusToError("NO_RESULTS"), "no_results");
});

test("mapKakaoHttpError: status → code (no raw body)", () => {
  assert.equal(mapKakaoHttpError(401), "http_401");
  assert.equal(mapKakaoHttpError(403), "http_403");
  assert.equal(mapKakaoHttpError(429), "http_429");
  assert.equal(mapKakaoHttpError(500), "http_other");
});

test("subwayRefFromVehicleName + transitStepColour reuse subway badge colours", () => {
  assert.equal(subwayRefFromVehicleName("2호선"), "2");
  assert.equal(subwayRefFromVehicleName("지하철 6호선"), "6");
  assert.equal(subwayRefFromVehicleName("신분당선"), "신분당");
  assert.equal(transitStepColour("WALKING", []), WALK_LINE_COLOUR);
  assert.equal(transitStepColour("BUS", [{ type: "마을", name: "76" }]), BUS_LINE_COLOUR);
  assert.equal(
    transitStepColour("SUBWAY", [{ type: "지하철", name: "2호선" }]),
    subwayRefColour("2"),
  );
});

test("formatTransitStepLabel + map segments", () => {
  assert.equal(formatTransitMinutes(749), 12);
  const r = parseKakaoPublicTraffic(sampleOk);
  assert.ok(r.ok);
  if (!r.ok) return;
  const subway = r.routes[0]!.steps[1]!;
  assert.equal(formatTransitStepLabel(r.routes[0]!.steps[0]!), "도보 2분");
  assert.match(formatTransitStepLabel(subway), /2호선/);
  assert.match(formatTransitStepLabel(subway), /망원 승차/);
  assert.match(formatTransitStepLabel(subway), /2정거장/);
  assert.match(formatTransitStepLabel(subway), /홍대입구 하차/);
  const segs = transitRouteToMapSegments(r.routes[0]!);
  assert.equal(segs.length, 3);
  assert.equal(segs[0]!.kind, "walk");
  assert.equal(segs[1]!.kind, "subway");
  assert.equal(segs[1]!.colour, subwayRefColour("2"));
  assert.ok(TRANSIT_NO_RESULTS_MESSAGE.includes("도보"));
});
