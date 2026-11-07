/**
 * Admin expanded MapLibre category chips (Kakao category search, live, display only):
 * chip → pins + list (≤30, distance order) + "· 카카오" credit; 정확도순 re-queries;
 * moving the map → "이 지역에서 재검색" re-runs the chip; a name search opens in 정확도순.
 * Writes e2e/artifacts/category/*.png
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

const OUT = path.join(process.cwd(), "e2e/artifacts/category");
const HONGDAE = { lat: 37.5563, lng: 126.9236 };
const MANGWON = { lat: 37.556, lng: 126.9101 };

type GlDebug = {
  jumpToZoom?: (lat: number, lng: number, zoom: number) => void;
  searchPinState?: () => { search: number; focus: string | null } | null;
};
const gl = <K extends keyof GlDebug>(page: Page, fn: K, ...args: unknown[]) =>
  page.evaluate(
    ({ fn, args }) => {
      const d = (window as unknown as { __PINDMAP_EXPANDED_GL__?: Record<string, (...a: unknown[]) => unknown> })
        .__PINDMAP_EXPANDED_GL__;
      return d?.[fn]?.(...args) ?? null;
    },
    { fn, args },
  ) as Promise<ReturnType<NonNullable<GlDebug[K]>> | null>;

const meters = (label: string) => {
  const t = label.trim();
  if (t.endsWith("km")) return parseFloat(t) * 1000;
  return parseFloat(t);
};

test("category chips: 카페 → pins + list (distance), 정확도순, 재검색, name search 정확도순", async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    geolocation: { latitude: HONGDAE.lat, longitude: HONGDAE.lng },
    permissions: ["geolocation"],
  });
  await suppressCoachmarks(context);
  const page = await context.newPage();
  const token = computeMapPreviewE2eToken();
  for (const p of ["**/api/admin/map-place", "**/api/admin/map-search", "**/api/admin/map-geocode", "**/api/admin/map-category"]) {
    await page.route(p, (route) => route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } }));
  }
  let categoryCalls = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/admin/map-category")) categoryCalls += 1;
  });
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
  await expect.poll(() => gl(page, "searchPinState"), { timeout: 60_000 }).not.toBeNull();
  await gl(page, "jumpToZoom", HONGDAE.lat, HONGDAE.lng, 16);
  await page.waitForTimeout(2500);

  const chips = dialog.getByTestId("admin-map-category-chip");
  await expect(chips).toHaveCount(13);
  const credit = dialog.getByTestId("maplibre-corner-attribution");
  await expect(credit).not.toContainText("카카오");

  // 1) 카페 → list + pins, distance order, Kakao credit
  await dialog.locator('[data-chip="cafe"]').click();
  const sheet = dialog.locator(".mapSearchResultsSheet");
  const rows = sheet.locator(".mapSearchResultsSheetItem");
  await expect(sheet).toContainText("카페", { timeout: 20_000 });
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(30);
  expect(categoryCalls).toBe(1);
  await expect(dialog.locator('[data-chip="cafe"]')).toHaveAttribute("aria-pressed", "true");
  await expect(rows.first().locator(".mapSearchResultsSheetItemCategory")).toContainText("카페");
  await expect.poll(async () => (await gl(page, "searchPinState"))?.search ?? 0, { timeout: 8_000 }).toBe(n);
  const sort = sheet.getByTestId("map-search-sort");
  await expect(sort.getByRole("button", { name: "거리순" })).toHaveAttribute("aria-pressed", "true");
  const dists = (await sheet.locator(".mapSearchResultsSheetItemDistance").allTextContents()).map(meters);
  expect(dists.length).toBe(n);
  for (let i = 1; i < dists.length; i++) expect(dists[i]! + 15, "distance order").toBeGreaterThanOrEqual(dists[i - 1]!);
  await expect(credit).toContainText("카카오");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "cafe-hongdae.png") });

  // 2) 정확도순 → live re-query (no cache)
  await sort.getByRole("button", { name: "정확도순" }).click();
  await expect.poll(() => categoryCalls, { timeout: 10_000 }).toBe(2);
  await expect(sort.getByRole("button", { name: "정확도순" })).toHaveAttribute("aria-pressed", "true");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });

  // 3) Move the map → "이 지역에서 재검색" re-runs the chip there
  await sort.getByRole("button", { name: "거리순" }).click();
  await expect.poll(() => categoryCalls, { timeout: 10_000 }).toBe(3);
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  await gl(page, "jumpToZoom", MANGWON.lat, MANGWON.lng, 16);
  const research = dialog.getByRole("button", { name: "이 지역에서 재검색" });
  await expect(research).toBeVisible({ timeout: 10_000 });
  await research.click();
  await expect.poll(() => categoryCalls, { timeout: 10_000 }).toBe(4);
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator('[data-chip="cafe"]')).toHaveAttribute("aria-pressed", "true");
  // User (홍대) is >1km from the new search point (망원): order + labels from the map centre.
  const far = (await sheet.locator(".mapSearchResultsSheetItemDistance").allTextContents()).map(meters);
  expect(far[0]!, "labels measured from the 망원 map centre").toBeLessThan(500);
  for (let i = 1; i < far.length; i++) expect(far[i]! + 15, "distance order (map centre)").toBeGreaterThanOrEqual(far[i - 1]!);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "cafe-research-mangwon.png") });

  // 4) Name search → 정확도순 by default, chip released, our rows only → no Kakao credit
  await gl(page, "jumpToZoom", HONGDAE.lat, HONGDAE.lng, 15);
  await page.waitForTimeout(1500);
  const input = dialog.getByTestId("expanded-maplibre-search-input");
  await input.click();
  await input.fill("이디야");
  await input.press("Enter");
  await expect(sheet).toContainText("이디야", { timeout: 20_000 });
  await expect(sort.getByRole("button", { name: "정확도순" })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(dialog.locator('[data-chip="cafe"]')).toHaveAttribute("aria-pressed", "false");
  await expect(credit).not.toContainText("카카오");
  await page.screenshot({ path: path.join(OUT, "name-search-accuracy.png") });

  // 5) Clear → chips back, nothing pinned
  await dialog.getByRole("button", { name: "검색 지우기" }).click();
  await expect(dialog.locator('[data-chip="cafe"]')).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await gl(page, "searchPinState"))?.search ?? -1, { timeout: 8_000 }).toBe(0);
  await context.close();
});
