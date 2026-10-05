import { test, expect } from "@playwright/test";

/**
 * Catches style-validation regressions that leave MapLibre stuck before `load`
 * (e.g. invalid paint props → no TileJSON/tiles, infinite "불러오는 중").
 * MapPreviewClient clears the loading status only from PreviewGlMap onReady (= map `load`).
 */
test("map-preview reaches MapLibre load event", async ({ page }) => {
  const planetOk = page.waitForResponse(
    (res) =>
      /tiles\.openfreemap\.org\/planet(\/|$|\?)/.test(res.url()) &&
      res.status() === 200,
    { timeout: 30_000 },
  );

  const t0 = Date.now();
  await page.goto("/map-preview", { waitUntil: "domcontentloaded" });

  await planetOk;
  await expect(page.locator(".map-preview-status")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 5_000,
  });

  const loadMs = Date.now() - t0;
  expect(loadMs).toBeLessThan(30_000);
});
