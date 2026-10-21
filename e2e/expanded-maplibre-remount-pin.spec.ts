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
  // Force expanded MapLibre only (compact stays Kakao so the tap layer opens fullscreen).
  await page.addInitScript(({ expandedKey }) => {
    try {
      (
        window as unknown as {
          __PINDMAP_E2E_FORCE_MAPLIBRE__?: boolean;
          __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null;
        }
      ).__PINDMAP_E2E_FORCE_MAPLIBRE__ = true;
      (
        window as unknown as { __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null }
      ).__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
      window.localStorage.setItem(expandedKey, "1");
    } catch {
      /* noop */
    }
  }, { expandedKey: EXPANDED_MAPLIBRE_STORAGE_KEY });
}

async function openExpandedMapLibre(page: Page) {
  await gotoTab(page, "map");
  await expect(page.locator(".kakaoMap.mapCompactMap")).toBeVisible({
    timeout: 45_000,
  });
  const loading = page.locator(".mapCompactLoading");
  if (await loading.isVisible().catch(() => false)) {
    await loading.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => null);
  }
  await page.waitForTimeout(1500);
  await page.locator(".mapCompactTapLayer").click({ force: true });
  const dialog = page.locator('[aria-label="전체 지도"]');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator(".is-maplibre-expanded")).toBeVisible({
    timeout: 60_000,
  });
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

/** Seed one Kakao-shaped hit (localhost often blocks Kakao Places referrer). */
async function injectSearchHit(
  page: Page,
  place: {
    id: string;
    place_name: string;
    y: number;
    x: number;
    category_name?: string;
    address_name?: string;
  },
) {
  await page.evaluate((p) => {
    const api = (
      window as unknown as {
        __PINDMAP_E2E_SEARCH__?: { inject: (places: unknown[]) => void };
      }
    ).__PINDMAP_E2E_SEARCH__;
    if (!api?.inject) throw new Error("E2E search inject missing");
    api.inject([
      {
        id: p.id,
        place_name: p.place_name,
        category_name: p.category_name ?? "음식점 > 한식",
        address_name: p.address_name ?? "",
        road_address_name: p.address_name ?? "",
        y: String(p.y),
        x: String(p.x),
      },
    ]);
  }, place);
  await expect(
    page.locator('[aria-label="전체 지도"] .mapSearchResultsSheetItem'),
  ).toHaveCount(1, { timeout: 10_000 });
}

async function runExpandedSearch(page: Page, query: string) {
  // Prefer live Kakao Places; fall back to inject for localhost referrer blocks.
  const dialog = page.locator('[aria-label="전체 지도"]');
  const input = dialog.locator(
    "input.expandedMapLibreSearchInput, input.mapInput",
  ).first();
  if (await input.isVisible().catch(() => false)) {
    await input.click();
    await input.fill("");
    await input.pressSequentially(query, { delay: 15 });
    await input.press("Enter");
    const n = await dialog
      .locator(".mapSearchResultsSheetItem")
      .count()
      .catch(() => 0);
    if (n > 0) return;
    await page.waitForTimeout(1200);
    if ((await dialog.locator(".mapSearchResultsSheetItem").count()) > 0) return;
  }
  // Deterministic fallback coords (Daegu 함지부대찌개 연봉점 vicinity / Seoul landmarks)
  const fallback: Record<string, { y: number; x: number; name: string }> = {
    "함지부대찌개 연봉점": {
      y: 35.8714,
      x: 128.6014,
      name: "함지부대찌개 연봉점",
    },
    강남역: { y: 37.4979, x: 127.0276, name: "강남역" },
    성수역: { y: 37.5446, x: 127.0559, name: "성수역" },
    홍대입구: { y: 37.5572, x: 126.9254, name: "홍대입구역" },
    망원역: { y: 37.5565, x: 126.9019, name: "망원역" },
    연남동: { y: 37.5662, x: 126.9256, name: "연남동" },
  };
  const hit = fallback[query] ?? {
    y: 37.5665,
    x: 126.978,
    name: query,
  };
  await injectSearchHit(page, {
    id: `e2e-${query}`,
    place_name: hit.name,
    y: hit.y,
    x: hit.x,
  });
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
