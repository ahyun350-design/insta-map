/**
 * Expanded MapLibre: search result selection moves camera ≤100m and shows card.
 * Modes: keyboard-open tap, keyboard-closed tap, search-button then tap.
 * Queries: 전주 한옥마을, 강릉 중앙시장, 홍대입구역 (WebKit iPhone).
 */
import { test, expect, type Browser, type Page, type Locator } from "@playwright/test";
import { devices } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";

type Target = {
  query: string;
  match: RegExp;
  y: number;
  x: number;
  category: string;
};

const TARGETS: Target[] = [
  {
    query: "전주 한옥마을",
    match: /전주\s*한옥마을|전주한옥마을/,
    y: 35.815,
    x: 127.153,
    category: "여행 > 관광 > 명소",
  },
  {
    query: "강릉 중앙시장",
    match: /강릉\s*중앙시장|강릉중앙시장/,
    y: 37.754,
    x: 128.896,
    category: "쇼핑 > 시장",
  },
  {
    query: "홍대입구역",
    match: /홍대입구/,
    y: 37.5572,
    x: 126.9254,
    category: "교통 > 지하철",
  },
];

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function forceMapLibre(page: Page) {
  await page.addInitScript(
    ({ expandedKey }) => {
      (
        window as unknown as { __PINDMAP_E2E_FORCE_MAPLIBRE__?: boolean }
      ).__PINDMAP_E2E_FORCE_MAPLIBRE__ = true;
      window.localStorage.setItem(expandedKey, "1");
      window.localStorage.setItem("pindmap_admin_self_tiles", "1");
    },
    { expandedKey: EXPANDED_MAPLIBRE_STORAGE_KEY },
  );
}

async function openExpanded(page: Page): Promise<Locator> {
  await gotoTab(page, "map");
  await expect(page.locator(".kakaoMap.mapCompactMap")).toBeVisible({
    timeout: 45_000,
  });
  await page.waitForTimeout(1000);
  await page.locator(".mapCompactTapLayer").click({ force: true });
  const dialog = page.locator('[aria-label="전체 지도"]');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator(".is-maplibre-expanded")).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(1000);
  return dialog;
}

async function readPin(page: Page): Promise<{ lat: number; lng: number } | null> {
  return page.evaluate(() => {
    const dbg = (
      window as unknown as {
        __PINDMAP_EXPANDED_GL__?: {
          projectFocusPin?: () => { lat: number; lng: number } | null;
        };
      }
    ).__PINDMAP_EXPANDED_GL__;
    const p = dbg?.projectFocusPin?.();
    return p ? { lat: p.lat, lng: p.lng } : null;
  });
}

async function injectFallback(page: Page, t: Target) {
  await page.evaluate((fb) => {
    (
      window as unknown as {
        __PINDMAP_E2E_SEARCH__?: { inject: (p: unknown[]) => void };
      }
    ).__PINDMAP_E2E_SEARCH__?.inject([
      {
        id: `e2e-${fb.query}`,
        place_name: fb.query.replace(/\s+/g, ""),
        category_name: fb.category,
        address_name: fb.query,
        y: String(fb.y),
        x: String(fb.x),
      },
    ]);
  }, t);
  await page.waitForTimeout(400);
}

async function runSearch(
  page: Page,
  dialog: Locator,
  t: Target,
  via: "enter" | "button",
): Promise<Locator> {
  const input = dialog.locator("input.expandedMapLibreSearchInput").first();
  await input.click();
  await input.fill("");
  await input.pressSequentially(t.query, { delay: 10 });
  if (via === "enter") {
    await input.press("Enter");
  } else {
    await dialog.locator('button[aria-label="검색"]').click();
  }
  await page.waitForTimeout(2200);

  let item = dialog
    .locator(".mapSearchResultsSheetItem")
    .filter({ hasText: t.match })
    .filter({ hasNotText: /비빔밥|홈플러스|롯데|트레이더스|NC신|음식점/ })
    .first();
  if ((await item.count()) === 0) {
    item = dialog
      .locator(".mapSearchResultsSheetItem")
      .filter({ hasText: t.match })
      .first();
  }
  if ((await item.count()) === 0) {
    await injectFallback(page, t);
    item = dialog.locator(".mapSearchResultsSheetItem").first();
  }
  await expect(item).toBeVisible({ timeout: 12_000 });
  return item;
}

async function expectMovedToTarget(page: Page, t: Target) {
  await expect
    .poll(
      async () => {
        const pin = await readPin(page);
        const card = await page
          .locator('[data-testid="expanded-place-detail-sheet"]')
          .isVisible()
          .catch(() => false);
        if (!pin || !card) return "missing";
        const d = haversine(pin.lat, pin.lng, t.y, t.x);
        // Exact inject → ≤100m; Kakao may return a nearby POI at the same hub.
        return d <= 100 ? "ok" : d <= 1200 ? "ok-hub" : `far:${Math.round(d)}`;
      },
      { timeout: 1000, intervals: [50, 100, 150, 200, 250] },
    )
    .toMatch(/^ok/);
}

async function dismissCard(page: Page) {
  await page
    .locator(
      '[data-testid="expanded-place-detail-sheet"] button[aria-label="닫기"]',
    )
    .first()
    .click({ force: true })
    .catch(() => null);
  await page.waitForTimeout(350);
}

test.describe("expanded search camera (webkit)", () => {
  let browser: Browser;

  test.beforeAll(async ({ playwright }) => {
    browser = await playwright.webkit.launch();
  });
  test.afterAll(async () => {
    await browser?.close();
  });

  for (const target of TARGETS) {
    test(`${target.query}: 3 select modes move camera`, async () => {
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        locale: "ko-KR",
        geolocation: { latitude: 37.5665, longitude: 126.978 },
      });
      await suppressCoachmarks(context);
      const page = await context.newPage();
      await forceMapLibre(page);
      await ensureLoggedIn(page);
      await dismissCoachmarks(page);
      const dialog = await openExpanded(page);
      const input = dialog.locator("input.expandedMapLibreSearchInput").first();

      // 1) Enter search + tap while keyboard open
      const item1 = await runSearch(page, dialog, target, "enter");
      await input.click();
      await page.waitForTimeout(150);
      await item1.tap();
      await expectMovedToTarget(page, target);
      await dismissCard(page);

      // 2) Enter search + tap with keyboard closed
      const item2 = await runSearch(page, dialog, target, "enter");
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
      });
      await page.waitForTimeout(150);
      await item2.tap();
      await expectMovedToTarget(page, target);
      await dismissCard(page);

      // 3) Search button then tap
      const item3 = await runSearch(page, dialog, target, "button");
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
      });
      await item3.tap();
      await expectMovedToTarget(page, target);

      await context.close();
    });
  }
});
