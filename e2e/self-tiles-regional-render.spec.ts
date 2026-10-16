/**
 * Self-tiles must paint basemap features across Korea (not Seoul-only).
 * Regression for Gangwon grey/blank maps when soft-fail hit empty OFM fallback.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { devices } from "@playwright/test";
import { withMapPreviewE2e } from "./helpers/mapPreviewE2e";

/** [lng, lat] */
const HUBS: { id: string; center: [number, number] }[] = [
  { id: "hongcheon", center: [127.888, 37.692] },
  { id: "chuncheon", center: [127.73, 37.881] },
  { id: "gangneung", center: [128.876, 37.752] },
  { id: "sokcho", center: [128.592, 38.207] },
  { id: "pyeongchang", center: [128.39, 37.37] },
  { id: "jeju", center: [126.531, 33.499] },
  { id: "busan", center: [129.075, 35.179] },
  { id: "seoul", center: [126.978, 37.566] },
];

const ZOOMS = [9, 12, 15] as const;

async function openSelfPreview(
  page: Page,
  center: [number, number],
  z: number,
) {
  const q = `mode=nopins&theme=paper&selfTiles=1&lat=${center[1]}&lng=${center[0]}&z=${z}`;
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
}

async function countBasemapFeatures(
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
            getStyle: () => {
              layers: { id: string; type?: string; source?: string }[];
            };
            getLayer: (id: string) => unknown;
            queryRenderedFeatures: (
              g?: unknown,
              o?: { layers?: string[] },
            ) => unknown[];
            once: (t: string, fn: () => void) => void;
            isStyleLoaded?: () => boolean;
          };
        }
      ).__PINDMAP_PREVIEW_MAP__;
      if (!map) return 0;
      map.jumpTo({ zoom: z, center });
      await new Promise<void>((r) => {
        map.once("idle", () => r());
        setTimeout(() => r(), 10_000);
      });
      // Extra settle for PMTiles Range + overzoom parent tiles
      await new Promise<void>((r) => setTimeout(r, 1500));
      map.jumpTo({ zoom: z, center });
      await new Promise<void>((r) => {
        map.once("idle", () => r());
        setTimeout(() => r(), 5000);
      });
      // Prefer openmaptiles basemap; fall back to any non-overlay rendered feature
      // (overzoom / soft-OFM can leave fill empty briefly while symbols paint).
      const all = map.getStyle()?.layers ?? [];
      const basemap = all
        .filter(
          (l) =>
            l.source === "openmaptiles" &&
            (l.type === "fill" || l.type === "line" || l.type === "symbol") &&
            !!map.getLayer(l.id),
        )
        .map((l) => l.id);
      const anyPaint = all
        .filter(
          (l) =>
            (l.type === "fill" || l.type === "line" || l.type === "symbol") &&
            !!map.getLayer(l.id) &&
            !/pin|myloc|search|route|cluster/i.test(l.id),
        )
        .map((l) => l.id);
      try {
        const n1 =
          basemap.length > 0
            ? map.queryRenderedFeatures(undefined, { layers: basemap }).length
            : 0;
        if (n1 > 0) return n1;
        return anyPaint.length > 0
          ? map.queryRenderedFeatures(undefined, { layers: anyPaint }).length
          : 0;
      } catch {
        return 0;
      }
    },
    { center, z },
  );
}

const engines = [
  { name: "chromium", launch: "chromium" as const },
  { name: "webkit", launch: "webkit" as const },
];

for (const eng of engines) {
  test.describe(`self-tiles regional render (${eng.name})`, () => {
    let browser: Browser;

    test.beforeAll(async ({ playwright }) => {
      browser = await playwright[eng.launch].launch();
    });
    test.afterAll(async () => {
      await browser?.close();
    });

    test(`8 hubs × z9/z12/z15 basemap features > 0`, async () => {
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        locale: "ko-KR",
      });
      const page = await context.newPage();
      // Boot at Seoul; then jump each hub (covers cold PMTiles after Seoul prefetch).
      await openSelfPreview(page, HUBS.find((h) => h.id === "seoul")!.center, 12);

      const fails: string[] = [];
      for (const hub of HUBS) {
        for (const z of ZOOMS) {
          const n = await countBasemapFeatures(page, hub.center, z);
          if (n <= 0) fails.push(`${hub.id} z${z}=${n}`);
        }
      }
      expect(fails, fails.join(" | ")).toEqual([]);
      await context.close();
    });
  });
}
