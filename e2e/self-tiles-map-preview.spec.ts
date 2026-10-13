/**
 * Admin self-tiles: MapLibre stays up on soft OFM fallback; camera works.
 * Runs on Chromium + WebKit (iPhone 13 device profile).
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { devices } from "@playwright/test";
import { withMapPreviewE2e } from "./helpers/mapPreviewE2e";

const MANGWON: [number, number] = [126.9019, 37.5565];
const GANGNAM: [number, number] = [127.0276, 37.4979];

async function openSelfPreview(
  page: Page,
  selfTiles: boolean,
  center: [number, number] = MANGWON,
  z = 15,
) {
  const q = selfTiles
    ? `mode=nopins&theme=paper&selfTiles=1&lat=${center[1]}&lng=${center[0]}&z=${z}`
    : `mode=nopins&theme=paper&selfTiles=0&lat=${center[1]}&lng=${center[0]}&z=${z}`;
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
        setTimeout(() => r(), 8000);
      }),
  );
}

async function sourceTiles0(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const map = (
      window as unknown as {
        __PINDMAP_PREVIEW_MAP__?: {
          getSource: (id: string) => { tiles?: string[] } | undefined;
        };
      }
    ).__PINDMAP_PREVIEW_MAP__;
    const src = map?.getSource?.("openmaptiles");
    return src?.tiles?.[0] ?? null;
  });
}

async function jumpAndCountLabels(
  page: Page,
  center: [number, number],
  z: number,
): Promise<number> {
  return page.evaluate(
    async ({ center, z }) => {
      const map = (
        window as unknown as {
          __PINDMAP_PREVIEW_MAP__?: {
            jumpTo: (o: { zoom: number; center: [number, number] }) => void;
            getStyle: () => { layers: { id: string; type: string }[] };
            getLayer: (id: string) => unknown;
            queryRenderedFeatures: (o: { layers: string[] }) => {
              properties?: Record<string, unknown>;
            }[];
            once: (t: string, fn: () => void) => void;
          };
        }
      ).__PINDMAP_PREVIEW_MAP__;
      if (!map) return 0;
      map.jumpTo({ zoom: z, center });
      await new Promise<void>((r) => {
        map.once("idle", () => r());
        setTimeout(() => r(), 6000);
      });
      const layers = map
        .getStyle()
        .layers.filter((l) => l.type === "symbol")
        .map((l) => l.id)
        .filter(
          (id) =>
            /label|poi|shop|landmark|park|place|station|dong|gu|korea_/i.test(
              id,
            ) && !/pin|myloc|search|route|water/i.test(id),
        )
        .filter((id) => !!map.getLayer(id));
      return map
        .queryRenderedFeatures({ layers })
        .map((f) =>
          String(f.properties?.["name:ko"] || f.properties?.name || "").trim(),
        )
        .filter(Boolean).length;
    },
    { center, z },
  );
}

const engines = [
  { name: "chromium", launch: "chromium" as const },
  { name: "webkit", launch: "webkit" as const },
];

for (const eng of engines) {
  test.describe(`self-tiles map-preview (${eng.name})`, () => {
    let browser: Browser;

    test.beforeAll(async ({ playwright }) => {
      browser = await playwright[eng.launch].launch();
    });
    test.afterAll(async () => {
      await browser?.close();
    });

    async function newPage() {
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        locale: "ko-KR",
      });
      return { context, page: await context.newPage() };
    }

    test(`selfTiles=1: pindself source, camera move, soft OFM keeps map`, async () => {
      const { context, page } = await newPage();
      const consoleErrs: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrs.push(m.text().slice(0, 200));
      });
      const failed: string[] = [];
      page.on("requestfailed", (r) => {
        const u = r.url();
        if (u.includes("pmtiles") || u.includes("map-tiles") || u.includes("pindself")) {
          failed.push(`${r.failure()?.errorText}:${u.slice(0, 100)}`);
        }
      });

      await openSelfPreview(page, true, MANGWON, 15);
      const tiles0 = await sourceTiles0(page);
      expect(tiles0, "self source").toContain("pindself://");

      const labelsBefore = await jumpAndCountLabels(page, GANGNAM, 15);
      expect(labelsBefore).toBeGreaterThan(0);

      // Soft-fail to OFM — MapLibre instance must remain
      await page.evaluate(() => {
        (
          window as unknown as {
            __PINDMAP_SELF_TILES_TEST__?: { breakToOfm: () => void };
          }
        ).__PINDMAP_SELF_TILES_TEST__?.breakToOfm();
      });
      await page.waitForTimeout(800);
      const stillMap = await page.evaluate(
        () =>
          !!(window as unknown as { __PINDMAP_PREVIEW_MAP__?: unknown })
            .__PINDMAP_PREVIEW_MAP__,
      );
      expect(stillMap, "MapLibre kept after self→OFM").toBe(true);
      const broken = await page.evaluate(
        () =>
          (
            window as unknown as {
              __PINDMAP_SELF_TILES_TEST__?: { isBroken: () => boolean };
            }
          ).__PINDMAP_SELF_TILES_TEST__?.isBroken() ?? false,
      );
      expect(broken).toBe(true);

      // After OFM switch, camera + labels still work (MapLibre not torn down).
      const labelsAfter = await jumpAndCountLabels(page, GANGNAM, 14);
      expect(labelsAfter).toBeGreaterThan(0);

      const fatal = consoleErrs.filter(
        (e) => /CORS|Failed to fetch|addProtocol|Invalid protocol/i.test(e),
      );
      expect(fatal, fatal.join(" | ")).toEqual([]);
      await context.close();
    });

    test(`selfTiles=0: OFM source, camera move`, async () => {
      const { context, page } = await newPage();
      await openSelfPreview(page, false, MANGWON, 15);
      const tiles0 = await sourceTiles0(page);
      expect(tiles0 == null || /openfreemap|tilejson/i.test(String(tiles0))).toBeTruthy();
      // OFM often uses tilejson url, not tiles[] — accept either
      const ok = await page.evaluate(() => {
        const map = (
          window as unknown as {
            __PINDMAP_PREVIEW_MAP__?: {
              getSource: (id: string) => { tiles?: string[]; url?: string };
            };
          }
        ).__PINDMAP_PREVIEW_MAP__;
        const src = map?.getSource?.("openmaptiles");
        return Boolean(src?.tiles?.[0] || src?.url);
      });
      expect(ok).toBe(true);
      const n = await jumpAndCountLabels(page, GANGNAM, 15);
      expect(n).toBeGreaterThan(0);
      await context.close();
    });
  });
}
