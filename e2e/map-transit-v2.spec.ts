/**
 * Admin MapLibre transit v2 UI (mocked publictraffic — 실호출 0 in this spec).
 * Screenshots 390×844 → e2e/artifacts/transit-v2/
 * ① list  ② detail (+ line labels)  ③ stops expanded
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";
import { subwayRefColour } from "../lib/mapSurface/poiCategoryIcons";
import {
  BUS_LINE_COLOUR,
  TRANSIT_FIT_MIN_ZOOM,
  WALK_LINE_COLOUR,
  distanceMetersBetween,
  type TransitRoute,
} from "../lib/mapTransit";

const OUT = path.join(process.cwd(), "e2e/artifacts/transit-v2");
/** 망원역 (boarding). */
const MANGWON_STATION = { lat: 37.556083, lng: 126.910094 };
/** ~500m north of 망원역 — triggers synthesized first walk. */
const ORIGIN_FAR = { lat: 37.56055, lng: 126.91015 };
const NODEUL = { lat: 37.51765, lng: 126.96005, name: "노들섬" };
/** 삼각지(전쟁기념관) subway alight / bus board area (live Kakao ends). */
const SAMGAKJI = { lat: 37.535607, lng: 126.974054 };
const BUS_BOARD = { lat: 37.536138, lng: 126.97418 };
const NODEUL_ALIGHT = { lat: 37.517523, lng: 126.958605 };

type GlDebug = {
  createCount: number;
  findMapPoi?: (
    kinds: Array<"shop" | "sangga" | "tour" | "landmark" | "park" | "station" | "bus">,
  ) => { x: number; y: number; name: string; kind: string } | null;
  jumpToZoom?: (lat: number, lng: number, zoom: number) => void;
  getZoom?: () => number;
  project?: (lat: number, lng: number) => { x: number; y: number } | null;
  getTransitPathEnds?: () => Array<{
    kind: string;
    start: { lat: number; lng: number };
    end: { lat: number; lng: number };
  }>;
};

/** Dense-enough polyline through waypoints (not a chord). */
function polylineThrough(
  waypoints: Array<{ lat: number; lng: number }>,
  segmentsPerLeg = 4,
): Array<{ lat: number; lng: number }> {
  const out: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;
    for (let s = 0; s < segmentsPerLeg; s++) {
      const t = s / segmentsPerLeg;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
    }
  }
  out.push(waypoints[waypoints.length - 1]!);
  return out;
}

/** Live-shaped 망원→삼각지 (line 6) — sampled station corridor, not 합정-only stub. */
const SUBWAY6_PATH = polylineThrough(
  [
    MANGWON_STATION,
    { lat: 37.5494, lng: 126.9136 }, // 합정
    { lat: 37.5478, lng: 126.9224 }, // 상수
    { lat: 37.5475, lng: 126.9318 }, // 광흥창
    { lat: 37.5472, lng: 126.942 }, // 대흥
    { lat: 37.5442, lng: 126.9512 }, // 공덕
    { lat: 37.5392, lng: 126.9615 }, // 효창공원앞
    SAMGAKJI,
  ],
  5,
);

/** 삼각지 정류장 → 노들섬 bus corridor (south then bridge — not Hapjeong→Nodeul chord). */
const BUS151_PATH = polylineThrough(
  [
    BUS_BOARD,
    { lat: 37.5342, lng: 126.9728 },
    { lat: 37.5295, lng: 126.9685 },
    { lat: 37.5248, lng: 126.9642 },
    { lat: 37.5205, lng: 126.961 },
    NODEUL_ALIGHT,
  ],
  4,
);

/** Shaped like live 망원→노들섬 (Kakao omits first/last walk — client may augment). */
const MOCK_ROUTES: { status: string; routes: TransitRoute[] } = {
  status: "OK",
  routes: [
    {
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
          type: "WALKING",
          timeSec: 400,
          distanceM: Math.round(distanceMetersBetween(ORIGIN_FAR, MANGWON_STATION)),
          guidance: "망원역 1번 출구까지 도보로 이동",
          stops: [{ name: "내 위치" }, { name: "망원" }],
          vehicles: [],
          path: [ORIGIN_FAR, MANGWON_STATION],
          colour: WALK_LINE_COLOUR,
        },
        {
          type: "SUBWAY",
          timeSec: 780,
          distanceM: 6500,
          guidance: "6호선 (망원 > 삼각지(전쟁기념관))",
          stops: [
            { name: "망원" },
            { name: "합정" },
            { name: "상수" },
            { name: "광흥창" },
            { name: "대흥" },
            { name: "공덕" },
            { name: "효창공원앞" },
            { name: "삼각지(전쟁기념관)" },
          ],
          vehicles: [{ type: "일반", name: "6호선" }],
          path: SUBWAY6_PATH,
          colour: subwayRefColour("6"),
        },
        {
          type: "WALKING",
          timeSec: 268,
          distanceM: 179,
          guidance: "삼각지역.전쟁기념관정류장까지 도보로 이동 (9번 출구)",
          stops: [{ name: "삼각지(전쟁기념관)" }, { name: "삼각지역.전쟁기념관" }],
          vehicles: [],
          path: [SAMGAKJI, BUS_BOARD],
          colour: WALK_LINE_COLOUR,
        },
        {
          type: "BUS",
          timeSec: 579,
          distanceM: 2565,
          guidance: "간선 150외 13대",
          stops: [
            { name: "삼각지역.전쟁기념관" },
            { name: "용산우체국" },
            { name: "신용산역" },
            { name: "한강대교북단.LG유플러스" },
            { name: "노들섬" },
          ],
          vehicles: [
            { type: "간선", name: "151" },
            { type: "간선", name: "752" },
            { type: "간선", name: "150" },
            { type: "간선", name: "N15(심야)" },
          ],
          path: BUS151_PATH,
          colour: BUS_LINE_COLOUR,
        },
      ],
    },
    {
      type: "SUBWAY",
      totalTimeSec: 2400,
      transfers: 2,
      walkTimeSec: 400,
      fareWon: 1550,
      vehicles: [
        { type: "일반", name: "6호선" },
        { type: "일반", name: "9호선" },
      ],
      steps: [
        {
          type: "SUBWAY",
          timeSec: 900,
          distanceM: 7000,
          guidance: "6호선",
          stops: [{ name: "망원" }, { name: "공덕" }],
          vehicles: [{ type: "일반", name: "6호선" }],
          path: polylineThrough(
            [MANGWON_STATION, { lat: 37.5442, lng: 126.9512 }],
            6,
          ),
          colour: subwayRefColour("6"),
        },
        {
          type: "WALKING",
          timeSec: 200,
          distanceM: 120,
          guidance: "환승",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.5442, lng: 126.9512 },
            { lat: 37.5438, lng: 126.9512 },
          ],
          colour: WALK_LINE_COLOUR,
        },
        {
          type: "SUBWAY",
          timeSec: 1300,
          distanceM: 5000,
          guidance: "9호선",
          stops: [{ name: "노량진" }, { name: "노들" }],
          vehicles: [{ type: "일반", name: "9호선" }],
          path: polylineThrough(
            [
              { lat: 37.5438, lng: 126.9512 },
              { lat: 37.53, lng: 126.955 },
              NODEUL_ALIGHT,
            ],
            5,
          ),
          colour: subwayRefColour("9"),
        },
      ],
    },
  ],
};

async function forceMapLibre(page: Page) {
  await page.addInitScript(({ expandedKey }) => {
    const w = window as unknown as {
      __PINDMAP_E2E_FORCE_MAPLIBRE__?: boolean;
      __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null;
    };
    w.__PINDMAP_E2E_FORCE_MAPLIBRE__ = true;
    w.__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
    window.localStorage.setItem(expandedKey, "1");
  }, { expandedKey: EXPANDED_MAPLIBRE_STORAGE_KEY });
}

async function openExpanded(page: Page) {
  await gotoTab(page, "map");
  await expect(page.locator(".kakaoMap.mapCompactMap")).toBeVisible({ timeout: 45_000 });
  const loading = page.locator(".mapCompactLoading");
  if (await loading.isVisible().catch(() => false)) {
    await loading.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => null);
  }
  await page.waitForTimeout(1200);
  await page.locator(".mapCompactTapLayer").click({ force: true });
  const dialog = page.locator('[aria-label="전체 지도"]');
  await expect(dialog.locator(".is-maplibre-expanded")).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__
              ?.createCount ?? 0,
        ),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  return dialog;
}

test("transit-v2: list / detail / stops expanded", async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    geolocation: { latitude: ORIGIN_FAR.lat, longitude: ORIGIN_FAR.lng },
    permissions: ["geolocation"],
  });
  await suppressCoachmarks(context);
  const page = await context.newPage();
  await forceMapLibre(page);

  const token = computeMapPreviewE2eToken();
  await page.route("**/api/admin/map-search", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hits: [
          {
            kind: "place",
            id: "landmark:nodeul-e2e",
            source: "landmark",
            name: NODEUL.name,
            branch: null,
            category: "여행",
            address: "서울 용산구 양녕로 445",
            floor: null,
            lat: NODEUL.lat,
            lng: NODEUL.lng,
            distM: 4500,
            score: 100,
          },
        ],
        diag: { ms: 1, dbMs: 1, jusoMs: null, dbError: null, jusoError: null },
      }),
    });
  });
  await page.route("**/api/admin/map-kakao-search", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ hits: [], diag: { ms: 1, error: null } }),
    });
  });
  for (const p of ["**/api/admin/map-place", "**/api/admin/map-geocode"]) {
    await page.route(p, (route) =>
      route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } }),
    );
  }
  await page.route("**/api/admin/map-transit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ROUTES),
    });
  });
  await page.route("**/api/directions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        routes: [{ summary: { duration: 1200, distance: 9000 }, sections: [] }],
      }),
    });
  });
  await page.route("**/api/walk-directions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [ORIGIN_FAR.lng, ORIGIN_FAR.lat] },
            properties: { totalTime: 2400, totalDistance: 5200 },
          },
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [ORIGIN_FAR.lng, ORIGIN_FAR.lat],
                [NODEUL.lng, NODEUL.lat],
              ],
            },
            properties: {},
          },
        ],
      }),
    });
  });

  page.on("popup", async (p) => {
    await p.close().catch(() => null);
    throw new Error("external Kakao must not open");
  });

  await ensureLoggedIn(page);
  await dismissCoachmarks(page);
  const dialog = await openExpanded(page);

  // Setup only (not a fit assertion): land near origin before search.
  await page.evaluate(
    ({ lat, lng }) => {
      (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__?.jumpToZoom?.(
        lat,
        lng,
        15,
      );
    },
    { lat: ORIGIN_FAR.lat, lng: ORIGIN_FAR.lng },
  );
  await page.waitForTimeout(800);

  const input = dialog.getByTestId("expanded-maplibre-search-input");
  await input.click();
  await input.fill(NODEUL.name);
  await input.press("Enter");
  const sheet = dialog.locator(".mapSearchResultsSheet");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await expect(sheet.locator(".mapSearchResultsSheetItem").first()).toContainText(NODEUL.name);
  await sheet.locator(".mapSearchResultsSheetItem").first().click();

  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText(NODEUL.name);
  await card.getByRole("button", { name: /대중교통/ }).click();

  const panel = page.locator('[data-testid="transit-route-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid="transit-route-list"]')).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByTestId("transit-dest-label")).toHaveText(NODEUL.name);
  await expect(panel.getByTestId("transit-mode-walk")).toContainText("분");
  await expect(panel.getByTestId("transit-mode-walk")).not.toContainText("—");

  // List ride line: full "하차 노들섬" visible (no clip).
  const rideLine = panel.locator('[data-testid="transit-ride-line"]').first();
  await expect(rideLine).toContainText("하차 노들섬");
  const rideBox = await rideLine.boundingBox();
  const alightText = rideLine.locator(".transitRouteRideAlight");
  await expect(alightText).toBeVisible();
  const alightBox = await alightText.boundingBox();
  expect(rideBox && alightBox).toBeTruthy();
  if (rideBox && alightBox) {
    expect(alightBox.y + alightBox.height).toBeLessThanOrEqual(rideBox.y + rideBox.height + 1);
    expect(alightBox.width).toBeGreaterThan(40);
  }

  // First walk (origin ~500m): timeline + will check detail after open.
  await expect(panel.locator(".transitRouteTimelineSeg.is-walk").first()).toBeVisible();
  const walkMeters = Math.round(distanceMetersBetween(ORIGIN_FAR, MANGWON_STATION));
  expect(walkMeters).toBeGreaterThan(400);
  expect(walkMeters).toBeLessThan(700);

  // Assert only — never move the camera. Start/end below search bar & above panel.
  // Soft zoom floor (country-scale guard); padding-correct fit may sit slightly under 12.
  await expect
    .poll(
      async () => {
        return page.evaluate(
          ({ start, end, edge, softMinZoom }) => {
            const gl = (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug })
              .__PINDMAP_EXPANDED_GL__;
            const mapEl = document.querySelector<HTMLElement>(
              '[aria-label="전체 지도"] .kakaoMap',
            );
            const panelEl = document.querySelector<HTMLElement>(
              '[data-testid="transit-route-panel"]',
            );
            const searchEl =
              document.querySelector<HTMLElement>(".expandedMapLibreSearchPill") ||
              document.querySelector<HTMLElement>('[data-testid="expanded-maplibre-search-input"]');
            if (!gl?.project || !gl.getZoom || !mapEl || !panelEl) return "missing";
            const z = gl.getZoom();
            if (z < softMinZoom) return `zoom_${z.toFixed(2)}`;
            const map = mapEl.getBoundingClientRect();
            const panelRect = panelEl.getBoundingClientRect();
            // Match app: search clearance uses +8px (see transitCameraFitPaddingFromRects).
            const searchBottom = searchEl
              ? searchEl.getBoundingClientRect().bottom - map.top + 8
              : edge;
            const s = gl.project(start.lat, start.lng);
            const e = gl.project(end.lat, end.lng);
            if (!s || !e) return "no_project";
            // Horizontal: allow near edges (origin sits on west of bounds). Vertical: search→panel.
            const left = 0;
            const right = map.width;
            const top = Math.max(edge, searchBottom);
            const bottom = panelRect.top - map.top - edge;
            const inArea = (p: { x: number; y: number }) =>
              p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
            if (!inArea(s)) return `start_out_${s.x.toFixed(0)}_${s.y.toFixed(0)}_t${top.toFixed(0)}`;
            if (!inArea(e)) return `end_out_${e.x.toFixed(0)}_${e.y.toFixed(0)}_b${bottom.toFixed(0)}`;
            return "ok";
          },
          {
            start: { lat: ORIGIN_FAR.lat, lng: ORIGIN_FAR.lng },
            end: { lat: NODEUL.lat, lng: NODEUL.lng },
            edge: 24,
            softMinZoom: Math.max(10, TRANSIT_FIT_MIN_ZOOM - 2),
          },
        );
      },
      { timeout: 15_000, intervals: [400] },
    )
    .toBe("ok");

  // Each ride segment start/end within 50m of board/alight (path not stubbed at 합정).
  await expect
    .poll(async () => {
      return page.evaluate(
        ({ subwayEnd, busStart, busEnd, maxM }) => {
          const gl = (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug })
            .__PINDMAP_EXPANDED_GL__;
          const ends = gl?.getTransitPathEnds?.() ?? [];
          const subway = ends.find((x) => x.kind === "subway");
          const bus = ends.find((x) => x.kind === "bus");
          if (!subway || !bus) return `missing_${ends.map((x) => x.kind).join(",")}`;
          const haversine = (
            a: { lat: number; lng: number },
            b: { lat: number; lng: number },
          ) => {
            const R = 6371000;
            const toRad = (d: number) => (d * Math.PI) / 180;
            const dLat = toRad(b.lat - a.lat);
            const dLng = toRad(b.lng - a.lng);
            const s =
              Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
          };
          const dSubEnd = haversine(subway.end, subwayEnd);
          const dBusStart = haversine(bus.start, busStart);
          const dBusEnd = haversine(bus.end, busEnd);
          if (dSubEnd > maxM) return `subway_end_${dSubEnd.toFixed(0)}`;
          if (dBusStart > maxM) return `bus_start_${dBusStart.toFixed(0)}`;
          if (dBusEnd > maxM) return `bus_end_${dBusEnd.toFixed(0)}`;
          // Bus must not start near 합정 (~37.549).
          if (bus.start.lat > 37.545) return `bus_too_north_${bus.start.lat.toFixed(4)}`;
          return "ok";
        },
        {
          subwayEnd: SAMGAKJI,
          busStart: BUS_BOARD,
          busEnd: NODEUL_ALIGHT,
          maxM: 50,
        },
      );
    })
    .toBe("ok");

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "01-list.png") });

  await panel.getByTestId("transit-route-item").first().click();
  await expect(panel.getByTestId("transit-route-detail")).toBeVisible({ timeout: 10_000 });
  await expect(panel).toHaveAttribute("data-detail", "1");
  await expect(panel.getByTestId("transit-detail-steps")).toContainText("망원역 승차");
  await expect(panel.getByTestId("transit-detail-steps")).toContainText("합정 방면");
  await expect(panel.getByTestId("transit-detail-steps")).toContainText("9번 출구");
  await expect(panel.getByTestId("transit-detail-steps")).not.toContainText("전쟁기념관역");
  await expect(panel.getByTestId("transit-step-clock").first()).toBeVisible();

  // Clocks only on emphasis rows (place/board/alight) — not on ride/walk muted rows.
  const clockCount = await panel.getByTestId("transit-step-clock").count();
  const emphasisCount = await panel.locator(".transitRouteStep.is-emphasis").count();
  expect(clockCount).toBe(emphasisCount);

  // First walk: 내 위치 → 망원역 N번 출구까지 도보 Nm·N분
  const walkStep = panel.getByTestId("transit-walk-step").first();
  await expect(walkStep).toContainText("내 위치 →");
  await expect(walkStep).toContainText("망원역");
  await expect(walkStep).toContainText("1번 출구");
  await expect(walkStep).toContainText("도보");
  await expect(walkStep).toContainText("m·");
  await expect(walkStep).toContainText("분");
  // Timeline bar lives on the list card (already asserted above); detail shows walk step text.

  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "02-detail.png") });

  await panel.getByTestId("transit-stops-toggle").first().click();
  await expect(panel.getByTestId("transit-stop-list")).toBeVisible();
  await expect(panel.getByTestId("transit-stop-list")).toContainText("합정");
  await expect(panel.getByTestId("transit-stop-list")).not.toContainText("망원");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "03-stops-expanded.png") });

  await context.close();
});
