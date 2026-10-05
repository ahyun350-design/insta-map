import { test, expect, type Page } from "@playwright/test";

type PreviewDiag = {
  loadMs: number | null;
  styleLoadMs: number | null;
  errorCodes: string[];
  layerIds: string[];
  hasSubwaySource: boolean;
  hasAttrib: boolean;
};

type PreviewMap = {
  getZoom: () => number;
  jumpTo: (opts: { zoom?: number; center?: [number, number] }) => void;
  once: (type: string, fn: () => void) => void;
  getLayer: (id: string) => unknown;
  getSource: (id: string) => unknown;
  queryRenderedFeatures: (opts: { layers: string[] }) => unknown[];
};

async function waitPreviewReady(page: Page, timeoutMs = 10_000) {
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __PINDMAP_PREVIEW_DIAG__?: PreviewDiag })
              .__PINDMAP_PREVIEW_DIAG__?.loadMs ?? null,
        ),
      { timeout: timeoutMs },
    )
    .not.toBeNull();
}

async function openPreview(page: Page, path: string) {
  const t0 = Date.now();
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitPreviewReady(page, 10_000);
  const diag = await page.evaluate(
    () =>
      (window as unknown as { __PINDMAP_PREVIEW_DIAG__?: PreviewDiag })
        .__PINDMAP_PREVIEW_DIAG__!,
  );
  const wallMs = Date.now() - t0;
  return { diag, wallMs };
}

const LOAD_THEMES = [
  { path: "/map-preview", label: "default" },
  { path: "/map-preview?theme=paper", label: "paper" },
  { path: "/map-preview?theme=white", label: "white" },
  { path: "/map-preview?theme=neon", label: "neon" },
] as const;

for (const { path, label } of LOAD_THEMES) {
  test(`map-preview load (${label}) within 10s, no map errors`, async ({
    page,
  }) => {
    const { diag, wallMs } = await openPreview(page, path);
    expect(diag.errorCodes, `map errors: ${diag.errorCodes.join(",")}`).toEqual(
      [],
    );
    expect(diag.loadMs).not.toBeNull();
    expect(diag.loadMs!).toBeLessThan(10_000);
    expect(wallMs).toBeLessThan(15_000);
    await expect(page.locator(".map-preview-status")).toHaveCount(0);
    console.log(
      `[map-preview load] ${label}: loadMs=${diag.loadMs} wallMs=${wallMs}`,
    );
  });
}

test("map-preview Hongdae layers at z14 / exit at z16", async ({ page }) => {
  await openPreview(page, "/map-preview");

  await page.getByRole("button", { name: "홍대" }).click();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const map = (
            window as unknown as { __PINDMAP_PREVIEW_MAP__?: PreviewMap }
          ).__PINDMAP_PREVIEW_MAP__;
          if (!map) return null;
          return {
            zoom: map.getZoom(),
            hasLine: !!map.getLayer("subway_overlay_line"),
            hasStation: !!map.getLayer("subway_overlay_station"),
            hasLandmark: !!map.getLayer("landmark_label"),
          };
        }),
      { timeout: 15_000 },
    )
    .toMatchObject({
      hasLine: true,
      hasStation: true,
      hasLandmark: true,
    });

  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    if (Math.abs(map.getZoom() - 14) > 0.2) {
      map.jumpTo({ zoom: 14, center: [126.9236, 37.5563] });
    }
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 2500);
    });
  });

  const z14 = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    return {
      landmark: map.queryRenderedFeatures({ layers: ["landmark_label"] }).length,
      line: map.queryRenderedFeatures({ layers: ["subway_overlay_line"] }).length,
      station: map.queryRenderedFeatures({
        layers: ["subway_overlay_station", "subway_overlay_station_transfer"],
      }).length,
      zoom: map.getZoom(),
    };
  });

  expect(z14.landmark, `z14 landmark_label count=${z14.landmark}`).toBeGreaterThan(
    0,
  );
  expect(z14.line, `z14 subway line count=${z14.line}`).toBeGreaterThan(0);
  expect(z14.station, `z14 station count=${z14.station}`).toBeGreaterThan(0);

  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 16, center: [126.9236, 37.5563] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 3000);
    });
  });

  const z16 = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    return {
      exit: map.queryRenderedFeatures({
        layers: ["subway_overlay_exit", "subway_overlay_exit_bg"],
      }).length,
      zoom: map.getZoom(),
    };
  });

  expect(z16.exit, `z16 exit count=${z16.exit}`).toBeGreaterThan(0);
});

test.skip(
  "public list MapLibre load — no durable fixture list id",
  async () => {
    /* Intentionally skipped: do not hardcode a real user's public list. */
  },
);
