import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUS_LINE_COLOUR,
  TRANSIT_NO_RESULTS_MESSAGE,
  WALK_LINE_COLOUR,
  augmentTransitRouteWithEndpointWalks,
  buildTransitDetailRows,
  extractTransitExitFromGuidance,
  formatTransitBadgeName,
  formatTransitMinutes,
  formatTransitStopLabel,
  formatTransitStepLabel,
  groupTransitVehicles,
  isValidKoreaLatLng,
  mapKakaoHttpError,
  mapTransitStatusToError,
  normalizeKakaoPathPair,
  parseKakaoPublicTraffic,
  subwayRefFromVehicleName,
  transitBoardAlightMarkers,
  transitCameraFitPadding,
  transitCameraFitPaddingFromRects,
  transitDepartureArrivalLabel,
  transitFitPoints,
  transitLineLabels,
  transitRideSummaryParts,
  transitRouteEndpoints,
  transitRouteToMapSegments,
  transitStepColour,
  transitTimelineSegments,
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

test("transitBoardAlightMarkers + endpoints from Kakao path points", () => {
  const r = parseKakaoPublicTraffic(sampleOk);
  assert.ok(r.ok);
  if (!r.ok) return;
  const route = r.routes[0]!;
  const stops = transitBoardAlightMarkers(route);
  assert.equal(stops.length, 2);
  assert.equal(stops[0]!.role, "board");
  assert.equal(stops[1]!.role, "alight");
  assert.equal(stops[0]!.lat, 37.5561);
  assert.equal(stops[1]!.lat, 37.5567);
  assert.equal(stops[0]!.colour, subwayRefColour("2"));
  const ends = transitRouteEndpoints(route);
  assert.ok(ends);
  assert.equal(ends!.start.label, "출발");
  assert.equal(ends!.end.label, "도착");
  assert.equal(ends!.start.lat, 37.556);
  assert.equal(ends!.end.lat, 37.557);
  const pad = transitCameraFitPadding(220);
  assert.equal(pad.top, 40);
  assert.equal(pad.right, 40);
  assert.equal(pad.left, 40);
  assert.equal(pad.bottom, 270); // 220 panel + 10 sheet gap + 40
  const padClamped = transitCameraFitPadding(500, 400);
  assert.equal(padClamped.top, 40);
  // Reserve ≥120px map above padding when panel would overflow the map.
  assert.ok(padClamped.bottom <= 400 - 40 - 120);
  assert.equal(padClamped.bottom, 400 - 40 - 120);
  const fromRects = transitCameraFitPaddingFromRects(
    { top: 0, bottom: 800, height: 800 },
    { top: 500 },
  );
  assert.equal(fromRects.bottom, 800 - 500 + 40); // mapBottom - panelTop + edge
  const fit = transitFitPoints(route);
  assert.ok(fit.length >= route.steps.reduce((n, s) => n + s.path.length, 0));
});

test("fare: value missing → use min", () => {
  const r = parseKakaoPublicTraffic({
    status: "OK",
    routes: [
      {
        properties: {
          type: "BUS",
          totalTime: 600,
          transfers: 0,
          fare: { min: 1550, max: 2500 },
        },
        steps: [
          {
            properties: {
              type: "BUS",
              time: 600,
              distance: 1000,
              stops: [{ name: "A" }, { name: "B" }],
              vehicles: [{ type: "간선", name: "151" }],
            },
            path: { points: [[126.91, 37.55], [126.92, 37.56]] },
          },
        ],
      },
    ],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.routes[0]!.fareWon, 1550);
});

test("formatTransitBadgeName: flatten parentheses, no hard truncate", () => {
  assert.equal(formatTransitBadgeName("N15(심야)"), "N15심야");
  assert.equal(formatTransitBadgeName("6호선"), "6호선");
  assert.equal(formatTransitBadgeName("750A"), "750A");
  assert.equal(formatTransitBadgeName(" 간선 150 "), "간선150");
});

test("extractTransitExitFromGuidance + group alts + timeline + summary", () => {
  assert.equal(
    extractTransitExitFromGuidance("정류장까지 도보로 이동 (9번 출구)"),
    "9번 출구",
  );
  assert.equal(extractTransitExitFromGuidance("출구 없음"), null);

  const vehicles = [
    { type: "간선", name: "151" },
    { type: "간선", name: "752" },
    { type: "간선", name: "150" },
    { type: "간선", name: "N15(심야)" },
  ];
  const g = groupTransitVehicles(vehicles, BUS_LINE_COLOUR, 2);
  assert.equal(g.badges.length, 2);
  assert.equal(g.extraCount, 2);
  assert.equal(g.typeLabel, "간선");
  assert.equal(formatTransitBadgeName(g.badges[1]!.name), "752");

  const route = {
    type: "BUS_AND_SUBWAY",
    totalTimeSec: 1938,
    transfers: 1,
    walkTimeSec: 268,
    fareWon: 1550,
    vehicles: [
      { type: "일반", name: "6호선" },
      { type: "간선", name: "151" },
    ],
    steps: [
      {
        type: "SUBWAY" as const,
        timeSec: 780,
        distanceM: 6500,
        guidance: "6호선 (망원 > 삼각지)",
        stops: [{ name: "망원" }, { name: "합정" }, { name: "삼각지(전쟁기념관)" }],
        vehicles: [{ type: "일반", name: "6호선" }],
        path: [
          { lat: 37.556, lng: 126.91 },
          { lat: 37.55, lng: 126.92 },
        ],
        colour: "#8B4513",
      },
      {
        type: "WALKING" as const,
        timeSec: 268,
        distanceM: 179,
        guidance: "도보 (9번 출구)",
        stops: [{ name: "삼각지(전쟁기념관)" }, { name: "삼각지역.전쟁기념관" }],
        vehicles: [],
        path: [
          { lat: 37.55, lng: 126.92 },
          { lat: 37.549, lng: 126.921 },
        ],
        colour: WALK_LINE_COLOUR,
      },
      {
        type: "BUS" as const,
        timeSec: 579,
        distanceM: 2565,
        guidance: "간선",
        stops: [{ name: "삼각지역.전쟁기념관" }, { name: "노들섬" }],
        vehicles,
        path: [
          { lat: 37.549, lng: 126.921 },
          { lat: 37.518, lng: 126.96 },
        ],
        colour: BUS_LINE_COLOUR,
      },
    ],
  };

  const bar = transitTimelineSegments(route);
  assert.equal(bar.length, 3);
  assert.equal(bar[0]!.kind, "subway");
  assert.equal(bar[1]!.kind, "walk");
  assert.equal(bar[2]!.kind, "bus");
  const ratioSum = bar.reduce((a, s) => a + s.ratio, 0);
  assert.ok(Math.abs(ratioSum - 1) < 1e-6);

  const summary = transitRideSummaryParts(route);
  assert.equal(summary[0]!.kind, "ride");
  if (summary[0]!.kind === "ride") {
    assert.equal(summary[0].badge, "6호선");
    assert.equal(summary[0].board, "망원");
  }
  const busPart = summary.find((p) => p.kind === "ride" && p.board.includes("삼각지"));
  assert.ok(busPart && busPart.kind === "ride");
  if (busPart && busPart.kind === "ride") {
    assert.match(busPart.alts ?? "", /외 2대/);
    assert.match(busPart.alts ?? "", /151/);
  }
  assert.equal(summary[summary.length - 1]!.kind, "alight");

  const times = transitDepartureArrivalLabel(1938, new Date("2026-11-25T12:00:00"));
  assert.equal(times.depart, "12:00");
  assert.equal(times.arrive, "12:32");

  const detail = buildTransitDetailRows(route, {
    originLabel: "내 위치",
    destLabel: "노들섬",
  });
  assert.equal(detail[0]!.kind, "place");
  assert.ok(detail.some((r) => r.kind === "walk" && r.exit === "9번 출구"));
  assert.ok(detail.some((r) => r.kind === "ride" && r.hopLabel.includes("역")));
  const board = detail.find((r) => r.kind === "board");
  assert.ok(board && board.kind === "board");
  if (board && board.kind === "board") {
    assert.match(board.stopLabel, /망원역 승차/);
    assert.equal(board.stopLabel.includes("6호선"), false);
    assert.match(board.bound ?? "", /합정/);
  }
  const ride = detail.find((r) => r.kind === "ride" && r.middleStops.length > 0);
  assert.ok(ride && ride.kind === "ride");
  if (ride && ride.kind === "ride") {
    assert.deepEqual(ride.middleStops, ["합정"]);
    assert.equal(ride.middleStops.includes("망원"), false);
  }
  assert.equal(detail[detail.length - 1]!.kind, "place");

  const labels = transitLineLabels(route);
  assert.equal(labels.length, 2);
  assert.match(labels[0]!.text, /6호선/);
  assert.match(labels[1]!.text, /151/);
});

test("normalizeKakaoPathPair + Korea filter + augment endpoint walks", () => {
  assert.deepEqual(normalizeKakaoPathPair(126.91, 37.556), { lat: 37.556, lng: 126.91 });
  assert.deepEqual(normalizeKakaoPathPair(37.556, 126.91), { lat: 37.556, lng: 126.91 });
  assert.equal(normalizeKakaoPathPair(0, 0), null);
  assert.equal(normalizeKakaoPathPair(NaN, 126.91), null);
  assert.equal(isValidKoreaLatLng(37.5, 127), true);
  assert.equal(isValidKoreaLatLng(0, 0), false);
  assert.equal(formatTransitStopLabel("망원", "SUBWAY"), "망원역");

  const swapped = parseKakaoPublicTraffic({
    status: "OK",
    routes: [
      {
        properties: { type: "SUBWAY", totalTime: 600, transfers: 0, fare: { value: 1400 } },
        steps: [
          {
            properties: {
              type: "SUBWAY",
              time: 600,
              distance: 1000,
              stops: [{ name: "망원" }, { name: "합정" }],
              vehicles: [{ type: "일반", name: "6호선" }],
            },
            // Intentionally swapped pairs — parser must correct
            path: { points: [[37.556, 126.91], [37.55, 126.92]] },
          },
        ],
      },
    ],
  });
  assert.equal(swapped.ok, true);
  if (!swapped.ok) return;
  const path0 = swapped.routes[0]!.steps[0]!.path[0]!;
  assert.ok(isValidKoreaLatLng(path0.lat, path0.lng));
  assert.ok(path0.lat > 33 && path0.lat < 39);
  assert.ok(path0.lng > 124);

  const withJunk = parseKakaoPublicTraffic({
    status: "OK",
    routes: [
      {
        properties: { type: "SUBWAY", totalTime: 600, transfers: 0, fare: { value: 1400 } },
        steps: [
          {
            properties: {
              type: "SUBWAY",
              time: 600,
              distance: 1000,
              stops: [{ name: "망원" }, { name: "합정" }],
              vehicles: [{ type: "일반", name: "6호선" }],
            },
            path: {
              points: [
                [126.91, 37.556],
                [0, 0],
                [126.92, 37.55],
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(withJunk.ok, true);
  if (!withJunk.ok) return;
  assert.equal(withJunk.routes[0]!.steps[0]!.path.length, 2);
  const fit = transitFitPoints(withJunk.routes[0]!);
  assert.ok(fit.every((p) => isValidKoreaLatLng(p.lat, p.lng)));
  assert.equal(fit.some((p) => p.lat === 0), false);

  const bare = withJunk.routes[0]!;
  const origin = { lat: 37.557, lng: 126.909 };
  const dest = { lat: 37.51765, lng: 126.96005 };
  const aug = augmentTransitRouteWithEndpointWalks(bare, { origin, dest });
  assert.equal(aug.steps[0]!.type, "WALKING");
  assert.equal(aug.steps[aug.steps.length - 1]!.type, "WALKING");
  assert.ok(aug.steps[0]!.distanceM > 50);
  assert.ok(transitTimelineSegments(aug).some((s) => s.kind === "walk"));
});
