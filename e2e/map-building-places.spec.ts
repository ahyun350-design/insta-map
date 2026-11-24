/**
 * Admin MapLibre address card: "이 건물의 장소" on 망원로4길 3.
 * before = empty candidates (section hidden); after = real near RPC + address filter.
 * Screenshots: e2e/artifacts/building-places/address-before.png|address-after.png (390×844).
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

const OUT = path.join(process.cwd(), "e2e/artifacts/building-places");
const MANGWON = { lat: 37.556, lng: 126.9101 };

const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ({ fn, args }) => {
      const d = (window as unknown as { __PINDMAP_EXPANDED_GL__?: Record<string, (...a: unknown[]) => unknown> })
        .__PINDMAP_EXPANDED_GL__;
      return (d?.[fn]?.(...args) ?? null) as unknown;
    },
    { fn, args },
  );

async function openExpanded(page: Page) {
  await gotoTab(page, "map");
  await expect(page.locator(".kakaoMap.mapCompactMap")).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1500);
  await page.locator(".mapCompactTapLayer").click({ force: true });
  const dialog = page.locator('[aria-label="전체 지도"]');
  await expect(dialog.locator(".is-maplibre-expanded")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => call(page, "searchPinState"), { timeout: 60_000 }).not.toBeNull();
  await call(page, "jumpToZoom", MANGWON.lat, MANGWON.lng, 15);
  await page.waitForTimeout(2000);
  return dialog;
}

async function openAddressCard(page: Page, dialog: ReturnType<Page["locator"]>) {
  const input = dialog.getByTestId("expanded-maplibre-search-input");
  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  await input.click();
  await input.fill("망원로4길 3");
  const suggest = dialog.getByTestId("admin-map-suggest-item").first();
  await expect(suggest).toBeVisible({ timeout: 15_000 });
  await expect(suggest).toContainText("망원로4길 3");
  await suggest.click();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("망원로4길 3");
  return card;
}

test("address card building places: before hidden, after list + tap", async ({ browser }) => {
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
  const withE2e = (route: Parameters<Parameters<Page["route"]>[1]>[0]) =>
    route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } });
  for (const p of ["**/api/admin/map-place", "**/api/admin/map-search", "**/api/admin/map-geocode"]) {
    await page.route(p, withE2e);
  }

  // before: force empty candidates so the section stays hidden
  let mockEmpty = true;
  await page.route("**/api/admin/map-building-places", async (route) => {
    if (route.request().method() === "POST" && mockEmpty) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ candidates: [], diag: { count: 0, mocked: true } }),
      });
      return;
    }
    await withE2e(route);
  });

  await page.addInitScript(({ k }) => {
    const w = window as unknown as Record<string, unknown>;
    w.__PINDMAP_E2E_FORCE_MAPLIBRE__ = true;
    w.__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
    window.localStorage.setItem(k, "1");
  }, { k: EXPANDED_MAPLIBRE_STORAGE_KEY });

  await ensureLoggedIn(page);
  await dismissCoachmarks(page);
  const dialog = await openExpanded(page);
  const card = await openAddressCard(page, dialog);
  await page.waitForTimeout(1200);
  await expect(card.locator('[data-testid="building-places"]')).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, "address-before.png") });
  await card.getByRole("button", { name: "닫기" }).click();
  await expect(card).toBeHidden({ timeout: 10_000 });

  // after: real RPC
  mockEmpty = false;
  let afterCandidateCount: number | null = null;
  page.on("response", async (res) => {
    if (!res.url().includes("/api/admin/map-building-places") || res.request().method() !== "POST") return;
    try {
      const j = (await res.json()) as { candidates?: unknown[]; diag?: { count?: number } };
      afterCandidateCount = Array.isArray(j.candidates) ? j.candidates.length : (j.diag?.count ?? -1);
    } catch {
      afterCandidateCount = -2;
    }
  });

  const card2 = await openAddressCard(page, dialog);
  await expect
    .poll(() => afterCandidateCount, { timeout: 15_000, message: "building-places API responded" })
    .not.toBeNull();
  expect(afterCandidateCount, "near candidates > 0").toBeGreaterThan(0);
  await expect(card2.locator('[data-testid="building-places"]')).toBeVisible({ timeout: 15_000 });
  const items = card2.locator('[data-testid="building-places-item"]');
  await expect(items.first()).toBeVisible({ timeout: 10_000 });
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(10);
  // 업종: 한글 아이콘명만 (영어 class 원문 금지). 없으면 층만 또는 메타 없음.
  const metas = await items.locator(".placeDetailSheetBuildingPlacesMeta").allTextContents();
  for (const meta of metas) {
    expect(meta, "category line must not expose English class").not.toMatch(
      /\b(restaurant|cafe|bar|books|bakery|shop|fast_food)\b/i,
    );
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "address-after.png") });

  const firstName = (await items.first().locator(".placeDetailSheetBuildingPlacesName").innerText()).trim();
  expect(firstName.length).toBeGreaterThan(0);
  await items.first().click();
  await expect(card2).toContainText(firstName.slice(0, Math.min(4, firstName.length)), {
    timeout: 15_000,
  });
  await expect(card2.locator('[data-testid="building-places"]')).toHaveCount(0);

  await context.close();
});
