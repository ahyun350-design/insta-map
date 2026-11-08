/**
 * Admin expanded MapLibre: previous search pins (incl. the 도로명주소 house) do not linger.
 * Only the open card's pin stays on the map; closing the card leaves none.
 * Writes e2e/artifacts/pin-clear/after.png
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

const OUT = path.join(process.cwd(), "e2e/artifacts/pin-clear");
const HONGDAE = { lat: 37.5563, lng: 126.9236 };

type PinState = { search: number; focus: string | null };

const pinState = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __PINDMAP_EXPANDED_GL__?: { searchPinState?: () => PinState | null } })
      .__PINDMAP_EXPANDED_GL__;
    return d?.searchPinState?.() ?? null;
  });

/** House = focus pin drawn with the 도로명주소 badge. */
const housePins = (s: PinState | null) => (s?.focus?.includes("admin-address") ? 1 : 0);

test("search pins: address house cleared by the next search; only the open card's pin stays", async ({ browser }) => {
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
    await page.route(p, (route) => route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } }));
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
  await expect.poll(() => pinState(page), { timeout: 60_000 }).not.toBeNull();
  await page.evaluate(({ lat, lng }) => {
    (window as unknown as { __PINDMAP_EXPANDED_GL__?: { jumpToZoom?: (a: number, b: number, z: number) => void } })
      .__PINDMAP_EXPANDED_GL__?.jumpToZoom?.(lat, lng, 15);
  }, HONGDAE);
  await page.waitForTimeout(2000);

  const input = dialog.getByTestId("expanded-maplibre-search-input");
  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  const firstRow = dialog.locator(".mapSearchResultsSheetItem").first();

  // 1) 도로명주소 → result tap → one pin: the house
  await input.click();
  await input.fill("망원로4길 3");
  await input.press("Enter");
  await expect(firstRow).toContainText("망원로4길 3", { timeout: 20_000 });
  await firstRow.click();
  await expect(card).toContainText("망원로4길 3", { timeout: 15_000 });
  await expect.poll(async () => housePins(await pinState(page)), { timeout: 8_000 }).toBe(1);
  expect((await pinState(page))?.search, "address tap: other result pins cleared").toBe(0);

  // 2) New search "이디야": the house goes with the previous search
  await input.click();
  await input.fill("이디야");
  await input.press("Enter");
  await expect(firstRow).toContainText("이디야", { timeout: 20_000 });
  await expect.poll(async () => housePins(await pinState(page)), { timeout: 8_000 }).toBe(0);
  expect((await pinState(page))?.search ?? 0, "results shown as pins").toBeGreaterThan(0);

  // 3) Result tap → house 0, exactly one search pin (the open card's)
  await firstRow.click();
  await expect(card).toContainText("이디야", { timeout: 15_000 });
  await expect.poll(async () => (await pinState(page))?.focus ?? null, { timeout: 8_000 }).not.toBeNull();
  const after = await pinState(page);
  expect(housePins(after), "house pins after the next search + tap").toBe(0);
  expect(after?.search, "other result pins cleared on tap").toBe(0);
  expect((after?.search ?? 0) + (after?.focus ? 1 : 0), "search pins on the map = the open card's").toBe(1);
  expect(after?.focus ?? "", "selected result drawn as the (1.2×) result pin").toMatch(/^search-pin-selected:/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "after.png") });

  // 4) Close the card → no search pin left
  await card.getByRole("button", { name: "닫기" }).click();
  await expect(card).toBeHidden({ timeout: 10_000 });
  await expect
    .poll(async () => {
      const s = await pinState(page);
      return s ? { search: s.search, focus: s.focus } : null;
    }, { timeout: 8_000 })
    .toEqual({ search: 0, focus: null });
  expect((await pinState(page) as { dimmed?: boolean } | null)?.dimmed, "POIs back to normal once results close").toBe(false);

  await context.close();
});
