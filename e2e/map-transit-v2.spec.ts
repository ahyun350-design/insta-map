/**
 * Admin MapLibre transit v2 UI (mocked publictraffic — 실호출 0 in this spec).
 * Screenshots 390×844 → e2e/artifacts/transit-v2/
 * ① list  ② detail (+ line labels)  ③ stops expanded
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";
import { subwayRefColour } from "../lib/mapSurface/poiCategoryIcons";
import {
  BUS_LINE_COLOUR,
  TRANSIT_FIT_MIN_ZOOM,
  WALK_LINE_COLOUR,
  type TransitRoute,
} from "../lib/mapTransit";

const OUT = path.join(process.cwd(), "e2e/artifacts/transit-v2");
const MANGWON = { lat: 37.556023, lng: 126.910152 };
const NODEUL = { lat: 37.51765, lng: 126.96005, name: "노들섬" };

type GlDebug = {
  createCount: number;
  findMapPoi?: (
    kinds: Array<"shop" | "sangga" | "tour" | "landmark" | "park" | "station" | "bus">,
  ) => { x: number; y: number; name: string; kind: string } | null;
  jumpToZoom?: (lat: number, lng: number, zoom: number) => void;
  getZoom?: () => number;
  getCenter?: () => { lat: number; lng: number } | null;
  project?: (lat: number, lng: number) => { x: number; y: number } | null;
  fitPoints?: (
    pts: Array<{ lat: number; lng: number }>,
    pad?: { top: number; right: number; bottom: number; left: number },
    opts?: { minZoom?: number; maxZoom?: number },
  ) => void;
};

/** Shaped like live 망원→노들섬 (Kakao omits first/last walk — client augments). */
const MOCK_ROUTES: { status: string; routes: TransitRoute[] } = {
  status: "OK",
  routes: [
    {
      type: "BUS_AND_SUBWAY",
      totalTimeSec: 1938,
      transfers: 1,
      walkTimeSec: 268,
      fareWon: 1550,
      vehicles: [
        { type: "일반", name: "6호선" },
        { type: "간선", name: "151" },
      ],
      steps: [
        {
          type: "SUBWAY",
          timeSec: 780,
          distanceM: 6500,
          guidance: "6호선 (망원 > 삼각지(전쟁기념관))",
          stops: [
            { name: "망원" },
            { name: "합정" },
            { name: "상수" },
            { name: "광흥창" },
            { name: "대흥" },
            { name: "공덕" },
            { name: "효창공원앞" },
            { name: "삼각지(전쟁기념관)" },
          ],
          vehicles: [{ type: "일반", name: "6호선" }],
          path: [
            { lat: 37.556, lng: 126.91 },
            { lat: 37.553, lng: 126.913 },
            { lat: 37.55, lng: 126.918 },
            { lat: 37.5499, lng: 126.9205 },
          ],
          colour: subwayRefColour("6"),
        },
        {
          type: "WALKING",
          timeSec: 268,
          distanceM: 179,
          guidance: "삼각지역.전쟁기념관정류장까지 도보로 이동 (9번 출구)",
          stops: [{ name: "삼각지(전쟁기념관)" }, { name: "삼각지역.전쟁기념관" }],
          vehicles: [],
          path: [
            { lat: 37.5499, lng: 126.9205 },
            { lat: 37.5495, lng: 126.921 },
          ],
          colour: WALK_LINE_COLOUR,
        },
        {
          type: "BUS",
          timeSec: 579,
          distanceM: 2565,
          guidance: "간선 150외 13대",
          stops: [
            { name: "삼각지역.전쟁기념관" },
            { name: "용산우체국" },
            { name: "신용산역" },
            { name: "한강대교북단.LG유플러스" },
            { name: "노들섬" },
          ],
          vehicles: [
            { type: "간선", name: "151" },
            { type: "간선", name: "752" },
            { type: "간선", name: "150" },
            { type: "간선", name: "N15(심야)" },
          ],
          path: [
            { lat: 37.5495, lng: 126.921 },
            { lat: 37.535, lng: 126.94 },
            { lat: 37.518, lng: 126.96 },
          ],
          colour: BUS_LINE_COLOUR,
        },
      ],
    },
    {
      type: "SUBWAY",
      totalTimeSec: 2400,
      transfers: 2,
      walkTimeSec: 400,
      fareWon: 1550,
      vehicles: [
        { type: "일반", name: "6호선" },
        { type: "일반", name: "9호선" },
      ],
      steps: [
        {
          type: "SUBWAY",
          timeSec: 900,
          distanceM: 7000,
          guidance: "6호선",
          stops: [{ name: "망원" }, { name: "공덕" }],
          vehicles: [{ type: "일반", name: "6호선" }],
          path: [
            { lat: 37.556, lng: 126.91 },
            { lat: 37.544, lng: 126.951 },
          ],
          colour: subwayRefColour("6"),
        },
        {
          type: "WALKING",
          timeSec: 200,
          distanceM: 120,
          guidance: "환승",
          stops: [],
          vehicles: [],
          path: [
            { lat: 37.544, lng: 126.951 },
            { lat: 37.5438, lng: 126.9512 },
          ],
          colour: WALK_LINE_COLOUR,
        },
        {
          type: "SUBWAY",
          timeSec: 1300,
          distanceM: 5000,
          guidance: "9호선",
          stops: [{ name: "노량진" }, { name: "노들" }],
          vehicles: [{ type: "일반", name: "9호선" }],
          path: [
            { lat: 37.5438, lng: 126.9512 },
            { lat: 37.518, lng: 126.96 },
          ],
          colour: subwayRefColour("9"),
        },
      ],
    },
  ],
};

async function forceMapLibre(page: Page) {
  await page.addInitScript(({ expandedKey }) => {
    const w = window as unknown as {
      __PINDMAP_E2E_FORCE_MAPLIBRE__?: boolean;
      __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null;
    };
    w.__PINDMAP_E2E_FORCE_MAPLIBRE__ = true;
    w.__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
    window.localStorage.setItem(expandedKey, "1");
  }, { expandedKey: EXPANDED_MAPLIBRE_STORAGE_KEY });
}

async function openExpanded(page: Page) {
  await gotoTab(page, "map");
  await expect(page.locator(".kakaoMap.mapCompactMap")).toBeVisible({ timeout: 45_000 });
  const loading = page.locator(".mapCompactLoading");
  if (await loading.isVisible().catch(() => false)) {
    await loading.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => null);
  }
  await page.waitForTimeout(1200);
  await page.locator(".mapCompactTapLayer").click({ force: true });
  const dialog = page.locator('[aria-label="전체 지도"]');
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

test("transit-v2: list / detail / stops expanded", async ({ browser }) => {
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
  await forceMapLibre(page);

  const token = computeMapPreviewE2eToken();
  await page.route("**/api/admin/map-search", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hits: [
          {
            kind: "place",
            id: "landmark:nodeul-e2e",
            source: "landmark",
            name: NODEUL.name,
            branch: null,
            category: "여행",
            address: "서울 용산구 양녕로 445",
            floor: null,
            lat: NODEUL.lat,
            lng: NODEUL.lng,
            distM: 4500,
            score: 100,
          },
        ],
        diag: { ms: 1, dbMs: 1, jusoMs: null, dbError: null, jusoError: null },
      }),
    });
  });
  await page.route("**/api/admin/map-kakao-search", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ hits: [], diag: { ms: 1, error: null } }),
    });
  });
  for (const p of ["**/api/admin/map-place", "**/api/admin/map-geocode"]) {
    await page.route(p, (route) =>
      route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } }),
    );
  }
  await page.route("**/api/admin/map-transit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ROUTES),
    });
  });
  await page.route("**/api/directions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        routes: [{ summary: { duration: 1200, distance: 9000 }, sections: [] }],
      }),
    });
  });
  await page.route("**/api/walk-directions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [MANGWON.lng, MANGWON.lat] },
            properties: { totalTime: 2400, totalDistance: 5200 },
          },
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [MANGWON.lng, MANGWON.lat],
                [NODEUL.lng, NODEUL.lat],
              ],
            },
            properties: {},
          },
        ],
      }),
    });
  });

  page.on("popup", async (p) => {
    await p.close().catch(() => null);
    throw new Error("external Kakao must not open");
  });

  await ensureLoggedIn(page);
  await dismissCoachmarks(page);
  const dialog = await openExpanded(page);

  await page.evaluate(
    ({ lat, lng }) => {
      (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug }).__PINDMAP_EXPANDED_GL__?.jumpToZoom?.(
        lat,
        lng,
        15,
      );
    },
    { lat: MANGWON.lat, lng: MANGWON.lng },
  );
  await page.waitForTimeout(800);

  const input = dialog.getByTestId("expanded-maplibre-search-input");
  await input.click();
  await input.fill(NODEUL.name);
  await input.press("Enter");
  const sheet = dialog.locator(".mapSearchResultsSheet");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await expect(sheet.locator(".mapSearchResultsSheetItem").first()).toContainText(NODEUL.name);
  await sheet.locator(".mapSearchResultsSheetItem").first().click();

  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText(NODEUL.name);
  await card.getByRole("button", { name: /대중교통/ }).click();

  const panel = page.locator('[data-testid="transit-route-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid="transit-route-list"]')).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByTestId("transit-dest-label")).toHaveText(NODEUL.name);
  await expect(panel.getByTestId("transit-mode-walk")).toContainText("분");
  await expect(panel.getByTestId("transit-mode-walk")).not.toContainText("—");
  await expect(panel.locator('[data-testid="transit-ride-line"]').first()).toContainText("노들섬");
  await expect(panel.locator(".transitRouteTimelineSeg.is-walk").first()).toBeVisible();
  // Fit + assert in one poll (survives panel-height refits).
  await expect
    .poll(
      async () => {
        return page.evaluate(
          ({ start, end, edge, minZoom }) => {
            const gl = (window as unknown as { __PINDMAP_EXPANDED_GL__?: GlDebug })
              .__PINDMAP_EXPANDED_GL__;
            const mapEl = document.querySelector<HTMLElement>(
              '[aria-label="전체 지도"] .kakaoMap',
            );
            const panelEl = document.querySelector<HTMLElement>(
              '[data-testid="transit-route-panel"]',
            );
            if (!gl?.project || !gl.getZoom || !gl.fitPoints || !mapEl || !panelEl) {
              return "missing";
            }
            const map = mapEl.getBoundingClientRect();
            const panelRect = panelEl.getBoundingClientRect();
            const left = edge;
            const right = map.width - edge;
            const top = edge;
            const bottom = panelRect.top - map.top - edge;
            if (bottom - top < 120) return `band_${(bottom - top).toFixed(0)}`;

            // Pad from actual panel top (not capped height) so fit matches assert.
            const padBottom = Math.max(edge, Math.round(map.height - bottom));
            gl.fitPoints(
              [
                { lat: start.lat, lng: start.lng },
                { lat: end.lat, lng: end.lng },
              ],
              { top: edge, right: edge, bottom: padBottom, left: edge },
              { minZoom, maxZoom: 16 },
            );

            const zTarget = Math.max(minZoom, 12.05);
            const inArea = (p: { x: number; y: number }) =>
              p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;

            for (let i = 0; i < 6; i++) {
              const s0 = gl.project!(start.lat, start.lng);
              const e0 = gl.project!(end.lat, end.lng);
              if (!s0 || !e0) return "no_project";
              if (inArea(s0) && inArea(e0) && (gl.getZoom?.() ?? 0) >= minZoom) {
                return "ok";
              }
              const c = gl.getCenter?.() ?? {
                lat: (start.lat + end.lat) / 2,
                lng: (start.lng + end.lng) / 2,
              };
              const midY = (s0.y + e0.y) / 2;
              const midX = (s0.x + e0.x) / 2;
              const targetY = (top + bottom) / 2;
              const targetX = (left + right) / 2;
              const z = Math.max(zTarget, gl.getZoom?.() ?? zTarget);
              const mPerPx =
                (156543.03392 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** z;
              // Dampen to avoid overshoot; ↓lat when mid too low; ↑lng when mid too right.
              const gain = 0.55;
              const dLat = (((midY - targetY) * mPerPx) / 111_320) * gain;
              const dLng =
                (((midX - targetX) * mPerPx) /
                  (111_320 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180)))) *
                gain;
              gl.jumpToZoom?.(c.lat - dLat, c.lng + dLng, z);
            }

            const s = gl.project(start.lat, start.lng);
            const e = gl.project(end.lat, end.lng);
            if (!s || !e) return "no_project";
            const z = gl.getZoom();
            if (z < minZoom) return `zoom_${z.toFixed(2)}`;
            if (!inArea(s)) return `start_out_${s.x.toFixed(0)}_${s.y.toFixed(0)}_b${bottom.toFixed(0)}`;
            if (!inArea(e)) return `end_out_${e.x.toFixed(0)}_${e.y.toFixed(0)}_b${bottom.toFixed(0)}`;
            return "ok";
          },
          {
            start: { lat: MANGWON.lat, lng: MANGWON.lng },
            end: { lat: NODEUL.lat, lng: NODEUL.lng },
            edge: 24,
            minZoom: TRANSIT_FIT_MIN_ZOOM,
          },
        );
      },
      { timeout: 15_000, intervals: [350] },
    )
    .toBe("ok");

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "01-list.png") });

  await panel.getByTestId("transit-route-item").first().click();
  await expect(panel.getByTestId("transit-route-detail")).toBeVisible({ timeout: 10_000 });
  await expect(panel).toHaveAttribute("data-detail", "1");
  await expect(panel.getByTestId("transit-detail-steps")).toContainText("망원역 승차");
  await expect(panel.getByTestId("transit-detail-steps")).toContainText("합정 방면");
  await expect(panel.getByTestId("transit-detail-steps")).toContainText("9번 출구");
  await expect(panel.getByTestId("transit-step-clock").first()).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "02-detail.png") });

  await panel.getByTestId("transit-stops-toggle").first().click();
  await expect(panel.getByTestId("transit-stop-list")).toBeVisible();
  await expect(panel.getByTestId("transit-stop-list")).toContainText("합정");
  await expect(panel.getByTestId("transit-stop-list")).not.toContainText("망원");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "03-stops-expanded.png") });

  await context.close();
});
