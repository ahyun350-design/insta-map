/**
 * Admin MapLibre: in-app 대중교통 (Kakao publictraffic mocked — 실호출 0).
 * Screenshots 390×844 → e2e/artifacts/transit/
 * ① list  ② selected (출발·도착 in area above panel)  ③ no results
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
  TRANSIT_FIT_EDGE_PAD_PX,
  WALK_LINE_COLOUR,
  BUS_LINE_COLOUR,
  transitRouteEndpoints,
  type TransitRoute,
} from "../lib/mapTransit";

const OUT = path.join(process.cwd(), "e2e/artifacts/transit");

/** 망원역 일대 jump only — not printed in reports. */
const MANGWON = { lat: 37.556023, lng: 126.910152 };

type GlDebug = {
  createCount: number;
  findMapPoi?: (
    kinds: Array<"shop" | "sangga" | "tour" | "landmark" | "park" | "station" | "bus">,
  ) => { x: number; y: number; name: string; kind: string } | null;
  jumpToZoom?: (lat: number, lng: number, zoom: number) => void;
  project?: (lat: number, lng: number) => { x: number; y: number } | null;
};

/**
 * Mock mirrors /api/admin/map-transit parsed shape (망원=6호선 → 합정 → 2호선 홍대입구).
 * Path spans far enough that a bad camera fit would leave 출발 off-screen.
 */
const MOCK_ROUTES: { status: string; routes: TransitRoute[] } = {
  status: "OK",
  routes: [
    {
      type: "BUS_AND_SUBWAY",
      totalTimeSec: 780,
      transfers: 1,
      walkTimeSec: 240,
      fareWon: 1550,
      vehicles: [
        { type: "지하철", name: "6호선" },
        { type: "지하철", name: "2호선" },
      ],
      steps: [
        {
          type: "WALKING",
          timeSec: 90,
          distanceM: 110,
          guidance: "도보",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.55602, lng: 126.91015 },
            { lat: 37.5561, lng: 126.9104 },
            { lat: 37.5562, lng: 126.9107 },
          ],
          colour: WALK_LINE_COLOUR,
        },
        {
          type: "SUBWAY",
          timeSec: 300,
          distanceM: 1400,
          guidance: "6호선",
          stops: [{ name: "망원" }, { name: "합정" }],
          vehicles: [{ type: "지하철", name: "6호선" }],
          path: [
            { lat: 37.5562, lng: 126.9107 },
            { lat: 37.5564, lng: 126.9125 },
            { lat: 37.5566, lng: 126.9142 },
            { lat: 37.5499, lng: 126.9136 },
          ],
          colour: subwayRefColour("6"),
        },
        {
          type: "WALKING",
          timeSec: 60,
          distanceM: 80,
          guidance: "환승 도보",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.5499, lng: 126.9136 },
            { lat: 37.55, lng: 126.9139 },
            { lat: 37.5502, lng: 126.9143 },
          ],
          colour: WALK_LINE_COLOUR,
        },
        {
          type: "SUBWAY",
          timeSec: 180,
          distanceM: 900,
          guidance: "2호선",
          stops: [{ name: "합정" }, { name: "홍대입구" }],
          vehicles: [{ type: "지하철", name: "2호선" }],
          path: [
            { lat: 37.5502, lng: 126.9143 },
            { lat: 37.5525, lng: 126.918 },
            { lat: 37.555, lng: 126.9215 },
            { lat: 37.5567, lng: 126.9236 },
          ],
          colour: subwayRefColour("2"),
        },
        {
          type: "WALKING",
          timeSec: 90,
          distanceM: 100,
          guidance: "도보",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.5567, lng: 126.9236 },
            { lat: 37.5568, lng: 126.9238 },
            { lat: 37.5569, lng: 126.924 },
          ],
          colour: WALK_LINE_COLOUR,
        },
      ],
    },
    {
      type: "BUS",
      totalTimeSec: 960,
      transfers: 0,
      walkTimeSec: 180,
      fareWon: 1500,
      vehicles: [{ type: "지선", name: "7013A" }],
      steps: [
        {
          type: "WALKING",
          timeSec: 90,
          distanceM: 120,
          guidance: "도보",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.55602, lng: 126.91015 },
            { lat: 37.5563, lng: 126.9108 },
          ],
          colour: WALK_LINE_COLOUR,
        },
        {
          type: "BUS",
          timeSec: 690,
          distanceM: 2800,
          guidance: "버스",
          stops: [{ name: "망원역" }, { name: "홍대입구역" }],
          vehicles: [{ type: "지선", name: "7013A" }],
          path: [
            { lat: 37.5563, lng: 126.9108 },
            { lat: 37.5565, lng: 126.915 },
            { lat: 37.5568, lng: 126.92 },
            { lat: 37.557, lng: 126.9235 },
          ],
          colour: BUS_LINE_COLOUR,
        },
        {
          type: "WALKING",
          timeSec: 90,
          distanceM: 100,
          guidance: "도보",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.557, lng: 126.9235 },
            { lat: 37.5569, lng: 126.924 },
          ],
          colour: WALK_LINE_COLOUR,
        },
      ],
    },
  ],
};

const MOCK_ENDS = transitRouteEndpoints(MOCK_ROUTES.routes[0]!);
if (!MOCK_ENDS) throw new Error("mock route endpoints missing");

async function forceMapLibre(page: Page) {
  await page.addInitScript(({ expandedKey }) => {
    try {
      const w = window as unknown as {
        __PINDMAP_E2E_FORCE_MAPLIBRE__?: boolean;
        __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null;
      };
      w.__PINDMAP_E2E_FORCE_MAPLIBRE__ = true;
      w.__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
      window.localStorage.setItem(expandedKey, "1");
    } catch {
      /* noop */
    }
  }, { expandedKey: EXPANDED_MAPLIBRE_STORAGE_KEY });
}

async function openExpandedMapLibre(page: Page) {
  await gotoTab(page, "map");
  await expect(page.locator(".kakaoMap.mapCompactMap")).toBeVisible({ timeout: 45_000 });
  const loading = page.locator(".mapCompactLoading");
  if (await loading.isVisible().catch(() => false)) {
    await loading.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => null);
  }
  await page.waitForTimeout(1500);
  await page.locator(".mapCompactTapLayer").click({ force: true });
  const dialog = page.locator('[aria-label="전체 지도"]');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
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

async function jump(page: Page, lat: number, lng: number, zoom: number) {
  await page.evaluate(
    ({ lat, lng, zoom }) => {
      (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__?.jumpToZoom?.(
        lat,
        lng,
        zoom,
      );
    },
    { lat, lng, zoom },
  );
}

async function tapStation(
  page: Page,
  dialog: ReturnType<Page["locator"]>,
): Promise<void> {
  let hit: { x: number; y: number; name: string } | null = null;
  await expect
    .poll(
      async () => {
        hit = await page.evaluate(
          () =>
            (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__
              ?.findMapPoi?.(["station"]) ?? null,
        );
        return hit ? "found" : "none";
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe("found");
  const mapBox = await dialog.locator(".kakaoMap").first().boundingBox();
  if (!mapBox || !hit) throw new Error("map/poi missing");
  // `hit` is assigned inside poll's async callback — TS does not narrow it after await.
  const poi = hit as { x: number; y: number; name: string };
  await page.touchscreen.tap(mapBox.x + poi.x, mapBox.y + poi.y);
}

test("map transit: list → select fit → no results (mock only)", async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    geolocation: { latitude: MANGWON.lat, longitude: MANGWON.lng },
    permissions: ["geolocation"],
  });
  await suppressCoachmarks(context);
  const page = await context.newPage();
  await forceMapLibre(page);

  const token = computeMapPreviewE2eToken();
  const withE2e = (route: Parameters<Parameters<Page["route"]>[1]>[0]) =>
    route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } });
  for (const p of ["**/api/admin/map-place", "**/api/admin/map-search", "**/api/admin/map-geocode"]) {
    await page.route(p, withE2e);
  }

  let transitMode: "ok" | "empty" = "ok";
  let mockHits = 0;
  let liveHits = 0;
  await page.route("**/api/admin/map-transit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    // Never hit the real Kakao upstream in this spec.
    if (route.request().url().includes("dapi.kakao.com")) {
      liveHits += 1;
      throw new Error("live Kakao call forbidden in mock-only transit e2e");
    }
    mockHits += 1;
    if (transitMode === "empty") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "NO_RESULTS", error: "no_results", routes: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ROUTES),
    });
  });

  page.on("popup", async (p) => {
    await p.close().catch(() => null);
    throw new Error("unexpected popup — external transit must not open on MapLibre");
  });

  await ensureLoggedIn(page);
  await dismissCoachmarks(page);
  const dialog = await openExpandedMapLibre(page);
  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  const panel = page.locator('[data-testid="transit-route-panel"]');

  // ① mock list
  await jump(page, MANGWON.lat, MANGWON.lng, 16);
  await page.waitForTimeout(3500);
  await tapStation(page, dialog);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole("button", { name: /대중교통/ })).toBeVisible({ timeout: 10_000 });
  await expect(card.getByRole("button", { name: "대중교통 길찾기" })).toHaveCount(0);
  await card.getByRole("button", { name: /대중교통/ }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid="transit-route-list"]')).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('[data-testid="transit-route-item"]')).toHaveCount(2);
  await expect(panel).toContainText("6호선");
  expect(mockHits).toBe(1);
  expect(liveHits).toBe(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "01-after-route-list.png") });

  // ② select mock route — 출발·도착 both in area above panel (40px inset)
  await panel.locator('[data-testid="transit-route-item"]').first().click();
  await expect(panel.locator('[data-testid="transit-route-detail"]')).toBeVisible({ timeout: 10_000 });
  await expect(dialog.locator(".expandedMapLibreStage.is-directions-chrome")).toHaveCount(0);

  await expect
    .poll(
      async () => {
        const ok = await page.evaluate(
          ({ start, end, edge }) => {
            const gl = (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug })
              .__PINDMAP_EXPANDED_GL__;
            const mapEl = document.querySelector<HTMLElement>(
              '[aria-label="전체 지도"] .kakaoMap',
            );
            const panelEl = document.querySelector<HTMLElement>(
              '[data-testid="transit-route-panel"]',
            );
            if (!gl?.project || !mapEl || !panelEl) return "missing";
            const map = mapEl.getBoundingClientRect();
            const panelRect = panelEl.getBoundingClientRect();
            const s = gl.project(start.lat, start.lng);
            const e = gl.project(end.lat, end.lng);
            if (!s || !e) return "no_project";
            const left = map.left + edge;
            const right = map.right - edge;
            const top = map.top + edge;
            const bottom = panelRect.top - edge;
            const inArea = (p: { x: number; y: number }) => {
              const x = map.left + p.x;
              const y = map.top + p.y;
              return x >= left && x <= right && y >= top && y <= bottom;
            };
            if (!inArea(s)) return "start_out";
            if (!inArea(e)) return "end_out";
            return "ok";
          },
          {
            start: { lat: MOCK_ENDS.start.lat, lng: MOCK_ENDS.start.lng },
            end: { lat: MOCK_ENDS.end.lat, lng: MOCK_ENDS.end.lng },
            edge: TRANSIT_FIT_EDGE_PAD_PX,
          },
        );
        return ok;
      },
      { timeout: 15_000, intervals: [300] },
    )
    .toBe("ok");

  expect(liveHits).toBe(0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "02-route-selected.png") });
  await panel.getByRole("button", { name: "닫기" }).click();
  await expect(panel).toHaveCount(0);

  // ③ no-results mock
  transitMode = "empty";
  await jump(page, MANGWON.lat, MANGWON.lng, 16);
  await page.waitForTimeout(2000);
  await tapStation(page, dialog);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: /대중교통/ }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid="transit-no-results"]')).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole("button", { name: "도보" })).toBeVisible();
  expect(liveHits).toBe(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "03-no-results.png") });

  await context.close();
});
