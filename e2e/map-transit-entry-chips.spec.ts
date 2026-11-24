/**
 * Admin MapLibre: category chips hidden + in-app transit from directions.
 * Screenshots 390×844 → e2e/artifacts/entry-chips/
 * ① full map first screen before (chips forced) / after (hidden)
 * ② directions → 대중교통 → TransitRoutePanel (after)
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";
import { subwayRefColour } from "../lib/mapSurface/poiCategoryIcons";
import { WALK_LINE_COLOUR, type TransitRoute } from "../lib/mapTransit";
import { ADMIN_MAP_RESEARCH_GAP_BELOW_SEARCH_PX } from "../lib/adminMapLibreChrome";

const OUT = path.join(process.cwd(), "e2e/artifacts/entry-chips");
const MANGWON = { lat: 37.556023, lng: 126.910152 };

type GlDebug = {
  createCount: number;
  findMapPoi?: (
    kinds: Array<"shop" | "sangga" | "tour" | "landmark" | "park" | "station" | "bus">,
  ) => { x: number; y: number; name: string; kind: string } | null;
  jumpToZoom?: (lat: number, lng: number, zoom: number) => void;
};

const MOCK_ROUTES: { status: string; routes: TransitRoute[] } = {
  status: "OK",
  routes: [
    {
      type: "SUBWAY",
      totalTimeSec: 600,
      transfers: 0,
      walkTimeSec: 120,
      fareWon: 1400,
      vehicles: [{ type: "지하철", name: "6호선" }],
      steps: [
        {
          type: "WALKING",
          timeSec: 60,
          distanceM: 80,
          guidance: "",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.556, lng: 126.91 },
            { lat: 37.5561, lng: 126.9105 },
          ],
          colour: WALK_LINE_COLOUR,
        },
        {
          type: "SUBWAY",
          timeSec: 480,
          distanceM: 1200,
          guidance: "",
          stops: [{ name: "망원" }, { name: "합정" }],
          vehicles: [{ type: "지하철", name: "6호선" }],
          path: [
            { lat: 37.5561, lng: 126.9105 },
            { lat: 37.55, lng: 126.914 },
            { lat: 37.5499, lng: 126.9136 },
          ],
          colour: subwayRefColour("6"),
        },
        {
          type: "WALKING",
          timeSec: 60,
          distanceM: 80,
          guidance: "",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.5499, lng: 126.9136 },
            { lat: 37.55, lng: 126.914 },
          ],
          colour: WALK_LINE_COLOUR,
        },
      ],
    },
  ],
};

async function forceMapLibre(page: Page, opts?: { showChips?: boolean }) {
  await page.addInitScript(
    ({ k, showChips }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__PINDMAP_E2E_FORCE_MAPLIBRE__ = true;
      w.__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
      if (showChips) w.__PINDMAP_E2E_SHOW_CATEGORY_CHIPS__ = true;
      window.localStorage.setItem(k, "1");
    },
    { k: EXPANDED_MAPLIBRE_STORAGE_KEY, showChips: Boolean(opts?.showChips) },
  );
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

test("entry-chips: before/after chrome + transit from directions", async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });

  // ① before — chips forced on
  {
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
    const token = computeMapPreviewE2eToken();
    for (const p of ["**/api/admin/map-place", "**/api/admin/map-search", "**/api/admin/map-geocode"]) {
      await page.route(p, (route) =>
        route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } }),
      );
    }
    await forceMapLibre(page, { showChips: true });
    await ensureLoggedIn(page);
    await dismissCoachmarks(page);
    const dialog = await openExpanded(page);
    await expect(dialog.getByTestId("admin-map-category-chips")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "01-map-before.png") });
    await context.close();
  }

  // ① after + ② transit — chips hidden; mock transit
  {
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

    page.on("popup", async (p) => {
      await p.close().catch(() => null);
      throw new Error("external Kakao must not open on MapLibre transit");
    });

    await forceMapLibre(page, { showChips: false });
    await ensureLoggedIn(page);
    await dismissCoachmarks(page);
    const dialog = await openExpanded(page);
    await expect(dialog.getByTestId("admin-map-category-chips")).toHaveCount(0);
    await expect(dialog.getByLabel("인기 장소 레이어")).toHaveCount(0);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "01-map-after.png") });

    // Jump + tap station → place-card 길찾기 대중교통 → in-app panel
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

    const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole("button", { name: "대중교통 길찾기" })).toHaveCount(0);
    await card.getByRole("button", { name: /대중교통/ }).click();
    const panel = page.locator('[data-testid="transit-route-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.locator('[data-testid="transit-route-list"]')).toBeVisible({ timeout: 10_000 });
    expect(ADMIN_MAP_RESEARCH_GAP_BELOW_SEARCH_PX).toBe(8);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "02-transit-after.png") });

    await context.close();
  }
});
