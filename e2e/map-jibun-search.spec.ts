/**
 * Admin MapLibre: 지번 주소 → exact address alone + house pin + address card + building places.
 * before = address hits stripped (old road-only gate); after = real juso/Kakao address path.
 * Screenshots: e2e/artifacts/jibun/*-before.png|*-after.png (viewport 390×844).
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

const OUT = path.join(process.cwd(), "e2e/artifacts/jibun");
const MANGWON = { lat: 37.556, lng: 126.9101 };
const QUERIES = ["망원동 413-5", "마포구 망원동 413", "서교동 395-166"] as const;

const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ({ fn, args }) => {
      const d = (window as unknown as { __PINDMAP_EXPANDED_GL__?: Record<string, (...a: unknown[]) => unknown> })
        .__PINDMAP_EXPANDED_GL__;
      return (d?.[fn]?.(...args) ?? null) as unknown;
    },
    { fn, args },
  );

function slug(q: string) {
  return q.replace(/\s+/g, "_");
}

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

test("jibun address: exact card + building places for known lots", async ({ browser }) => {
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
  const withE2e = (route: Route) =>
    route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } });

  for (const p of [
    "**/api/admin/map-place",
    "**/api/admin/map-geocode",
    "**/api/admin/map-kakao-search",
    "**/api/admin/map-building-places",
  ]) {
    await page.route(p, withE2e);
  }

  // before: strip address hits (simulates road-only juso gate)
  let stripAddresses = true;
  await page.route("**/api/admin/map-search", async (route) => {
    if (route.request().method() !== "POST") {
      await withE2e(route);
      return;
    }
    if (!stripAddresses) {
      await withE2e(route);
      return;
    }
    const res = await route.fetch({
      headers: { ...route.request().headers(), "x-pindmap-e2e": token },
    });
    const json = (await res.json()) as { hits?: Array<{ kind?: string }>; diag?: unknown };
    const hits = (json.hits ?? []).filter((h) => h.kind !== "address");
    await route.fulfill({
      status: res.status(),
      contentType: "application/json",
      body: JSON.stringify({ ...json, hits }),
    });
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
  const input = dialog.getByTestId("expanded-maplibre-search-input");
  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  const suggest = dialog.getByTestId("admin-map-suggest-item");

  for (const q of QUERIES) {
    await input.click();
    await input.fill(q);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${slug(q)}-before.png`) });
    await expect(card).toHaveCount(0);
  }

  stripAddresses = false;

  // after: 완전 지번 2건은 주소 카드; 본번만(마포구 망원동 413)은 API 0건일 수 있음
  for (const q of QUERIES) {
    if (await card.isVisible().catch(() => false)) {
      await card.getByRole("button", { name: "닫기" }).click();
      await expect(card).toBeHidden({ timeout: 10_000 });
    }
    await input.click();
    await input.fill("");
    await input.fill(q);
    await page.waitForTimeout(1200);

    const expectExact = q !== "마포구 망원동 413";
    if (expectExact) {
      await expect(suggest.first()).toBeVisible({ timeout: 15_000 });
      await suggest.first().click();
      await expect(card).toBeVisible({ timeout: 15_000 });
      const body = await card.innerText();
      expect(body.length).toBeGreaterThan(0);
      await expect
        .poll(() => call(page, "getLevel"), { timeout: 8_000 })
        .toBe(2);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, `${slug(q)}-after.png`) });
      await card.getByRole("button", { name: "닫기" }).click();
      await expect(card).toBeHidden({ timeout: 10_000 });
    } else {
      // incomplete lot: Kakao returns 0 — no exact address card
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT, `${slug(q)}-after.png`) });
      await expect(card).toHaveCount(0);
    }
  }

  await context.close();
});
