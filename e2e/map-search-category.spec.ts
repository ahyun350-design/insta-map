/**
 * Admin expanded MapLibre category chips are display-hidden.
 * Chip code remains; this spec only asserts they are not shown.
 * (Former chip→search flow retired with the chrome hide.)
 */
import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

test("category chips: hidden under search on admin MapLibre", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    geolocation: { latitude: 37.5563, longitude: 126.9236 },
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
  await page.addInitScript(({ k }) => {
    const w = window as unknown as Record<string, unknown>;
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
  await expect(dialog.getByTestId("expanded-maplibre-search-input")).toBeVisible({ timeout: 15_000 });

  await expect(dialog.getByTestId("admin-map-category-chips")).toHaveCount(0);
  await expect(dialog.getByTestId("admin-map-category-chip")).toHaveCount(0);
  await expect(dialog.getByLabel("인기 장소 레이어")).toHaveCount(0);

  await context.close();
});
