/**
 * D-2 admin expanded MapLibre search: autocomplete (our data) → pick → D-1 card,
 * rotation kept; recent queries (this device) + clear; Enter → results list (ours first);
 * 도로명주소 suggestion → geocoded card.
 * Writes e2e/artifacts/d2/*.png
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

const OUT = path.join(process.cwd(), "e2e/artifacts/d2");
const HONGDAE = { lat: 37.5563, lng: 126.9236 };

type GlDebug = {
  jumpToZoom?: (lat: number, lng: number, zoom: number) => void;
  setBearing?: (deg: number) => void;
  getBearing?: () => number;
  getLevel?: () => number | null;
};

const evalGl = <T,>(page: Page, fn: keyof GlDebug, ...args: unknown[]) =>
  page.evaluate(
    ({ fn, args }) => {
      const d = (window as unknown as { __PINDMAP_EXPANDED_GL__?: Record<string, (...a: unknown[]) => unknown> })
        .__PINDMAP_EXPANDED_GL__;
      return d?.[fn]?.(...args) as unknown;
    },
    { fn, args },
  ) as Promise<T>;

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
  await expect
    .poll(() => page.evaluate(() => Boolean((window as unknown as { __PINDMAP_EXPANDED_GL__?: unknown }).__PINDMAP_EXPANDED_GL__)), {
      timeout: 60_000,
    })
    .toBe(true);
  return dialog;
}

test("D-2 search: autocomplete → card (rotation kept), recent, Enter list, road address", async ({ browser }) => {
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
  for (const p of ["**/api/admin/map-place", "**/api/admin/map-search", "**/api/admin/map-geocode"]) {
    await page.route(p, (route) =>
      route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } }),
    );
  }
  let searchCalls = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/admin/map-search")) searchCalls += 1;
  });

  const dialog = await openExpanded(page);
  await page.evaluate((k) => window.localStorage.removeItem(k), "pindmap_admin_map_recent_v1");
  await evalGl(page, "jumpToZoom", HONGDAE.lat, HONGDAE.lng, 15);
  await page.waitForTimeout(2500);
  await evalGl(page, "setBearing", 30);
  await page.waitForTimeout(1500);

  const input = dialog.getByTestId("expanded-maplibre-search-input");
  const suggest = dialog.getByTestId("admin-map-suggest");
  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');

  // 1) Autocomplete: typing fires one debounced request, top items are ours
  await input.click();
  await input.pressSequentially("스타벅스 홍대", { delay: 40 });
  await expect(suggest).toBeVisible({ timeout: 15_000 });
  const items = suggest.getByTestId("admin-map-suggest-item");
  expect(await items.count()).toBeGreaterThan(0);
  expect(await items.count()).toBeLessThanOrEqual(8);
  await expect(items.first()).toContainText("스타벅스");
  expect(searchCalls, "debounce: not one request per keystroke").toBeLessThanOrEqual(3);
  await page.screenshot({ path: path.join(OUT, "suggest.png") });

  // 2) Pick → D-1 card, rotation kept
  await items.first().click();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("스타벅스");
  await expect(suggest).toHaveCount(0);
  await page.waitForTimeout(1200);
  expect(Math.round(await evalGl<number>(page, "getBearing")), "search camera keeps the rotation").toBe(30);
  await expect(card.locator(".placeDetailSheetLabel").filter({ hasText: "주소" })).toBeVisible({ timeout: 15_000 });
  await expect(card.locator(".placeDetailSheetCategory")).not.toHaveText(/^(.+) · \1$/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "card.png") });
  await card.getByRole("button", { name: "닫기" }).click();
  await expect(card).toBeHidden({ timeout: 10_000 });

  // 3) Recent queries (this device): shown on empty focus, clear button empties them
  await input.click();
  const recent = dialog.getByTestId("admin-map-recent");
  await expect(recent).toBeVisible({ timeout: 5_000 });
  await expect(recent).toContainText("스타벅스 홍대");
  const stored = await page.evaluate(() => window.localStorage.getItem("pindmap_admin_map_recent_v1"));
  expect(JSON.parse(stored || "[]")).toContain("스타벅스 홍대");
  await page.screenshot({ path: path.join(OUT, "recent.png") });
  await recent.getByRole("button", { name: "지우기" }).click();
  await expect(recent).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem("pindmap_admin_map_recent_v1"))).toBeNull();

  // 4) Enter → results list, our rows first
  await input.fill("경복궁");
  await input.press("Enter");
  const firstRow = dialog.locator(".mapSearchResultsSheetItem").first();
  await expect(firstRow).toBeVisible({ timeout: 20_000 });
  await expect(firstRow).toContainText("경복궁");
  const sheet = dialog.locator(".mapSearchResultsSheet");
  await expect(sheet).not.toContainText("주소 없음");
  const gyeongbokRows = sheet
    .locator(".mapSearchResultsSheetItem")
    .filter({ has: page.locator(".mapSearchResultsSheetItemName", { hasText: /^경복궁$/ }) });
  await expect(
    gyeongbokRows.filter({
      has: page.locator(".mapSearchResultsSheetItemCategory", { hasText: /^(관광명소|랜드마크|지하철역)$/ }),
    }),
    "경복궁 관광+랜드마크 shown once (same-name 상가 shops are separate places)",
  ).toHaveCount(1);
  const gyeongbokKinds = await gyeongbokRows.evaluateAll((els) =>
    els.map((el) => (el.querySelector(".mapSearchResultsSheetItemAddress") ? "shop" : "catalog")),
  );
  expect(gyeongbokKinds.indexOf("catalog"), "관광지 경복궁 above 상가 경복궁 shops").toBe(0);
  await page.screenshot({ path: path.join(OUT, "results.png") });
  await firstRow.click();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("경복궁");
  expect(Math.round(await evalGl<number>(page, "getBearing")), "list pick keeps the rotation").toBe(30);
  await card.getByRole("button", { name: "닫기" }).click();
  await expect(card).toBeHidden({ timeout: 10_000 });

  // 5) 도로명주소: suggestion from juso → tap geocodes once → card
  await input.click();
  await input.fill("망원로4길 3");
  await expect(suggest).toBeVisible({ timeout: 15_000 });
  const addr = suggest.getByTestId("admin-map-suggest-item").first();
  await expect(addr).toContainText("망원로4길 3");
  await addr.click();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("망원로4길 3");
  await expect
    .poll(() => evalGl<number | null>(page, "getLevel"), { timeout: 8_000, message: "address camera: Kakao level 2 = MapLibre z17" })
    .toBe(2);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, "address.png") });

  await context.close();
});
