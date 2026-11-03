/**
 * Admin expanded MapLibre: tap a basemap place label → place card → close.
 * Covers 상가/가게 (망원 z17), Tour (홍대 z16), station (홍대 z16), plus
 * "tap another place while open" and "move map while open".
 *
 * Requires the admin E2E account (force_maplibre). Writes card screenshots and
 * per-open API/Kakao call counts under e2e/artifacts/d1/.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

const OUT = path.join(process.cwd(), "e2e/artifacts/d1");

type PoiKind = "shop" | "sangga" | "tour" | "landmark" | "park" | "station" | "bus";
type GlDebug = {
  createCount: number;
  findMapPoi?: (kinds: PoiKind[]) => { x: number; y: number; name: string; kind: string } | null;
  jumpToZoom?: (lat: number, lng: number, zoom: number) => void;
};

async function forceMapLibre(page: Page) {
  await page.addInitScript(({ expandedKey }) => {
    try {
      const w = window as unknown as {
        __PINDMAP_E2E_FORCE_MAPLIBRE__?: boolean;
        __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null;
      };
      w.__PINDMAP_E2E_FORCE_MAPLIBRE__ = true;
      w.__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
      window.localStorage.setItem(expandedKey, "1");
    } catch {
      /* noop */
    }
  }, { expandedKey: EXPANDED_MAPLIBRE_STORAGE_KEY });
}

async function openExpandedMapLibre(page: Page) {
  await gotoTab(page, "map");
  await expect(page.locator(".kakaoMap.mapCompactMap")).toBeVisible({ timeout: 45_000 });
  const loading = page.locator(".mapCompactLoading");
  if (await loading.isVisible().catch(() => false)) {
    await loading.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => null);
  }
  await page.waitForTimeout(1500);
  await page.locator(".mapCompactTapLayer").click({ force: true });
  const dialog = page.locator('[aria-label="전체 지도"]');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator(".is-maplibre-expanded")).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__
              ?.createCount ?? 0,
        ),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  return dialog;
}

async function jump(page: Page, lat: number, lng: number, zoom: number) {
  await page.evaluate(
    ({ lat, lng, zoom }) =>
      (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__?.jumpToZoom?.(
        lat,
        lng,
        zoom,
      ),
    { lat, lng, zoom },
  );
}

/** Wait for a rendered label of `kinds`, tap it on screen, return its name + point. */
async function tapPoi(
  page: Page,
  kinds: PoiKind[],
): Promise<{ name: string; px: number; py: number }> {
  let hit: { x: number; y: number; name: string } | null = null;
  await expect
    .poll(
      async () => {
        hit = await page.evaluate(
          (k) =>
            (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__?.findMapPoi?.(
              k,
            ) ?? null,
          kinds,
        );
        return hit ? "found" : "none";
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe("found");
  const box = await page.locator('[aria-label="전체 지도"] .kakaoMap').first().boundingBox();
  if (!box || !hit) throw new Error("map box / poi missing");
  const { x, y, name } = hit as { x: number; y: number; name: string };
  await page.touchscreen.tap(box.x + x, box.y + y);
  return { name, px: box.x + x, py: box.y + y };
}

type CallLog = { name: string; kind: string; apiCalls: number; kakaoCalls: number | null; ms: number | null };

test("map place card: tap → card → other tap → move → close", async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    geolocation: { latitude: 37.5565, longitude: 126.9019 },
    permissions: ["geolocation"],
  });
  await suppressCoachmarks(context);
  const page = await context.newPage();
  await forceMapLibre(page);
  await ensureLoggedIn(page);
  await dismissCoachmarks(page);
  await openExpandedMapLibre(page);

  // E2E account is not the admin user: attach the server-secret e2e token (test-side only).
  const e2eToken = computeMapPreviewE2eToken();
  await page.route("**/api/admin/map-place", (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": e2eToken } }),
  );

  const calls: CallLog[] = [];
  let pending: CallLog | null = null;
  page.on("request", (req) => {
    if (req.url().includes("/api/admin/map-place") && pending) pending.apiCalls += 1;
  });
  page.on("response", async (res) => {
    if (!res.url().includes("/api/admin/map-place") || !pending) return;
    try {
      const j = (await res.json()) as { diag?: { kakaoCalls?: number; ms?: number } };
      pending.kakaoCalls = j.diag?.kakaoCalls ?? null;
      pending.ms = j.diag?.ms ?? null;
    } catch {
      /* ignore */
    }
  });

  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  const openCard = async (kinds: PoiKind[], shot: string) => {
    pending = { name: "", kind: kinds.join("|"), apiCalls: 0, kakaoCalls: null, ms: null };
    const { name, px, py } = await tapPoi(page, kinds);
    pending.name = name;
    const label = card.getByText(name.slice(0, 4)).first();
    if (!(await label.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await page.mouse.click(px, py);
    }
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText(name.slice(0, 4), { timeout: 10_000 });
    await expect(card.locator('[data-testid="map-place-saves"]')).not.toContainText(
      "불러오는 중",
      { timeout: 15_000 },
    );
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, shot) });
    calls.push(pending);
    pending = null;
  };

  // 1) 상가/가게 — 망원 z17
  await jump(page, 37.5565, 126.9019, 17);
  await page.waitForTimeout(4000);
  await openCard(["sangga", "shop"], "card-shop.png");

  // 2) Another place while the card is open — Tour label, 홍대 z15 (z16 Tour band is rank ≤12)
  await jump(page, 37.5572, 126.924, 15);
  await page.waitForTimeout(4000);
  await expect(card, "card stays open while the map moves").toBeVisible();
  await openCard(["tour"], "card-tour.png");

  // 3) Station — back to 홍대 (the previous card panned the camera)
  await jump(page, 37.5572, 126.924, 15);
  await page.waitForTimeout(3000);
  await openCard(["station"], "card-station.png");

  // Close
  await card.getByRole("button", { name: "닫기" }).click();
  await expect(card).toBeHidden({ timeout: 10_000 });

  fs.writeFileSync(path.join(OUT, "card-calls.json"), JSON.stringify(calls, null, 2));
  for (const c of calls) {
    expect(c.apiCalls, `${c.kind}: one detail API call per card open`).toBe(1);
    expect(c.kakaoCalls ?? 0, `${c.kind}: at most one Kakao call per card open`).toBeLessThanOrEqual(1);
  }
  await context.close();
});
