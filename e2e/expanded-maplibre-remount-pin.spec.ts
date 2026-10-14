/**
 * [A] Expanded MapLibre: remount storm / WebGL context stability (WebKit).
 * [B] Search result tap: focus pin visible above place card (WebKit + Chromium).
 *
 * Requires admin E2E account (force_maplibre localStorage) and Kakao Places.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { devices } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { COMPACT_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/compactMapLibreFlag";

type ExpandedGlDebug = {
  createCount: number;
  destroyCount: number;
  fallbackCount: number;
  liveContextCount: () => number;
  projectFocusPin: () => { x: number; y: number; lat: number; lng: number } | null;
  getPlaceCardRect: () => {
    top: number;
    bottom: number;
    height: number;
    width: number;
  } | null;
};

async function forceMapLibre(page: Page) {
  await page.addInitScript(
    ({ expandedKey, compactKey }) => {
      try {
        window.localStorage.setItem(expandedKey, "1");
        window.localStorage.setItem(compactKey, "1");
      } catch {
        /* noop */
      }
    },
    {
      expandedKey: EXPANDED_MAPLIBRE_STORAGE_KEY,
      compactKey: COMPACT_MAPLIBRE_STORAGE_KEY,
    },
  );
}

async function openExpandedMapLibre(page: Page) {
  await gotoTab(page, "map");
  await expect(page.locator(".kakaoMap.mapCompactMap")).toBeVisible({
    timeout: 45_000,
  });
  await page.locator(".mapCompactTapLayer").click({ force: true });
  const dialog = page.locator('[aria-label="전체 지도"]');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const d = (
            window as unknown as { __PINDMAP_EXPANDED_GL__?: ExpandedGlDebug }
          ).__PINDMAP_EXPANDED_GL__;
          return d?.createCount ?? 0;
        }),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  return dialog;
}

async function runExpandedSearch(page: Page, query: string) {
  const dialog = page.locator('[aria-label="전체 지도"]');
  const input = dialog.locator(
    "input.expandedMapLibreSearchInput, input.mapInput",
  ).first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(query);
  const searchBtn = dialog
    .locator(
      'button.expandedMapLibreSearchIcon[aria-label="검색"], button.primaryButton',
    )
    .first();
  await searchBtn.click();
  await expect
    .poll(
      async () => dialog.locator(".mapSearchResultsSheetItem").count(),
      { timeout: 25_000 },
    )
    .toBeGreaterThan(0);
}

async function readGl(page: Page): Promise<{
  createCount: number;
  destroyCount: number;
  fallbackCount: number;
  live: number;
}> {
  return page.evaluate(() => {
    const d = (
      window as unknown as { __PINDMAP_EXPANDED_GL__?: ExpandedGlDebug }
    ).__PINDMAP_EXPANDED_GL__;
    return {
      createCount: d?.createCount ?? 0,
      destroyCount: d?.destroyCount ?? 0,
      fallbackCount: d?.fallbackCount ?? 0,
      live: d?.liveContextCount?.() ?? -1,
    };
  });
}

const engines = [
  { name: "chromium", launch: "chromium" as const },
  { name: "webkit", launch: "webkit" as const },
];

for (const eng of engines) {
  test.describe(`expanded MapLibre remount+pin (${eng.name})`, () => {
    let browser: Browser;

    test.beforeAll(async ({ playwright }) => {
      browser = await playwright[eng.launch].launch();
    });
    test.afterAll(async () => {
      await browser?.close();
    });

    test(`[B] search result tap → focus pin above place card`, async () => {
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        locale: "ko-KR",
        geolocation: { latitude: 35.8714, longitude: 128.6014 },
        permissions: eng.launch === "chromium" ? ["geolocation"] : undefined,
      });
      await suppressCoachmarks(context);
      const page = await context.newPage();
      await forceMapLibre(page);
      await ensureLoggedIn(page);
      await dismissCoachmarks(page);

      const dialog = await openExpandedMapLibre(page);
      await runExpandedSearch(page, "함지부대찌개 연봉점");

      const result = page
        .locator('[aria-label="전체 지도"] .mapSearchResultsSheetItem')
        .filter({ hasText: /함지부대찌개/ })
        .first();
      await expect(result).toBeVisible({ timeout: 20_000 });
      await result.click();

      await expect(
        page.locator('[data-testid="expanded-place-detail-sheet"]'),
      ).toBeVisible({ timeout: 15_000 });

      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const d = (
                window as unknown as { __PINDMAP_EXPANDED_GL__?: ExpandedGlDebug }
              ).__PINDMAP_EXPANDED_GL__;
              const pin = d?.projectFocusPin?.();
              const card = d?.getPlaceCardRect?.();
              if (!pin || !card || card.height < 40) return "missing";
              const mapEl = document.querySelector(
                '[aria-label="전체 지도"] .kakaoMap',
              ) as HTMLElement | null;
              if (!mapEl) return "no-map";
              const mapBox = mapEl.getBoundingClientRect();
              const screenY = mapBox.top + pin.y;
              const screenX = mapBox.left + pin.x;
              const aboveCard = screenY < card.top - 4;
              const inX =
                screenX >= mapBox.left + 8 && screenX <= mapBox.right - 8;
              const inVisibleBand =
                screenY >= mapBox.top + 40 && aboveCard && inX;
              return inVisibleBand ? "ok" : `bad:${Math.round(screenX)},${Math.round(screenY)},cardTop=${Math.round(card.top)}`;
            }),
          { timeout: 12_000 },
        )
        .toBe("ok");

      await dialog.getByRole("button", { name: "전체 지도 닫기" }).click().catch(() => null);
      await context.close();
    });

    if (eng.launch === "webkit") {
      test(`[A] fullscreen search×5 + wait: remount ≤1, context fixed, fallback 0`, async () => {
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

        await openExpandedMapLibre(page);
        const baseline = await readGl(page);
        expect(baseline.createCount).toBeGreaterThanOrEqual(1);
        expect(baseline.live).toBeGreaterThanOrEqual(1);
        // Compact should have released — ideally 1 live GL while expanded is open
        expect(baseline.live).toBeLessThanOrEqual(2);

        const queries = ["강남역", "성수역", "홍대입구", "망원역", "연남동"];
        for (const q of queries) {
          await runExpandedSearch(page, q);
          await page.waitForTimeout(800);
        }

        const afterSearch = await readGl(page);
        const createsDuringSearch = afterSearch.createCount - baseline.createCount;
        expect(createsDuringSearch, "remount during 5 searches").toBeLessThanOrEqual(1);
        expect(afterSearch.fallbackCount).toBe(0);

        // Hold open ~3 minutes; createCount must not climb
        const holdMs = 180_000;
        const step = 15_000;
        let elapsed = 0;
        while (elapsed < holdMs) {
          await page.waitForTimeout(step);
          elapsed += step;
          const snap = await readGl(page);
          expect(
            snap.createCount - baseline.createCount,
            `remount after ${elapsed}ms`,
          ).toBeLessThanOrEqual(1);
          expect(snap.fallbackCount, `fallback after ${elapsed}ms`).toBe(0);
          expect(snap.live, `live GL after ${elapsed}ms`).toBe(afterSearch.live);
        }

        const final = await readGl(page);
        expect(final.createCount - baseline.createCount).toBeLessThanOrEqual(1);
        expect(final.fallbackCount).toBe(0);
        expect(final.live).toBe(afterSearch.live);

        await context.close();
      });
    }
  });
}
