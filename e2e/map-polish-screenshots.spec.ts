/**
 * Visual QA screenshots for map polish (paper + selfTiles).
 * Writes under e2e/artifacts/screenshots/.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { withMapPreviewE2e } from "./helpers/mapPreviewE2e";

const OUT = path.join(process.cwd(), "e2e/artifacts/screenshots");

const SHOTS: { file: string; lat: number; lng: number; z: number }[] = [
  { file: "seoul-northwest-z11.png", lat: 37.5663, lng: 126.9015, z: 11 },
  { file: "mangwon-z16.png", lat: 37.556, lng: 126.9055, z: 16 },
  { file: "hongdae-z16.png", lat: 37.5572, lng: 126.924, z: 16 },
  { file: "gangnam-z15.png", lat: 37.4979, lng: 127.0276, z: 15 },
  { file: "gangneung-z12.png", lat: 37.752, lng: 128.876, z: 12 },
  { file: "jeju-z12.png", lat: 33.499, lng: 126.531, z: 12 },
];

test("map polish screenshots + mangwon z16 timing", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const timings: Record<string, number> = {};

  for (const shot of SHOTS) {
    const q = `mode=nopins&theme=paper&selfTiles=1&lat=${shot.lat}&lng=${shot.lng}&z=${shot.z}`;
    const t0 = Date.now();
    await page.goto(withMapPreviewE2e(`/map-preview?${q}`), {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            Boolean(
              (window as unknown as { __PINDMAP_PREVIEW_MAP__?: unknown })
                .__PINDMAP_PREVIEW_MAP__,
            ),
          ),
        { timeout: 90_000 },
      )
      .toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((r) => {
          const map = (
            window as unknown as {
              __PINDMAP_PREVIEW_MAP__?: {
                once: (t: string, fn: () => void) => void;
              };
            }
          ).__PINDMAP_PREVIEW_MAP__;
          if (!map) return r();
          map.once("idle", () => r());
          setTimeout(() => r(), 12_000);
        }),
    );
    // Let deferred shop/landmark labels reveal
    await page.waitForTimeout(800);
    const wallMs = Date.now() - t0;
    const idleMs = await page.evaluate(() => {
      const d = (
        window as unknown as {
          __PINDMAP_PREVIEW_DIAG__?: { idleMs?: number | null };
        }
      ).__PINDMAP_PREVIEW_DIAG__;
      return d?.idleMs ?? null;
    });
    timings[shot.file] = idleMs ?? wallMs;
    await page.locator(".map-preview-gl-canvas, .map-preview-gl-root").first().screenshot({
      path: path.join(OUT, shot.file),
    });
  }

  fs.writeFileSync(
    path.join(OUT, "timings.json"),
    JSON.stringify(timings, null, 2),
  );
  console.log("[screenshots] timings", timings);
  expect(fs.existsSync(path.join(OUT, "mangwon-z16.png"))).toBe(true);
});
