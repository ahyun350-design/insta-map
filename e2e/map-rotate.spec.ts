/**
 * Admin expanded MapLibre rotation: compass appears when rotated, place card /
 * search camera / my-location work while rotated, compass returns to north.
 * Writes e2e/artifacts/d15/rotate-45.png (compass visible).
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

const OUT = path.join(process.cwd(), "e2e/artifacts/d15");
const HOME = { lat: 37.5565, lng: 126.9019 };

type GlDebug = {
  createCount: number;
  findMapPoi?: (kinds: string[]) => { x: number; y: number; name: string } | null;
  jumpToZoom?: (lat: number, lng: number, zoom: number) => void;
  setBearing?: (deg: number) => void;
  getBearing?: () => number;
  projectFocusPin?: () => { x: number; y: number } | null;
  getPlaceCardRect?: () => { top: number; height: number } | null;
};
const gl = (page: Page) =>
  page.evaluate(() => Boolean((window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__));

async function openExpanded(page: Page) {
  await page.addInitScript(({ k }) => {
    const w = window as unknown as {
      __PINDMAP_E2E_FORCE_MAPLIBRE__?: boolean;
      __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null;
    };
    w.__PINDMAP_E2E_FORCE_MAPLIBRE__ = true;
    w.__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
    window.localStorage.setItem(k, "1");
  }, { k: EXPANDED_MAPLIBRE_STORAGE_KEY });
  await ensureLoggedIn(page);
  await dismissCoachmarks(page);
  await gotoTab(page, "map");
  await expect(page.locator(".kakaoMap.mapCompactMap")).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1500);
  await page.locator(".mapCompactTapLayer").click({ force: true });
  const dialog = page.locator('[aria-label="전체 지도"]');
  await expect(dialog.locator(".is-maplibre-expanded")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => gl(page), { timeout: 60_000 }).toBe(true);
  return dialog;
}

const evalGl = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ({ fn, args }) => {
      const d = (window as unknown as { __PINDMAP_EXPANDED_GL__?: Record<string, (...a: unknown[]) => unknown> })
        .__PINDMAP_EXPANDED_GL__;
      return d?.[fn]?.(...args) as unknown;
    },
    { fn, args },
  ) as Promise<T>;

test("rotated map: compass, place card, search camera, my location, back to north", async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    geolocation: { latitude: HOME.lat, longitude: HOME.lng },
    permissions: ["geolocation"],
  });
  await suppressCoachmarks(context);
  const page = await context.newPage();
  const token = computeMapPreviewE2eToken();
  await page.route("**/api/admin/map-place", (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } }),
  );
  const dialog = await openExpanded(page);
  const compass = page.locator('[data-testid="expanded-maplibre-compass"]');

  await evalGl(page, "jumpToZoom", HOME.lat, HOME.lng, 16);
  await page.waitForTimeout(3000);
  await expect(compass, "north-up: no compass").toHaveCount(0);

  await evalGl(page, "setBearing", 45);
  await page.waitForTimeout(3500);
  await expect(compass).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: path.join(OUT, "rotate-45.png") });

  // Place card while rotated
  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  const hit = await evalGl<{ x: number; y: number; name: string } | null>(page, "findMapPoi", ["sangga", "shop", "landmark", "park"]);
  expect(hit, "a tappable place while rotated").not.toBeNull();
  const box = await dialog.locator(".kakaoMap").first().boundingBox();
  await page.touchscreen.tap(box!.x + hit!.x, box!.y + hit!.y);
  if (!(await card.isVisible({ timeout: 3_000 }).catch(() => false))) {
    await page.mouse.click(box!.x + hit!.x, box!.y + hit!.y);
  }
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(compass, "compass stays while the card is open").toBeVisible();
  const bearingAfterCard = await evalGl<number>(page, "getBearing");
  expect(Math.round(bearingAfterCard), "card camera keeps the rotation").toBe(45);
  await card.getByRole("button", { name: "닫기" }).click();
  await expect(card).toBeHidden({ timeout: 10_000 });

  // Search result camera while rotated: focus pin sits above the card
  await page.evaluate(() => {
    const api = (window as unknown as { __PINDMAP_E2E_SEARCH__?: { inject: (p: unknown[]) => void } })
      .__PINDMAP_E2E_SEARCH__;
    api?.inject([
      { id: "e2e-rot", place_name: "망원역", category_name: "교통,수송 > 지하철역", address_name: "", road_address_name: "", y: "37.5559", x: "126.9101" },
    ]);
  });
  const result = dialog.locator(".mapSearchResultsSheetItem").first();
  await expect(result).toBeVisible({ timeout: 10_000 });
  await result.click();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const d = (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__;
          const pin = d?.projectFocusPin?.();
          const c = d?.getPlaceCardRect?.();
          const map = document.querySelector('[aria-label="전체 지도"] .kakaoMap') as HTMLElement | null;
          if (!pin || !c || !map) return "missing";
          const top = map.getBoundingClientRect().top + pin.y;
          return top < c.top - 4 ? "ok" : "covered";
        }),
      { timeout: 12_000 },
    )
    .toBe("ok");
  await card.getByRole("button", { name: "닫기" }).click();
  await expect(card).toBeHidden({ timeout: 10_000 });

  // My location while rotated
  await evalGl(page, "jumpToZoom", 37.5665, 126.978, 16);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "현재 위치로 이동" }).click();
  await expect
    .poll(
      async () => {
        const c = await evalGl<{ lat: number; lng: number } | null>(page, "getCenter");
        if (!c) return "none";
        const dLat = (c.lat - HOME.lat) * 111_320;
        const dLng = (c.lng - HOME.lng) * 111_320 * Math.cos((HOME.lat * Math.PI) / 180);
        return Math.hypot(dLat, dLng) < 400 ? "near" : "far";
      },
      { timeout: 15_000 },
    )
    .toBe("near");
  const bearingAfterLocate = await evalGl<number>(page, "getBearing");
  expect(Math.round(bearingAfterLocate), "locate keeps the rotation").toBe(45);

  // Compass → north
  await compass.click();
  await expect.poll(async () => Math.round(Math.abs(await evalGl<number>(page, "getBearing"))), { timeout: 5_000 }).toBe(0);
  await expect(compass).toHaveCount(0, { timeout: 5_000 });

  await context.close();
});
