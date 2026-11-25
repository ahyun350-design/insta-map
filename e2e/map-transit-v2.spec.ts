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
import { BUS_LINE_COLOUR, WALK_LINE_COLOUR, type TransitRoute } from "../lib/mapTransit";

const OUT = path.join(process.cwd(), "e2e/artifacts/transit-v2");
const MANGWON = { lat: 37.556023, lng: 126.910152 };

type GlDebug = {
  createCount: number;
  findMapPoi?: (
    kinds: Array<"shop" | "sangga" | "tour" | "landmark" | "park" | "station" | "bus">,
  ) => { x: number; y: number; name: string; kind: string } | null;
  jumpToZoom?: (lat: number, lng: number, zoom: number) => void;
};

/** Shaped like live 망원→노들섬 probe (no live Kakao in e2e). */
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
          path: [
            { lat: 37.556, lng: 126.91 },
            { lat: 37.553, lng: 126.913 },
            { lat: 37.55, lng: 126.918 },
            { lat: 37.5499, lng: 126.9205 },
          ],
          colour: subwayRefColour("6"),
        },
        {
          type: "WALKING",
          timeSec: 268,
          distanceM: 179,
          guidance: "삼각지역.전쟁기념관정류장까지 도보로 이동 (9번 출구)",
          stops: [{ name: "삼각지(전쟁기념관)" }, { name: "삼각지역.전쟁기념관" }],
          vehicles: [],
          path: [
            { lat: 37.5499, lng: 126.9205 },
            { lat: 37.5495, lng: 126.921 },
          ],
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
          path: [
            { lat: 37.5495, lng: 126.921 },
            { lat: 37.535, lng: 126.94 },
            { lat: 37.518, lng: 126.96 },
          ],
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
          path: [
            { lat: 37.556, lng: 126.91 },
            { lat: 37.544, lng: 126.951 },
          ],
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
            { lat: 37.544, lng: 126.951 },
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
          path: [
            { lat: 37.5438, lng: 126.9512 },
            { lat: 37.518, lng: 126.96 },
          ],
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

async function tapStation(page: Page, dialog: ReturnType<Page["locator"]>) {
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
  const poi = hit as { x: number; y: number; name: string };
  await page.touchscreen.tap(mapBox.x + poi.x, mapBox.y + poi.y);
}

test("transit-v2: list / detail / stops expanded", async ({ browser }) => {
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
  for (const p of ["**/api/admin/map-place", "**/api/admin/map-search", "**/api/admin/map-geocode"]) {
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
        features: [
          {
            properties: { totalTime: 2400, totalDistance: 3000 },
            geometry: {
              type: "LineString",
              coordinates: [
                [126.91, 37.556],
                [126.96, 37.518],
              ],
            },
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

  await page.evaluate(
    ({ lat, lng }) => {
      (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__?.jumpToZoom?.(
        lat,
        lng,
        16,
      );
    },
    { lat: MANGWON.lat, lng: MANGWON.lng },
  );
  await page.waitForTimeout(3000);
  await tapStation(page, dialog);

  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: /대중교통/ }).click();

  const panel = page.locator('[data-testid="transit-route-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid="transit-route-list"]')).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByTestId("transit-top-chrome")).toBeVisible();
  await expect(panel.getByTestId("transit-route-item")).toHaveCount(2);
  await expect(panel.locator('[data-testid="transit-ride-line"]').first()).toContainText("노들섬");
  await expect(panel.locator(".transitRouteTimeline").first()).toBeVisible();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, "01-list.png") });

  await panel.getByTestId("transit-route-item").first().click();
  await expect(panel.getByTestId("transit-route-detail")).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByTestId("transit-detail-steps")).toBeVisible();
  await expect(panel.getByTestId("transit-detail-steps")).toContainText("9번 출구");
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, "02-detail.png") });

  await panel.getByTestId("transit-stops-toggle").first().click();
  await expect(panel.getByTestId("transit-stop-list")).toBeVisible();
  await expect(panel.getByTestId("transit-stop-list")).toContainText("합정");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "03-stops-expanded.png") });

  await context.close();
});
