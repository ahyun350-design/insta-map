/**
 * Admin MapLibre: in-app 대중교통 (Kakao publictraffic mocked).
 * Screenshots 390×844 → e2e/artifacts/transit/
 * ① after tap → route list  ② selected → map+steps  ③ no results
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";
import { subwayRefColour } from "../lib/mapSurface/poiCategoryIcons";

const OUT = path.join(process.cwd(), "e2e/artifacts/transit");

type GlDebug = {
  createCount: number;
  findMapPoi?: (
    kinds: Array<"shop" | "sangga" | "tour" | "landmark" | "park" | "station" | "bus">,
  ) => { x: number; y: number; name: string; kind: string } | null;
  jumpToZoom?: (lat: number, lng: number, zoom: number) => void;
};

const MOCK_ROUTES = {
  status: "OK",
  routes: [
    {
      type: "SUBWAY",
      totalTimeSec: 749,
      transfers: 0,
      walkTimeSec: 269,
      fareWon: 1400,
      vehicles: [{ type: "지하철", name: "2호선" }],
      steps: [
        {
          type: "WALKING",
          timeSec: 120,
          distanceM: 150,
          guidance: "",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.556, lng: 126.91 },
            { lat: 37.5561, lng: 126.911 },
          ],
          colour: "#8A939C",
        },
        {
          type: "SUBWAY",
          timeSec: 480,
          distanceM: 1700,
          guidance: "",
          stops: [{ name: "망원" }, { name: "합정" }, { name: "홍대입구" }],
          vehicles: [{ type: "지하철", name: "2호선" }],
          path: [
            { lat: 37.5561, lng: 126.911 },
            { lat: 37.5565, lng: 126.914 },
            { lat: 37.5567, lng: 126.923 },
          ],
          colour: subwayRefColour("2"),
        },
        {
          type: "WALKING",
          timeSec: 149,
          distanceM: 150,
          guidance: "",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.5567, lng: 126.923 },
            { lat: 37.557, lng: 126.924 },
          ],
          colour: "#8A939C",
        },
      ],
    },
    {
      type: "BUS",
      totalTimeSec: 900,
      transfers: 0,
      walkTimeSec: 60,
      fareWon: 1500,
      vehicles: [{ type: "마을", name: "마포09" }],
      steps: [
        {
          type: "BUS",
          timeSec: 840,
          distanceM: 2500,
          guidance: "",
          stops: [{ name: "정류A" }, { name: "정류B" }],
          vehicles: [{ type: "마을", name: "마포09" }],
          path: [
            { lat: 37.556, lng: 126.91 },
            { lat: 37.557, lng: 126.92 },
          ],
          colour: "#1E88E5",
        },
      ],
    },
  ],
};

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

test("map transit: list → select → no results (mocked)", async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    geolocation: { latitude: 37.556023, longitude: 126.910152 },
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
  let transitHits = 0;
  await page.route("**/api/admin/map-transit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    transitHits += 1;
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

  // Block accidental external Kakao map navigation
  page.on("popup", async (p) => {
    await p.close().catch(() => null);
    throw new Error("unexpected popup — external transit must not open on MapLibre");
  });

  await ensureLoggedIn(page);
  await dismissCoachmarks(page);
  const dialog = await openExpandedMapLibre(page);

  // 망원역 일대
  await page.evaluate(() => {
    (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__?.jumpToZoom?.(
      37.556023,
      126.910152,
      16,
    );
  });
  await page.waitForTimeout(3500);

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
  await page.touchscreen.tap(mapBox.x + hit.x, mapBox.y + hit.y);

  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole("button", { name: /대중교통/ })).toBeVisible({ timeout: 10_000 });
  await expect(card.getByRole("button", { name: "대중교통 길찾기" })).toHaveCount(0);

  await card.getByRole("button", { name: /대중교통/ }).click();
  const panel = page.locator('[data-testid="transit-route-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid="transit-route-list"]')).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('[data-testid="transit-route-item"]')).toHaveCount(2);
  expect(transitHits).toBe(1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "01-after-route-list.png") });

  await panel.locator('[data-testid="transit-route-item"]').first().click();
  await expect(panel.locator('[data-testid="transit-route-detail"]')).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator(".transitRouteStep")).toHaveCount(3);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "02-route-selected.png") });

  await panel.getByRole("button", { name: "닫기" }).click();
  await expect(panel).toHaveCount(0);

  // no-results path
  transitMode = "empty";
  await page.evaluate(() => {
    (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__?.jumpToZoom?.(
      37.556023,
      126.910152,
      16,
    );
  });
  await page.waitForTimeout(2000);
  hit = await page.evaluate(
    () =>
      (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__?.findMapPoi?.(
        ["station"],
      ) ?? null,
  );
  const box2 = await dialog.locator(".kakaoMap").first().boundingBox();
  if (!box2 || !hit) throw new Error("map/poi missing (empty)");
  await page.touchscreen.tap(box2.x + hit.x, box2.y + hit.y);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: /대중교통/ }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid="transit-no-results"]')).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole("button", { name: "도보" })).toBeVisible();
  expect(transitHits).toBe(2);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "03-no-results.png") });

  await context.close();
});
