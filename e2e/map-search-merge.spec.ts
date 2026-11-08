/**
 * Admin expanded MapLibre name search = our data + Kakao keyword (parallel, ≤800ms, ranked together).
 * - "지구샵" from 망원: the exact-name shop (Kakao only) ranks first, not our prefix match.
 * - "메가커피": the map is not flown to a far #1; it fits the nearby results only.
 * - "이 지역에서 재검색": hidden after the search, shown after a ≥300m move or a 1-level zoom,
 *   hidden again on tap.
 * Writes e2e/artifacts/search-merge/*.png + timing.json
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureLoggedIn } from "./helpers/login";
import { gotoTab, suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";
import { computeMapPreviewE2eToken } from "./helpers/mapPreviewE2e";

const OUT = path.join(process.cwd(), "e2e/artifacts/search-merge");
const MANGWON = { lat: 37.556, lng: 126.9101 };
const MYEONGDONG = { lat: 37.5636, lng: 126.9827 };

const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ({ fn, args }) => {
      const d = (window as unknown as { __PINDMAP_EXPANDED_GL__?: Record<string, (...a: unknown[]) => unknown> })
        .__PINDMAP_EXPANDED_GL__;
      return (d?.[fn]?.(...args) ?? null) as unknown;
    },
    { fn, args },
  );
const center = async (page: Page) => (await call(page, "getCenter")) as { lat: number; lng: number } | null;
const distM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  111320 * Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180));
const meters = (label: string) => (label.trim().endsWith("km") ? parseFloat(label) * 1000 : parseFloat(label));
const timing = (page: Page) =>
  page.evaluate(() => (window as unknown as { __PINDMAP_SEARCH_TIMING__?: unknown }).__PINDMAP_SEARCH_TIMING__ ?? null);

test("name search merges Kakao; camera fits nearby; 재검색 rule", async ({ browser }) => {
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
  for (const p of ["**/api/admin/map-place", "**/api/admin/map-search", "**/api/admin/map-geocode", "**/api/admin/map-kakao-search"]) {
    await page.route(p, (route) => route.continue({ headers: { ...route.request().headers(), "x-pindmap-e2e": token } }));
  }
  let searchCalls = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/admin/map-search")) searchCalls += 1;
  });
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
  await expect.poll(() => call(page, "searchPinState"), { timeout: 60_000 }).not.toBeNull();
  await call(page, "jumpToZoom", MANGWON.lat, MANGWON.lng, 15);
  await page.waitForTimeout(2500);

  const input = dialog.getByTestId("expanded-maplibre-search-input");
  const sheet = dialog.locator(".mapSearchResultsSheet");
  const rows = sheet.locator(".mapSearchResultsSheetItem");
  const loading = dialog.getByTestId("map-search-loading");
  const research = dialog.getByRole("button", { name: "이 지역에서 재검색" });
  const timings: Record<string, unknown> = {};

  // 1) 지구샵: exact-name shop first (Kakao), within 1km of the search point
  await input.click();
  await input.fill("지구샵");
  await input.press("Enter");
  await expect(sheet).toBeVisible({ timeout: 2_000 }); // opens immediately (loading)
  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  await expect(rows.first().locator(".mapSearchResultsSheetItemName")).toHaveText("지구샵");
  expect(meters(await rows.first().locator(".mapSearchResultsSheetItemDistance").innerText())).toBeLessThan(1000);
  timings["지구샵"] = await timing(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "jiguship.png") });

  // 2) 메가커피 from 망원: camera stays around the search point (no flight to 명동)
  await call(page, "jumpToZoom", MANGWON.lat, MANGWON.lng, 15);
  await page.waitForTimeout(2000);
  await input.click();
  await input.fill("메가커피");
  await input.press("Enter");
  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  await expect(rows.first()).toContainText("메가");
  await page.waitForTimeout(2500);
  const after = await center(page);
  expect(after).not.toBeNull();
  expect(distM(after!, MANGWON), "map stays near the search point").toBeLessThan(2000);
  expect(distM(after!, MYEONGDONG), "not moved to 명동").toBeGreaterThan(4000);
  timings["메가커피"] = await timing(page);
  // D: result pins on top of every layer, other POIs faded while results show
  const pinsShown = (await call(page, "searchPinState")) as { search: number; dimmed: boolean; onTop: boolean };
  expect(pinsShown.search).toBeGreaterThan(0);
  expect(pinsShown.onTop, "result pin layers above all POI / label layers").toBe(true);
  expect(pinsShown.dimmed, "other POIs faded while results show").toBe(true);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: path.join(OUT, "megacoffee.png") });

  // 3) 재검색 rule: hidden right after the search; ≥300m move → shown; tap → hidden + re-search
  await expect(research).toHaveCount(0);
  const c0 = (await center(page))!;
  const lvl = (await call(page, "getLevel")) as number;
  const zoomForLevel = 19 - lvl; // kakaoLevelToMapLibreZoom: same Kakao level, whole zoom
  await call(page, "userMoveTo", c0.lat + 0.0018, c0.lng, zoomForLevel); // ~200m
  await page.waitForTimeout(1500);
  await expect(research).toHaveCount(0);
  await call(page, "userMoveTo", c0.lat + 0.0036, c0.lng, zoomForLevel); // ~400m
  await expect(research).toBeVisible({ timeout: 5_000 });
  const before = searchCalls;
  await research.click();
  await expect(research).toHaveCount(0, { timeout: 2_000 });
  await expect.poll(() => searchCalls, { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(2500);
  // zoom-only change (1 level) → shown
  const c1 = (await center(page))!;
  const l1 = (await call(page, "getLevel")) as number;
  await call(page, "userMoveTo", c1.lat, c1.lng, 19 - l1 - 1);
  await expect(research).toBeVisible({ timeout: 5_000 });

  fs.writeFileSync(path.join(OUT, "timing.json"), JSON.stringify(timings, null, 2));
  console.log("[search-timing]", JSON.stringify(timings));
  await context.close();
});

/**
 * search-fix-2: pins ↔ cards by result id, exact 도로명주소, sort toggle only when it changes
 * something, no external-map buttons on the MapLibre card, 재검색 only after the user's own move.
 */
test("exact address alone + its pin opens it; pin ↔ card by id; 재검색 only on user moves", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    geolocation: { latitude: MANGWON.lat, longitude: MANGWON.lng },
    permissions: ["geolocation"],
  });
  await suppressCoachmarks(context);
  const page = await context.newPage();
  const token = computeMapPreviewE2eToken();
  for (const p of ["**/api/admin/map-place", "**/api/admin/map-search", "**/api/admin/map-geocode", "**/api/admin/map-kakao-search"]) {
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
  await expect.poll(() => call(page, "searchPinState"), { timeout: 60_000 }).not.toBeNull();

  const input = dialog.getByTestId("expanded-maplibre-search-input");
  const sheet = dialog.locator(".mapSearchResultsSheet");
  const rows = sheet.locator(".mapSearchResultsSheetItem");
  const loading = dialog.getByTestId("map-search-loading");
  const card = page.locator('[data-testid="expanded-place-detail-sheet"]');
  const research = dialog.getByRole("button", { name: "이 지역에서 재검색" });
  const mapBox = async () => (await dialog.locator(".kakaoMap").boundingBox())!;
  const pins = () => call(page, "searchPinPoints") as Promise<Array<{ id: string; x: number; y: number }>>;
  const search = async (q: string) => {
    await call(page, "jumpToZoom", MANGWON.lat, MANGWON.lng, 15);
    await page.waitForTimeout(2000);
    await input.click();
    await input.fill(q);
    await input.press("Enter");
    await expect(loading).toHaveCount(0, { timeout: 10_000 });
    await expect(rows.first()).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(2500);
  };
  /** Tap the pin's head (drawn above its tip). */
  const tapPin = async (pin: { x: number; y: number }) => {
    const box = await mapBox();
    await page.touchscreen.tap(box.x + pin.x, box.y + pin.y - 20);
  };

  // 1) 메가커피 (fresh map, no card yet): every pin opens the row it was drawn for; sort toggle
  //    only when the orders differ
  await search("메가커피");
  const freshFitLevel = (await call(page, "getLevel")) as number;
  const sheetTop = (await sheet.boundingBox())!.y - (await mapBox()).y;
  const names = await rows.locator(".mapSearchResultsSheetItemName").allInnerTexts();
  const sort = sheet.getByTestId("map-search-sort");
  const distances = (await rows.locator(".mapSearchResultsSheetItemDistance").allInnerTexts()).map(meters);
  const alreadyByDistance = distances.length === names.length && distances.every((d, i) => i === 0 || d >= distances[i - 1]!);
  if (alreadyByDistance) {
    await expect(sort, "both orders identical → no toggle").toHaveCount(0);
  } else {
    await expect(sort).toBeVisible();
  }
  const placePins = await pins();
  expect(placePins.length).toBeGreaterThan(0);
  const box = await mapBox();
  const visible = placePins.filter(
    (p) =>
      p.x > 30 &&
      p.x < box.width - 30 &&
      p.y > 160 &&
      p.y < sheetTop - 10 &&
      placePins.every((q) => q === p || Math.hypot(q.x - p.x, q.y - p.y) > 44),
  );
  expect(visible.length, "a result pin in the open map area").toBeGreaterThan(0);
  await tapPin(visible[0]!);
  await expect(card).toBeVisible({ timeout: 10_000 });
  // Pins follow the list (정확도순, every 메가커피 row has a point): pin k ↔ row k.
  expect(placePins.length).toBe(names.length);
  const want = names[placePins.indexOf(visible[0]!)]!.trim();
  const cardTitle = (await card.locator(".placeDetailSheetName").first().innerText()).trim();
  expect(want.includes(cardTitle) || cardTitle.includes(want), `pin opened its own row (${placePins.indexOf(visible[0]!)})`).toBe(true);
  // 4) MapLibre card: no 카카오맵 / 네이버 지도 buttons (대중교통 stays)
  await expect(card.getByRole("button", { name: /카카오맵에서 보기|네이버 지도에서 보기/ })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /대중교통/ })).toHaveCount(1);
  // 5) Picking moved the camera: no 재검색 button
  await page.waitForTimeout(2000);
  await expect(research).toHaveCount(0);

  // 5) The user's own move shows it, below the chips (no overlap with 인기 장소 / category chips)
  const c = (await center(page))!;
  const l = (await call(page, "getLevel")) as number;
  await call(page, "userMoveTo", c.lat + 0.0045, c.lng, 19 - l);
  await expect(research).toBeVisible({ timeout: 5_000 });
  const r = (await research.boundingBox())!;
  for (const other of [dialog.getByLabel("인기 장소 레이어"), dialog.getByTestId("admin-map-category-chips")]) {
    if (!(await other.count())) continue;
    const o = (await other.first().boundingBox())!;
    const overlap = r.x < o.x + o.width && o.x < r.x + r.width && r.y < o.y + o.height && o.y < r.y + r.height;
    expect(overlap, "재검색 button clear of the chips").toBe(false);
  }

  // 2) 망원로4길 3: the exact address alone, with its own (house) pin in view above the sheet
  await search("망원로4길 3");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator(".mapSearchResultsSheetItemCategory")).toHaveText("도로명주소");
  const addrPins = await pins();
  expect(addrPins).toHaveLength(1);
  expect(addrPins[0]!.y, "camera brought the pin above the results sheet").toBeLessThan(sheetTop);
  expect(addrPins[0]!.y).toBeGreaterThan(0);
  // Tapping that pin opens that address's card (not some other row)
  const addrName = await rows.first().locator(".mapSearchResultsSheetItemName").innerText();
  await tapPin(addrPins[0]!);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(addrName);
  await expect(card).toContainText("도로명주소");
  await page.waitForTimeout(2000);
  await expect(research, "card camera is the app's move").toHaveCount(0);

  // 3) Search right after a card: the card's bottom inset must not shrink / shift the fit
  await search("메가커피");
  expect((await call(page, "getLevel")) as number, "same fit as with no card before").toBe(freshFitLevel);
  const afterCardPins = await pins();
  const nearPins = afterCardPins.filter((p) => p.y > 0 && p.y < sheetTop);
  expect(nearPins.length, "fitted pins sit in the open map above the sheet").toBeGreaterThan(0);
  const box2 = await mapBox();
  const cy = nearPins.reduce((s, p) => s + p.y, 0) / nearPins.length;
  expect(cy, "fit centred in the open band, not pushed up by a card inset").toBeGreaterThan((108 + sheetTop) / 2 - box2.height * 0.15);
  await context.close();
});
