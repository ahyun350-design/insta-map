/**
 * Admin expanded MapLibre name search = our data + Kakao keyword (parallel, ≤800ms, ranked together).
 * - "지구샵" from 망원: the exact-name shop (Kakao only) ranks first, not our prefix match.
 * - "메가커피": the map is not flown to a far #1; it fits the nearby results only.
 * - "이 지역에서 재검색": hidden after the search, shown after a ≥300m move or a 1-level zoom,
 *   hidden again on tap.
 * Writes e2e/artifacts/search-merge/*.png + timing.json
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

const OUT = path.join(process.cwd(), "e2e/artifacts/search-merge");
const MANGWON = { lat: 37.556, lng: 126.9101 };
const MYEONGDONG = { lat: 37.5636, lng: 126.9827 };

const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ({ fn, args }) => {
      const d = (window as unknown as { __PINDMAP_EXPANDED_GL__?: Record<string, (...a: unknown[]) => unknown> })
        .__PINDMAP_EXPANDED_GL__;
      return (d?.[fn]?.(...args) ?? null) as unknown;
    },
    { fn, args },
  );
const center = async (page: Page) => (await call(page, "getCenter")) as { lat: number; lng: number } | null;
const distM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  111320 * Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180));
const meters = (label: string) => (label.trim().endsWith("km") ? parseFloat(label) * 1000 : parseFloat(label));
const timing = (page: Page) =>
  page.evaluate(() => (window as unknown as { __PINDMAP_SEARCH_TIMING__?: unknown }).__PINDMAP_SEARCH_TIMING__ ?? null);

test("name search merges Kakao; camera fits nearby; 재검색 rule", async ({ browser }) => {
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
  const token = computeMapPreviewE2eToken();
  for (const p of ["**/api/admin/map-place", "**/api/admin/map-search", "**/api/admin/map-geocode", "**/api/admin/map-kakao-search"]) {
    await page.route(p, (route) => route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } }));
  }
  let searchCalls = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/admin/map-search")) searchCalls += 1;
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
  await expect.poll(() => call(page, "searchPinState"), { timeout: 60_000 }).not.toBeNull();
  await call(page, "jumpToZoom", MANGWON.lat, MANGWON.lng, 15);
  await page.waitForTimeout(2500);

  const input = dialog.getByTestId("expanded-maplibre-search-input");
  const sheet = dialog.locator(".mapSearchResultsSheet");
  const rows = sheet.locator(".mapSearchResultsSheetItem");
  const loading = dialog.getByTestId("map-search-loading");
  const research = dialog.getByRole("button", { name: "이 지역에서 재검색" });
  const timings: Record<string, unknown> = {};

  // 1) 지구샵: exact-name shop first (Kakao), within 1km of the search point
  await input.click();
  await input.fill("지구샵");
  await input.press("Enter");
  await expect(sheet).toBeVisible({ timeout: 2_000 }); // opens immediately (loading)
  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  await expect(rows.first().locator(".mapSearchResultsSheetItemName")).toHaveText("지구샵");
  expect(meters(await rows.first().locator(".mapSearchResultsSheetItemDistance").innerText())).toBeLessThan(1000);
  timings["지구샵"] = await timing(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "jiguship.png") });

  // 2) 메가커피 from 망원: camera stays around the search point (no flight to 명동)
  await call(page, "jumpToZoom", MANGWON.lat, MANGWON.lng, 15);
  await page.waitForTimeout(2000);
  await input.click();
  await input.fill("메가커피");
  await input.press("Enter");
  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  await expect(rows.first()).toContainText("메가");
  await page.waitForTimeout(2500);
  const after = await center(page);
  expect(after).not.toBeNull();
  expect(distM(after!, MANGWON), "map stays near the search point").toBeLessThan(2000);
  expect(distM(after!, MYEONGDONG), "not moved to 명동").toBeGreaterThan(4000);
  timings["메가커피"] = await timing(page);
  // D: result pins on top of every layer, other POIs faded while results show
  const pinsShown = (await call(page, "searchPinState")) as { search: number; dimmed: boolean; onTop: boolean };
  expect(pinsShown.search).toBeGreaterThan(0);
  expect(pinsShown.onTop, "result pin layers above all POI / label layers").toBe(true);
  expect(pinsShown.dimmed, "other POIs faded while results show").toBe(true);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: path.join(OUT, "megacoffee.png") });

  // 3) 재검색 rule: hidden right after the search; ≥300m move → shown; tap → hidden + re-search
  await expect(research).toHaveCount(0);
  const c0 = (await center(page))!;
  const lvl = (await call(page, "getLevel")) as number;
  const zoomForLevel = 19 - lvl; // kakaoLevelToMapLibreZoom: same Kakao level, whole zoom
  await call(page, "jumpToZoom", c0.lat + 0.0018, c0.lng, zoomForLevel); // ~200m
  await page.waitForTimeout(1500);
  await expect(research).toHaveCount(0);
  await call(page, "jumpToZoom", c0.lat + 0.0036, c0.lng, zoomForLevel); // ~400m
  await expect(research).toBeVisible({ timeout: 5_000 });
  const before = searchCalls;
  await research.click();
  await expect(research).toHaveCount(0, { timeout: 2_000 });
  await expect.poll(() => searchCalls, { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(2500);
  // zoom-only change (1 level) → shown
  const c1 = (await center(page))!;
  const l1 = (await call(page, "getLevel")) as number;
  await call(page, "jumpToZoom", c1.lat, c1.lng, 19 - l1 - 1);
  await expect(research).toBeVisible({ timeout: 5_000 });

  fs.writeFileSync(path.join(OUT, "timing.json"), JSON.stringify(timings, null, 2));
  console.log("[search-timing]", JSON.stringify(timings));
  await context.close();
});
