/**
 * WebKit: admin expanded MapLibre search must not create WebGL contexts or lose the map's.
 * Render-time engine gates used to probe WebGL with a fresh, never-released context on every
 * render; iOS WebKit then dropped the oldest live context (the map) → remount → Kakao fallback.
 * Three D-2 searches (type → suggestion → card): 0 new WebGL contexts, 0 webglcontextlost,
 * no map remount, WebGL support probed at most once this session.
 */
import { test, expect, devices, type Browser, type Page } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

type Counters = { webglCreated: number; contextLost: number; probes: number; createCount: number; fallbackCount: number };

const readCounters = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __webglProbe?: { created: number; lost: number };
      __PINDMAP_MAP_GL_GATE__?: { webGlProbes?: () => number };
      __PINDMAP_EXPANDED_GL__?: { createCount?: number; fallbackCount?: number };
    };
    return {
      webglCreated: w.__webglProbe?.created ?? -1,
      contextLost: w.__webglProbe?.lost ?? -1,
      probes: w.__PINDMAP_MAP_GL_GATE__?.webGlProbes?.() ?? -1,
      createCount: w.__PINDMAP_EXPANDED_GL__?.createCount ?? -1,
      fallbackCount: w.__PINDMAP_EXPANDED_GL__?.fallbackCount ?? 0,
    } satisfies Counters;
  });

test.describe("WebGL contexts during admin search (webkit)", () => {
  let browser: Browser;
  test.beforeAll(async ({ playwright }) => {
    browser = await playwright.webkit.launch();
  });
  test.afterAll(async () => {
    await browser?.close();
  });

  test("3 searches: 0 new WebGL contexts, 0 context lost, no remount", async () => {
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      locale: "ko-KR",
      geolocation: { latitude: 37.5563, longitude: 126.9236 },
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
      const probe = { created: 0, lost: 0 };
      w.__webglProbe = probe;
      const orig = HTMLCanvasElement.prototype.getContext;
      const seen = new WeakSet<HTMLCanvasElement>();
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        const ctx = (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
        if (ctx && /webgl/.test(type) && !seen.has(this)) {
          seen.add(this);
          probe.created += 1;
          this.addEventListener("webglcontextlost", () => {
            probe.lost += 1;
          });
        }
        return ctx;
      } as typeof orig;
    }, { k: EXPANDED_MAPLIBRE_STORAGE_KEY });

    await ensureLoggedIn(page);
    await dismissCoachmarks(page);
    await gotoTab(page, "map");
    await expect(page.locator(".kakaoMap.mapCompactMap")).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(1500);
    await page.locator(".mapCompactTapLayer").click({ force: true });
    const dialog = page.locator('[aria-label="전체 지도"]');
    await expect(dialog.locator(".is-maplibre-expanded")).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await readCounters(page)).createCount, { timeout: 60_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(2500);
    const base = await readCounters(page);
    expect(base.probes, "WebGL support probed once (render gates use the cache)").toBe(1);

    const input = dialog.getByTestId("expanded-maplibre-search-input");
    const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
    for (const q of ["스타벅스 홍대", "경복궁", "이디야"]) {
      await input.click();
      await input.fill("");
      await input.pressSequentially(q, { delay: 60 });
      const item = dialog.getByTestId("admin-map-suggest-item").first();
      await expect(item).toBeVisible({ timeout: 15_000 });
      await item.click();
      await expect(card).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(2500);
      await card.getByRole("button", { name: "닫기" }).click();
      await expect(card).toBeHidden({ timeout: 10_000 });
    }
    const after = await readCounters(page);
    console.log("[webgl-contexts]", JSON.stringify({ base, after }));
    expect(after.webglCreated - base.webglCreated, "new WebGL contexts during 3 searches").toBe(0);
    expect(after.contextLost, "webglcontextlost events").toBe(0);
    expect(after.createCount, "expanded map not remounted").toBe(base.createCount);
    expect(after.fallbackCount, "no Kakao fallback").toBe(0);
    expect(after.probes, "WebGL support still probed once").toBe(1);
    await expect(dialog.locator(".is-maplibre-expanded")).toBeVisible();
    await context.close();
  });
});
