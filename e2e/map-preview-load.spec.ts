import { test, expect, type Page } from "@playwright/test";
import { withMapPreviewE2e } from "./helpers/mapPreviewE2e";

type PreviewDiag = {
  loadMs: number | null;
  styleLoadMs: number | null;
  jsMs?: number | null;
  createMs?: number | null;
  idleMs?: number | null;
  pinsMs?: number | null;
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
  getLayoutProperty: (id: string, name: string) => unknown;
  getStyle?: () => { layers?: { id: string }[] };
  queryRenderedFeatures: (opts: { layers: string[] }) => unknown[];
  addSource?: (id: string, spec: unknown) => void;
  addLayer?: (spec: unknown) => void;
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
  await page.goto(withMapPreviewE2e(path), { waitUntil: "domcontentloaded" });
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

test("map-preview Hongdae: subway z15, landmark z15+, exit z17", async ({
  page,
}) => {
  await openPreview(page, "/map-preview?mode=nopins&theme=paper");

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
            hasLandmark: (map.getStyle?.()?.layers ?? []).some(
              (l: { id: string }) =>
                l.id === "landmark_label" ||
                l.id.startsWith("landmark_label_") ||
                l.id === "landmark_priority" ||
                l.id.startsWith("landmark_priority_"),
            ),
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
    map.jumpTo({ zoom: 15, center: [126.924, 37.5572] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 3000);
    });
  });

  // Landmarks start at z13–14; poll until tiles/idle expose features (z15 race).
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const map = (
            window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap }
          ).__PINDMAP_PREVIEW_MAP__;
          const landmarkLayers = (map.getStyle?.()?.layers ?? [])
            .map((l: { id: string }) => l.id)
            .filter(
              (id: string) =>
                (id === "landmark_label" ||
                  id.startsWith("landmark_label_") ||
                  id === "landmark_priority" ||
                  id.startsWith("landmark_priority_") ||
                  id.startsWith("korea_landmark") ||
                  id.includes("landmark")) &&
                !!map.getLayer(id),
            );
          const landmark = landmarkLayers.length
            ? map.queryRenderedFeatures({ layers: landmarkLayers }).length
            : 0;
          const line = map.queryRenderedFeatures({
            layers: ["subway_overlay_line"],
          }).length;
          const station = map.queryRenderedFeatures({
            layers: [
              "subway_overlay_station",
              "subway_overlay_station_transfer",
            ],
          }).length;
          const buildingKr = map.getLayer("building_kr_fill")
            ? map.queryRenderedFeatures({ layers: ["building_kr_fill"] }).length
            : 0;
          const buildingOmt = map.getLayer("building")
            ? map.queryRenderedFeatures({ layers: ["building"] }).length
            : 0;
          const building = buildingKr + buildingOmt;
          return landmark > 0 && line > 0 && station > 0 && building > 0
            ? { landmark, line, station, building, buildingKr, zoom: map.getZoom() }
            : null;
        }),
      { timeout: 20_000 },
    )
    .not.toBeNull();

  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 16, center: [126.924, 37.5572] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 3000);
    });
  });

  const z16 = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    const landmarkLayers = (map.getStyle?.()?.layers ?? [])
      .map((l: { id: string }) => l.id)
      .filter(
        (id: string) =>
          (id === "landmark_label" ||
            id.startsWith("landmark_label_") ||
            id === "landmark_priority" ||
            id.startsWith("landmark_priority_")) &&
          !!map.getLayer(id),
      );
    return {
      landmark: landmarkLayers.length
        ? map.queryRenderedFeatures({ layers: landmarkLayers }).length
        : 0,
      zoom: map.getZoom(),
    };
  });
  expect(z16.landmark, `z16 landmark count=${z16.landmark}`).toBeGreaterThan(0);

  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 17, center: [126.924, 37.5572] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 3000);
    });
  });

  const z17 = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    return {
      exit: map.queryRenderedFeatures({
        layers: ["subway_overlay_exit", "subway_overlay_exit_bg"],
      }).length,
      zoom: map.getZoom(),
    };
  });

  expect(z17.exit, `z17 exit count=${z17.exit}`).toBeGreaterThan(0);
});

test("map-preview pins: unclustered count + nationwide singles", async ({
  page,
}) => {
  const N = 40;
  await openPreview(page, `/map-preview?pins=${N}&cluster=1`);

  // Nationwide: at least one unclustered pin outside dense Seoul cluster
  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 6.2, center: [127.8, 36.2] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 3000);
    });
  });
  const nation = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    const layers = ["preview-unclustered", "preview-unclustered-circle"].filter(
      (id) => !!map.getLayer(id),
    );
    const singles = layers.length
      ? map.queryRenderedFeatures({ layers }).length
      : 0;
    const clusters = map.getLayer("preview-clusters")
      ? map.queryRenderedFeatures({ layers: ["preview-clusters"] }).length
      : 0;
    return { singles, clusters, layers };
  });
  expect(
    nation.singles,
    `nationwide singles=${nation.singles} clusters=${nation.clusters}`,
  ).toBeGreaterThan(0);

  // Unclustered zoom over Seoul: expect many individual pins
  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 11.5, center: [126.98, 37.56] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 3000);
    });
  });
  const city = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    const layers = ["preview-unclustered", "preview-unclustered-circle"].filter(
      (id) => !!map.getLayer(id),
    );
    return {
      pins: layers.length ? map.queryRenderedFeatures({ layers }).length : 0,
      hasLayer: layers.length > 0,
    };
  });
  expect(city.hasLayer).toBe(true);
  expect(city.pins, `z11.5 pin features=${city.pins}`).toBeGreaterThan(0);
});

test("map-preview discover-style dots render when added", async ({ page }) => {
  await openPreview(page, "/map-preview");
  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    const srcId = "e2e-discover";
    const layerId = "e2e-discover-circles";
    if (!map.getSource(srcId)) {
      // Mirror admin discover circle layer (compact-discover-circles)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).addSource(srcId, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { n: 5 },
              geometry: { type: "Point", coordinates: [126.9236, 37.5563] },
            },
            {
              type: "Feature",
              properties: { n: 3 },
              geometry: { type: "Point", coordinates: [126.925, 37.558] },
            },
          ],
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).addLayer({
        id: layerId,
        type: "circle",
        source: srcId,
        paint: {
          "circle-radius": 5,
          "circle-color": "#1a2a7a",
          "circle-opacity": 0.85,
        },
      });
    }
    map.jumpTo({ zoom: 14, center: [126.9236, 37.5563] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 2500);
    });
  });
  const n = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    if (!map.getLayer("e2e-discover-circles")) return 0;
    return map.queryRenderedFeatures({ layers: ["e2e-discover-circles"] }).length;
  });
  expect(n).toBeGreaterThan(0);
});

test("map-preview dense pins: 20 all render at z11/z13/z15", async ({
  page,
}) => {
  const N = 20;
  await openPreview(page, `/map-preview?pins=${N}&dense=1&cluster=0`);

  // Confirm overlap layout matches intended a/b (never hide pins; don't steal labels)
  const layout = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = map as any;
    // querySourceFeatures can duplicate across tiles — dedupe by pin id
    const feats = m.querySourceFeatures?.("preview-pins") ?? [];
    const ids = [
      ...new Set(
        feats.map((f: { properties?: { id?: string } }) =>
          String(f.properties?.id ?? ""),
        ),
      ),
    ].filter((id): id is string => Boolean(id));
    return {
      allowOverlap: m.getLayoutProperty?.(
        "preview-unclustered",
        "icon-allow-overlap",
      ),
      ignorePlacement: m.getLayoutProperty?.(
        "preview-unclustered",
        "icon-ignore-placement",
      ),
      sourceCount: ids.length,
      denseIds: ids.filter((id) => id.startsWith("dense-")).length,
    };
  });
  expect(layout.allowOverlap).toBe(true);
  expect(layout.ignorePlacement).toBe(true);
  expect(layout.sourceCount, "dense source feature count").toBe(N);
  expect(layout.denseIds, "dense-* pin ids").toBe(N);

  for (const zoom of [11, 13, 15]) {
    const counted = await page.evaluate(async (z) => {
      const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
        .__PINDMAP_PREVIEW_MAP__;
      map.jumpTo({ zoom: z, center: [126.9235, 37.556] });
      await new Promise<void>((resolve) => {
        map.once("idle", () => resolve());
        window.setTimeout(() => resolve(), 4000);
      });
      // Second idle pass — icons may resolve after first paint
      await new Promise<void>((resolve) => {
        map.once("idle", () => resolve());
        window.setTimeout(() => resolve(), 1500);
      });
      const layers = [
        "preview-unclustered",
        "preview-unclustered-circle",
      ].filter((id) => !!map.getLayer(id));
      if (!layers.length) return 0;
      const feats = map.queryRenderedFeatures({ layers });
      const ids = new Set(
        feats.map((f) =>
          String(
            (f as { properties?: { id?: string } }).properties?.id ?? "",
          ),
        ),
      );
      ids.delete("");
      return ids.size;
    }, zoom);
    expect(counted, `dense pins at z${zoom}`).toBe(N);
  }
});

test("map-preview public-list probe: style fail → Kakao engine", async ({
  page,
}) => {
  // Bundled liberty no longer fetches openfreemap style JSON — forceStyleFail
  // exercises the same style_error → Kakao path (tile soft-fail stays on MapLibre).
  await page.goto(
    withMapPreviewE2e("/map-preview?probe=public-list&forceStyleFail=1"),
    { waitUntil: "domcontentloaded" },
  );

  const probe = page.getByTestId("public-list-gl-probe");
  await expect(probe).toBeVisible({ timeout: 15_000 });
  await expect(probe).toHaveAttribute("data-map-engine", "kakao", {
    timeout: 12_000,
  });
  // Kakao host mounts (SDK may still be loading; engine switch is the contract)
  await expect(page.getByTestId("public-list-share-map")).toBeVisible({
    timeout: 10_000,
  });
});

for (const routeTheme of ["dark", "paper"] as const) {
  test(`map-preview route=walk routeTheme=${routeTheme}: load + route line`, async ({
    page,
  }) => {
    const { diag } = await openPreview(
      page,
      `/map-preview?route=walk&routeTheme=${routeTheme}&mode=nopins`,
    );
    expect(diag.loadMs).not.toBeNull();
    expect(diag.errorCodes.length).toBe(0);
    const route = await page.evaluate(() => {
      const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
        .__PINDMAP_PREVIEW_MAP__;
      const hasLine = !!map.getLayer("preview-route-line");
      const feats = hasLine
        ? map.queryRenderedFeatures({ layers: ["preview-route-line"] }).length
        : 0;
      return { hasLine, feats };
    });
    expect(route.hasLine).toBe(true);
    expect(route.feats, `routeTheme=${routeTheme} rendered line features`).toBeGreaterThan(
      0,
    );
  });
}

test("map-preview nationwide z6–7: metro + ≥10 city labels", async ({
  page,
}) => {
  const { diag } = await openPreview(page, "/map-preview?mode=nopins");
  expect(diag.errorCodes, `pre-jump errors: ${diag.errorCodes.join(",")}`).toEqual(
    [],
  );

  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 6.5, center: [127.7, 36.4] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 4000);
    });
  });

  const result = await page.evaluate(() => {
    const w = window as unknown as {
      __PINDMAP_PREVIEW_MAP__: PreviewMap;
      __PINDMAP_PREVIEW_DIAG__?: PreviewDiag;
    };
    const map = w.__PINDMAP_PREVIEW_MAP__;
    const layerIds = [
      "label_city",
      "label_town",
      "label_city_other_ko",
      "label_town_all_ko",
      "label_korea_place_si",
      "label_state",
    ].filter((id) => !!map.getLayer(id));
    const feats = layerIds.length
      ? map.queryRenderedFeatures({ layers: layerIds })
      : [];
    const texts = feats.map((f) => {
      const p = (f as { properties?: Record<string, unknown> }).properties ?? {};
      return String(p["name:ko"] ?? p.name ?? "");
    });
    const unique = [...new Set(texts.filter(Boolean))];
    const hasSeoul = unique.some(
      (t) => t === "서울" || t === "서울특별시" || t.includes("서울"),
    );
    return {
      hasSeoul,
      uniqueCount: unique.length,
      texts: unique.slice(0, 30),
      layers: layerIds,
      errorCodes: w.__PINDMAP_PREVIEW_DIAG__?.errorCodes ?? [],
      zoom: map.getZoom(),
    };
  });

  expect(result.errorCodes, `z6.5 map errors: ${result.errorCodes.join(",")}`).toEqual(
    [],
  );
  expect(
    result.hasSeoul,
    `Seoul label missing at z${result.zoom}; sample=${result.texts.join("|")}`,
  ).toBe(true);
  expect(
    result.uniqueCount,
    `expected ≥10 city/place labels at z${result.zoom}; got ${result.uniqueCount}: ${result.texts.join("|")}`,
  ).toBeGreaterThanOrEqual(10);
});

test("map-preview Seoul z10.5: ≥20 gu labels", async ({ page }) => {
  await openPreview(page, "/map-preview?mode=nopins");
  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 10.5, center: [126.98, 37.56] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 4000);
    });
  });

  const result = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    const layerIds = [
      "label_korea_gu_overlay",
      "label_borough_ko",
    ].filter((id) => !!map.getLayer(id));
    const feats = layerIds.length
      ? map.queryRenderedFeatures({ layers: layerIds })
      : [];
    const texts = [
      ...new Set(
        feats.map((f) => {
          const p =
            (f as { properties?: Record<string, unknown> }).properties ?? {};
          return String(p.name ?? p["name:ko"] ?? "");
        }).filter(Boolean),
      ),
    ];
    return { count: texts.length, texts: texts.slice(0, 40), zoom: map.getZoom() };
  });

  expect(
    result.count,
    `expected ≥20 gu labels at z${result.zoom}; got ${result.count}: ${result.texts.join("|")}`,
  ).toBeGreaterThanOrEqual(20);
});

test("map-preview mid-zoom place labels: Mapo/Gangnam × z11–13", async ({
  page,
}) => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const outDir = path.join(process.cwd(), "e2e/artifacts");
  fs.mkdirSync(outDir, { recursive: true });

  await openPreview(page, "/map-preview?mode=nopins&theme=paper");
  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 12, center: [126.9015, 37.5663] });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 5000));
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 3000);
    });
  });

  const hubs: Array<{
    id: "mapo" | "gangnam";
    center: [number, number];
  }> = [
    { id: "mapo", center: [126.9015, 37.5663] },
    { id: "gangnam", center: [127.0276, 37.4979] },
  ];
  // Kakao-like: ~30–50 names/screen after zoom-split filters (no overlap).
  // Floors keep mid-zoom from going barren; ceilings match collision-limited counts.
  const targets: Record<number, { totalMin: number; totalMax: number }> = {
    11: { totalMin: 12, totalMax: 35 },
    12: { totalMin: 15, totalMax: 40 },
    13: { totalMin: 12, totalMax: 40 },
  };
  // Liberty highway-name / shield layers must stay hidden (C-4 uses road_name_* instead).
  const roadIds = [
    "highway-name-path",
    "highway-name-minor",
    "highway-name-major",
    "highway-shield-non-us",
    "highway-shield-us-interstate",
    "road_shield_us",
    "label_bridge_ko",
  ];

  async function measureMid(zoom: number, center: [number, number]) {
    await page.evaluate(
      async ({ z, center: c }) => {
        const map = (
          window as unknown as {
            __PINDMAP_PREVIEW_MAP__: PreviewMap & {
              areTilesLoaded?: () => boolean;
              loaded?: () => boolean;
            };
          }
        ).__PINDMAP_PREVIEW_MAP__;
        const sleep = (ms: number) =>
          new Promise<void>((resolve) => window.setTimeout(resolve, ms));
        const waitReady = async (budgetMs: number) => {
          const t0 = Date.now();
          while (Date.now() - t0 < budgetMs) {
            const tilesOk =
              typeof map.areTilesLoaded === "function"
                ? map.areTilesLoaded()
                : true;
            if (tilesOk && (typeof map.loaded !== "function" || map.loaded())) {
              await new Promise<void>((resolve) => {
                map.once("idle", () => resolve());
                window.setTimeout(() => resolve(), 800);
              });
              return;
            }
            await sleep(200);
          }
        };
        map.jumpTo({ zoom: z, center: c });
        await waitReady(8000);
        await sleep(2500);
        map.jumpTo({ zoom: z, center: c });
        await waitReady(5000);
        await sleep(2000);
      },
      { z: zoom, center },
    );
    return page.evaluate((roads) => {
      const map = (
        window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap }
      ).__PINDMAP_PREVIEW_MAP__;
      const style = (
        map as unknown as { getStyle?: () => { layers?: { id: string }[] } }
      ).getStyle?.();
      const layerIds = (style?.layers ?? []).map((l) => l.id);
      const present = (ids: string[]) => ids.filter((id) => !!map.getLayer(id));
      const countUnique = (ids: string[]) => {
        const layers = present(ids);
        if (!layers.length) return 0;
        const feats = map.queryRenderedFeatures({ layers });
        const seen = new Set<string>();
        for (const f of feats) {
          const p =
            (f as { properties?: Record<string, unknown> }).properties ?? {};
          const name = String(p["name:ko"] || p.name || "").trim();
          if (!name) continue;
          seen.add(name);
        }
        return seen.size;
      };
      const gu = countUnique([
        "label_korea_gu_overlay",
        "label_borough_ko",
      ]);
      const dong = countUnique([
        ...layerIds.filter(
          (id) =>
            id === "label_suburb_ko" ||
            id.startsWith("label_suburb_ko_") ||
            id === "label_dong_major_ko" ||
            id.startsWith("label_dong_major_ko_") ||
            id === "label_dong_ko" ||
            id === "label_korea_dong_overlay" ||
            id.startsWith("label_korea_dong_overlay_"),
        ),
      ]);
      const station = countUnique(["poi_transit", "poi_transit_mid"]);
      const landmark = countUnique([
        ...layerIds.filter(
          (id) =>
            id === "landmark_label" ||
            id.startsWith("landmark_label_") ||
            id === "landmark_priority" ||
            id.startsWith("landmark_priority_") ||
            id === "label_korea_landmark_overlay" ||
            id.startsWith("label_korea_landmark_overlay_") ||
            id === "label_park" ||
            id === "park_label",
        ),
        // korea_landmark_tier* intentionally excluded from mid-zoom total budget
      ].filter((id) => !id.startsWith("korea_landmark_tier")));
      const mountain = countUnique([
        ...layerIds.filter(
          (id) =>
            id === "label_korea_mountain_overlay" ||
            id.startsWith("label_korea_mountain_overlay_") ||
            ((id.includes("mountain") || id.includes("peak")) &&
              !id.startsWith("landcover")),
        ),
      ]);
      const roadPresent = roads.filter((id) => !!map.getLayer(id));
      const roadNames = roadPresent.length
        ? map.queryRenderedFeatures({ layers: roadPresent }).length
        : 0;
      const total = gu + dong + station + landmark + mountain;
      return {
        gu,
        dong,
        station,
        landmark,
        mountain,
        total,
        roadNames,
        zoom: map.getZoom(),
      };
    }, roadIds);
  }

  const rows: string[] = [];
  for (const hub of hubs) {
    for (const z of [11, 12, 13] as const) {
      const m = await measureMid(z, hub.center);
      const t = targets[z];
      expect(
        m.roadNames,
        `${hub.id} z${z} Liberty highway-name/shield labels must stay 0`,
      ).toBe(0);
      expect(
        m.total,
        `${hub.id} z${z} total ${t.totalMin}–${t.totalMax}, got ${m.total} (gu=${m.gu} dong=${m.dong} st=${m.station} lm=${m.landmark} mt=${m.mountain})`,
      ).toBeGreaterThanOrEqual(t.totalMin);
      expect(
        m.total,
        `${hub.id} z${z} total ${t.totalMin}–${t.totalMax}, got ${m.total} (gu=${m.gu} dong=${m.dong} st=${m.station} lm=${m.landmark} mt=${m.mountain})`,
      ).toBeLessThanOrEqual(t.totalMax);
      rows.push(
        `${hub.id} z${z}: total=${m.total} gu=${m.gu} dong=${m.dong} st=${m.station} lm=${m.landmark} mt=${m.mountain}`,
      );
    }
  }

  for (const hub of hubs) {
    for (const z of [11, 12, 13] as const) {
      await page.evaluate(
        async ({ z, center: c }) => {
          const map = (
            window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap }
          ).__PINDMAP_PREVIEW_MAP__;
          map.jumpTo({ zoom: z, center: c });
          await new Promise<void>((resolve) => {
            map.once("idle", () => resolve());
            window.setTimeout(() => resolve(), 3500);
          });
        },
        { z, center: hub.center },
      );
      await page.screenshot({
        path: path.join(outDir, `midzoom-z${z}-${hub.id}.png`),
        fullPage: false,
      });
    }
  }

  console.log(`[midzoom] ${rows.join(" | ")}`);
});

test("map-preview place-name density: 3 hubs × z14–17", async ({ page }) => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const outDir = path.join(process.cwd(), "e2e/artifacts");
  fs.mkdirSync(outDir, { recursive: true });

  await openPreview(page, "/map-preview?mode=nopins&theme=paper");
  // Warm tiles/glyphs at first hub before counting (idle can fire before POI tiles arrive)
  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 17, center: [126.9055, 37.556] });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 5000));
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 3000);
    });
  });

  const hubs: Array<{
    id: "mangwon" | "hongdae" | "gangnam";
    center: [number, number];
  }> = [
    { id: "mangwon", center: [126.9055, 37.556] },
    { id: "hongdae", center: [126.924, 37.5572] },
    { id: "gangnam", center: [127.0276, 37.4979] },
  ];
  // Liberty highway-name / shield layers must stay hidden (C-4 uses road_name_*).
  const roadIds = [
    "highway-name-path",
    "highway-name-minor",
    "highway-name-major",
    "highway-shield-non-us",
    "highway-shield-us-interstate",
    "road_shield_us",
    "label_bridge_ko",
  ];
  // Kakao-like street density; apt complexes share the budget with shops.
  const targets: Record<
    number,
    { totalMin: number; totalMax: number; shopMin: number }
  > = {
    14: { totalMin: 20, totalMax: 75, shopMin: 6 },
    15: { totalMin: 25, totalMax: 80, shopMin: 12 },
    // z16: Kakao-like ≤50 labels/viewport after road names + shop band split.
    16: { totalMin: 28, totalMax: 50, shopMin: 14 },
    // z17: Bold Hangul + left/right binding; restore pre-relaxation Kakao-like floors.
    17: { totalMin: 20, totalMax: 80, shopMin: 14 },
  };

  async function measureAt(zoom: number, center: [number, number]) {
    await page.evaluate(
      async ({ z, center: c }) => {
        const map = (
          window as unknown as {
            __PINDMAP_PREVIEW_MAP__: PreviewMap & {
              areTilesLoaded?: () => boolean;
              loaded?: () => boolean;
            };
          }
        ).__PINDMAP_PREVIEW_MAP__;
        const sleep = (ms: number) =>
          new Promise<void>((resolve) => window.setTimeout(resolve, ms));
        const waitReady = async (budgetMs: number) => {
          const t0 = Date.now();
          while (Date.now() - t0 < budgetMs) {
            const tilesOk =
              typeof map.areTilesLoaded === "function"
                ? map.areTilesLoaded()
                : true;
            if (tilesOk && (typeof map.loaded !== "function" || map.loaded())) {
              await new Promise<void>((resolve) => {
                map.once("idle", () => resolve());
                window.setTimeout(() => resolve(), 800);
              });
              return;
            }
            await sleep(200);
          }
        };
        map.jumpTo({ zoom: z, center: c });
        await waitReady(8000);
        await sleep(2500);
        map.jumpTo({ zoom: z, center: c });
        await waitReady(5000);
        await sleep(2000);
      },
      { z: zoom, center },
    );
    return page.evaluate((roads) => {
      const map = (
        window as unknown as {
          __PINDMAP_PREVIEW_MAP__: PreviewMap & {
            querySourceFeatures?: (
              source: string,
              opts: { sourceLayer: string },
            ) => Array<{ properties?: Record<string, unknown> | null }>;
            project?: (lngLat: [number, number]) => { x: number; y: number };
          };
        }
      ).__PINDMAP_PREVIEW_MAP__;
      const style = (
        map as unknown as { getStyle?: () => { layers?: { id: string }[] } }
      ).getStyle?.();
      const layerIds = (style?.layers ?? []).map((l) => l.id);
      const shopLayers = layerIds.filter(
        (id) =>
          id.startsWith("shop_poi_label") ||
          id.startsWith("sangga_shop_label_"),
      );
      const shop = shopLayers.length
        ? map.queryRenderedFeatures({ layers: shopLayers })
        : [];
      const landmarkLayers = layerIds.filter(
        (id) =>
          id === "landmark_label" ||
          id.startsWith("landmark_label_") ||
          id === "landmark_priority" ||
          id.startsWith("landmark_priority_") ||
          id === "label_korea_landmark_overlay" ||
          id.startsWith("label_korea_landmark_overlay_"),
      );
      const landmark = landmarkLayers.length
        ? map.queryRenderedFeatures({ layers: landmarkLayers })
        : [];
      const aptLayers = layerIds.filter(
        (id) =>
          id === "apt_complex_label" ||
          id === "apt_complex_label_small" ||
          id === "named_building_label",
      );
      const apt = aptLayers.length
        ? map.queryRenderedFeatures({ layers: aptLayers })
        : [];
      const station = map.getLayer("poi_transit")
        ? map.queryRenderedFeatures({ layers: ["poi_transit"] })
        : [];
      const roadPresent = roads.filter((id) => !!map.getLayer(id));
      const roadFeats = roadPresent.length
        ? map.queryRenderedFeatures({ layers: roadPresent })
        : [];
      const namelessShop = (
        shop as Array<{ properties?: Record<string, unknown> | null }>
      ).filter((f) => {
        const n = String(
          f.properties?.["name:ko"] || f.properties?.name || "",
        ).trim();
        return !n;
      }).length;

      // z17 coverage: priority 3–5 shop classes in viewport (not all retail)
      let shopCandidates = 0;
      if (map.querySourceFeatures && map.project) {
        const feats = map.querySourceFeatures("openmaptiles", {
          sourceLayer: "poi",
        });
        const pri = new Set([
          "cafe",
          "restaurant",
          "fast_food",
          "bakery",
          "bar",
          "beer",
          "bank",
          "pharmacy",
          "mall",
          "cinema",
          "theatre",
          "theater",
          "hotel",
          "lodging",
          "department_store",
        ]);
        const seen = new Set<string>();
        for (const f of feats) {
          const p = f.properties ?? {};
          const cls = String(p.class ?? "");
          const sub = String(p.subclass ?? "");
          const isConv = cls === "shop" && sub === "convenience";
          const isSuper = cls === "grocery" && sub === "supermarket";
          if (!pri.has(cls) && !isConv && !isSuper) continue;
          const rank = Number(p.rank ?? 999);
          if (rank > 80) continue;
          const name = String(p["name:ko"] || p.name || "").trim();
          if (!name) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const g = (f as any).geometry;
          if (!g || g.type !== "Point") continue;
          const [lng, lat] = g.coordinates as [number, number];
          const pt = map.project!([lng, lat]);
          if (pt.x < 0 || pt.y < 0 || pt.x > 390 || pt.y > 844) continue;
          const key = `${name}|${lng.toFixed(5)}|${lat.toFixed(5)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          shopCandidates += 1;
        }
      }

      // All visible symbol text labels (Kakao-like density budget includes roads/parks/tour).
      const uniqueNames = new Set<string>();
      let labelFeat = 0;
      for (const id of layerIds) {
        if (!map.getLayer(id)) continue;
        if ((map.getLayoutProperty(id, "visibility") ?? "visible") === "none") {
          continue;
        }
        const layerType = (
          style?.layers as Array<{ id: string; type?: string }> | undefined
        )?.find((l) => l.id === id)?.type;
        if (layerType !== "symbol") continue;
        if (/pin|myloc|search|route|cluster|unclustered/i.test(id)) continue;
        try {
          const feats = map.queryRenderedFeatures({ layers: [id] });
          labelFeat += feats.length;
          for (const f of feats as Array<{
            properties?: Record<string, unknown> | null;
          }>) {
            const n = String(
              f.properties?.["name:ko"] ||
                f.properties?.["name:nonlatin"] ||
                f.properties?.name ||
                "",
            ).trim();
            if (n) uniqueNames.add(n);
          }
        } catch {
          /* ignore */
        }
      }

      return {
        shopCount: shop.length,
        landmarkCount: landmark.length,
        stationCount: station.length,
        aptCount: apt.length,
        total: shop.length + landmark.length + station.length + apt.length,
        labelUnique: uniqueNames.size,
        labelFeat,
        roadNames: roadFeats.length,
        namelessShop,
        shopCandidates,
        zoom: map.getZoom(),
        iconSize: shopLayers[0]
          ? map.getLayoutProperty(shopLayers[0], "icon-size")
          : null,
      };
    }, roadIds);
  }

  async function shot(
    zoom: number,
    place: "mangwon" | "hongdae" | "gangnam",
    center: [number, number],
  ) {
    await page.evaluate(
      async ({ z, center: c }) => {
        const map = (
          window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap }
        ).__PINDMAP_PREVIEW_MAP__;
        map.jumpTo({ zoom: z, center: c });
        await new Promise<void>((resolve) => {
          map.once("idle", () => resolve());
          window.setTimeout(() => resolve(), 3500);
        });
      },
      { z: zoom, center },
    );
    await page.screenshot({
      path: path.join(outDir, `density-z${zoom}-${place}.png`),
      fullPage: false,
    });
  }

  const rows: string[] = [];
  for (const hub of hubs) {
    for (const z of [14, 15, 16, 17] as const) {
      const m = await measureAt(z, hub.center);
      const t = targets[z];
      expect(
        m.roadNames,
        `${hub.id} z${z} Liberty highway-name/shield labels must stay 0`,
      ).toBe(0);
      expect(
        m.namelessShop,
        `${hub.id} z${z} nameless shops must be 0`,
      ).toBe(0);
      expect(
        m.shopCount,
        `${hub.id} z${z} shops ≥${t.shopMin}, got ${m.shopCount}`,
      ).toBeGreaterThanOrEqual(t.shopMin);
      expect(
        m.total,
        `${hub.id} z${z} total ${t.totalMin}–${t.totalMax}, got ${m.total} (shop=${m.shopCount} lm=${m.landmarkCount} st=${m.stationCount} apt=${m.aptCount})`,
      ).toBeGreaterThanOrEqual(t.totalMin);
      expect(
        m.total,
        `${hub.id} z${z} total ${t.totalMin}–${t.totalMax}, got ${m.total} (shop=${m.shopCount} lm=${m.landmarkCount} st=${m.stationCount} apt=${m.aptCount})`,
      ).toBeLessThanOrEqual(t.totalMax);
      if (z === 16) {
        expect(
          m.labelUnique,
          `${hub.id} z16 viewport labels ≤50 (unique), got ${m.labelUnique} feat=${m.labelFeat}`,
        ).toBeLessThanOrEqual(50);
      }
      if (z === 17 && m.shopCandidates > 0) {
        const coverage =
          m.shopCandidates <= m.shopCount
            ? 1
            : m.shopCount / m.shopCandidates;
        expect(
          coverage,
          `${hub.id} z17 shop coverage ≥70% (shop=${m.shopCount} cand=${m.shopCandidates})`,
        ).toBeGreaterThanOrEqual(0.7);
      }
      rows.push(
        `${hub.id} z${z}: total=${m.total} shop=${m.shopCount} lm=${m.landmarkCount} st=${m.stationCount} cand=${m.shopCandidates} icon=${m.iconSize}`,
      );
    }
  }

  for (const hub of hubs) {
    for (const z of [14, 15, 16] as const) {
      await shot(z, hub.id, hub.center);
    }
  }

  // Hongdae still shows subway + buildings at street zoom
  const hz15 = await measureAt(15, hubs[1].center);
  const hz15Extra = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    const kr = map.getLayer("building_kr_fill")
      ? map.queryRenderedFeatures({ layers: ["building_kr_fill"] }).length
      : 0;
    const omt = map.getLayer("building")
      ? map.queryRenderedFeatures({ layers: ["building"] }).length
      : 0;
    return {
      subway: map.getLayer("subway_overlay_line")
        ? map.queryRenderedFeatures({ layers: ["subway_overlay_line"] }).length
        : 0,
      building: kr + omt,
      buildingKr: kr,
    };
  });
  expect(hz15Extra.subway).toBeGreaterThanOrEqual(1);
  expect(hz15Extra.building).toBeGreaterThanOrEqual(1);
  expect(hz15.roadNames).toBe(0);

  // Mangwon z17–z18: building_kr overzoom must stay > 0 (archive maxzoom 16).
  for (const z of [17, 18] as const) {
    await page.evaluate(async (zoom) => {
      const map = (
        window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap }
      ).__PINDMAP_PREVIEW_MAP__;
      map.jumpTo({ zoom, center: [126.9055, 37.556] });
      await new Promise<void>((resolve) => {
        map.once("idle", () => resolve());
        window.setTimeout(() => resolve(), 7000);
      });
    }, z);
    await page.waitForTimeout(1500);
    const kr = await page.evaluate(() => {
      const map = (
        window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap }
      ).__PINDMAP_PREVIEW_MAP__;
      return {
        zoom: map.getZoom(),
        kr: map.getLayer("building_kr_fill")
          ? map.queryRenderedFeatures({ layers: ["building_kr_fill"] }).length
          : 0,
        omt: map.getLayer("building")
          ? map.queryRenderedFeatures({ layers: ["building"] }).length
          : 0,
        srcMax: (
          map.getSource("korea_buildings") as { maxzoom?: number } | undefined
        )?.maxzoom,
      };
    });
    expect(
      kr.kr,
      `mangwon z${z} building_kr_fill > 0 (got ${kr.kr}, omt=${kr.omt}, srcMax=${kr.srcMax})`,
    ).toBeGreaterThan(0);
    expect(kr.srcMax, "korea_buildings source maxzoom").toBe(16);
  }

  // Same houseno centroid z16 vs z18 must stay within 5m (native overzoom, not bad clamp).
  {
    const geo = await page.evaluate(async () => {
      const map = (
        window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap }
      ).__PINDMAP_PREVIEW_MAP__;

      function ringCentroid(ring: number[][]): [number, number] {
        const n = ring.length > 1 ? ring.length - 1 : ring.length;
        let sx = 0,
          sy = 0;
        for (let i = 0; i < n; i++) {
          sx += ring[i][0];
          sy += ring[i][1];
        }
        return [sx / n, sy / n];
      }

      function featureCentroid(f: {
        geometry?: {
          type?: string;
          coordinates?: unknown;
        };
      }): { lng: number; lat: number } | null {
        const g = f.geometry;
        if (!g) return null;
        let ring: number[][] | null = null;
        if (g.type === "Polygon") {
          ring = (g.coordinates as number[][][])[0] ?? null;
        } else if (g.type === "MultiPolygon") {
          ring = (g.coordinates as number[][][][])[0]?.[0] ?? null;
        }
        if (!ring || ring.length < 3) return null;
        const [lng, lat] = ringCentroid(ring);
        return { lng, lat };
      }

      function haversineM(
        a: { lng: number; lat: number },
        b: { lng: number; lat: number },
      ): number {
        const R = 6371000;
        const toR = (d: number) => (d * Math.PI) / 180;
        const dLat = toR(b.lat - a.lat);
        const dLng = toR(b.lng - a.lng);
        const la1 = toR(a.lat);
        const la2 = toR(b.lat);
        const h =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
      }

      async function idle(ms: number) {
        await new Promise<void>((resolve) => {
          map.once("idle", () => resolve());
          window.setTimeout(() => resolve(), ms);
        });
        await new Promise<void>((r) => window.setTimeout(r, 800));
      }

      const anchor = { lng: 126.9055, lat: 37.556 };
      map.jumpTo({ zoom: 16, center: [anchor.lng, anchor.lat] });
      await idle(7000);

      const feats16 = map.getLayer("building_kr_fill")
        ? map.queryRenderedFeatures({ layers: ["building_kr_fill"] })
        : [];
      let ref: { lng: number; lat: number; no: string } | null = null;
      let bestD = Infinity;
      type Feat = {
        geometry?: { type?: string; coordinates?: unknown };
        properties?: { no?: unknown };
      };
      for (const raw of feats16) {
        const f = raw as Feat;
        const no = String(f.properties?.no || "");
        if (!no) continue;
        const c = featureCentroid(f);
        if (!c) continue;
        const d = (c.lng - anchor.lng) ** 2 + (c.lat - anchor.lat) ** 2;
        if (d < bestD) {
          bestD = d;
          ref = { ...c, no };
        }
      }
      if (!ref) return { ok: false as const, reason: "no_ref" };

      map.jumpTo({ zoom: 18, center: [ref.lng, ref.lat] });
      await idle(7000);

      const feats18 = map.getLayer("building_kr_fill")
        ? map.queryRenderedFeatures({ layers: ["building_kr_fill"] })
        : [];
      let cur: { lng: number; lat: number; no: string } | null = null;
      for (const raw of feats18) {
        const f = raw as Feat;
        const no = String(f.properties?.no || "");
        if (no !== ref.no) continue;
        const c = featureCentroid(f);
        if (!c) continue;
        cur = { ...c, no };
        break;
      }
      if (!cur) return { ok: false as const, reason: "no_match", no: ref.no };

      const cache = (
        map as unknown as {
          style?: {
            sourceCaches?: Record<
              string,
              { _tiles?: Record<string, { tileID?: { canonical?: { z?: number } } }> }
            >;
          };
        }
      ).style?.sourceCaches?.korea_buildings;
      const heldZs: number[] = [];
      if (cache?._tiles) {
        for (const t of Object.values(cache._tiles)) {
          const cz = t?.tileID?.canonical?.z;
          if (typeof cz === "number") heldZs.push(cz);
        }
      }

      return {
        ok: true as const,
        no: ref.no,
        meters: haversineM(ref, cur),
        srcMax: (
          map.getSource("korea_buildings") as { maxzoom?: number } | undefined
        )?.maxzoom,
        heldZs: [...new Set(heldZs)].sort((a, b) => a - b),
        kr18: feats18.length,
      };
    });

    expect(geo.ok, `building geo match failed: ${JSON.stringify(geo)}`).toBe(
      true,
    );
    if (geo.ok) {
      expect(geo.srcMax).toBe(16);
      expect(geo.heldZs.every((z) => z <= 16)).toBe(true);
      expect(
        geo.meters,
        `z16 vs z18 building ${geo.no} centroid Δ=${geo.meters}m`,
      ).toBeLessThan(5);
      expect(geo.kr18).toBeGreaterThan(0);
    }
  }

  // Warm label latency after density (avoid perturbing counts)
  const labelLatencyMs = await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    const center: [number, number] = [126.9055, 37.556];
    map.jumpTo({ zoom: 16, center });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 5000);
    });
    map.jumpTo({ zoom: 12, center });
    const hideDeadline = performance.now() + 3000;
    while (performance.now() < hideDeadline) {
      const style = (
        map as unknown as { getStyle?: () => { layers?: { id: string }[] } }
      ).getStyle?.();
      const shopLayers = (style?.layers ?? [])
        .map((l) => l.id)
        .filter(
          (id) =>
            id.startsWith("shop_poi_label") ||
            id.startsWith("sangga_shop_label_"),
        );
      const n = shopLayers.length
        ? map.queryRenderedFeatures({ layers: shopLayers }).length
        : 0;
      if (n === 0) break;
      await new Promise<void>((r) => window.setTimeout(r, 40));
    }
    const t0 = performance.now();
    map.jumpTo({ zoom: 17, center });
    const deadline = t0 + 8000;
    while (performance.now() < deadline) {
      const style = (
        map as unknown as { getStyle?: () => { layers?: { id: string }[] } }
      ).getStyle?.();
      const shopLayers = (style?.layers ?? [])
        .map((l) => l.id)
        .filter(
          (id) =>
            id.startsWith("shop_poi_label") ||
            id.startsWith("sangga_shop_label_"),
        );
      const n = shopLayers.length
        ? map.queryRenderedFeatures({ layers: shopLayers }).length
        : 0;
      if (n > 0) return Math.round(performance.now() - t0);
      await new Promise<void>((r) => window.setTimeout(r, 30));
    }
    return null;
  });
  expect(labelLatencyMs).not.toBeNull();
  expect(labelLatencyMs!).toBeLessThanOrEqual(500);

  console.log(`[density] labelFirstMs=${labelLatencyMs}; ${rows.join(" | ")}`);
});

test("map-preview search-nav: far/near camera + shop labels", async ({
  page,
}) => {
  await openPreview(page, "/map-preview?mode=nopins&theme=paper");
  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 16, center: [126.9055, 37.556] });
    await new Promise<void>((r) => window.setTimeout(r, 4000));
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 3000);
    });
  });

  type NavResult = {
    caseId: string;
    cameraMs: number;
    labelMs: number;
    tileCount: number;
    tileAvgMs: number | null;
    totalMs: number;
  };

  async function measureNav(
    from: [number, number],
    to: [number, number],
    caseId: string,
    warm: boolean,
  ): Promise<NavResult> {
    return page.evaluate(
      async ({ from: f, to: t, caseId: id, warm: doWarm }) => {
        const map = (
          window as unknown as {
            __PINDMAP_PREVIEW_MAP__: PreviewMap & {
              getCenter?: () => { lng: number; lat: number };
              areTilesLoaded?: () => boolean;
            };
          }
        ).__PINDMAP_PREVIEW_MAP__;
        const nav = (
          window as unknown as {
            __PINDMAP_SEARCH_NAV__?: {
              prefetchZ14Around: (
                lat: number,
                lng: number,
              ) => Promise<unknown>;
              goToSearchResult: (lat: number, lng: number, lv?: number) => void;
            };
          }
        ).__PINDMAP_SEARCH_NAV__;
        if (!nav) throw new Error("missing __PINDMAP_SEARCH_NAV__");

        // Leave origin so destination labels are not already on-screen
        map.jumpTo({ zoom: 16, center: f });
        await new Promise<void>((r) => window.setTimeout(r, 2500));
        await new Promise<void>((resolve) => {
          map.once("idle", () => resolve());
          window.setTimeout(() => resolve(), 2000);
        });

        if (doWarm) {
          await nav.prefetchZ14Around(t[1], t[0]);
          await new Promise<void>((r) => window.setTimeout(r, 1000));
        }

        const tileTimes: number[] = [];
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            const pe = e as PerformanceResourceTiming;
            if (!/tiles\.openfreemap\.org\/planet\/.+\.pbf/.test(pe.name)) continue;
            tileTimes.push(pe.responseEnd - pe.startTime);
          }
        });
        obs.observe({ entryTypes: ["resource"] });
        performance.clearResourceTimings();

        const t0 = performance.now();
        nav.goToSearchResult(t[1], t[0], 3);

        const deadline = t0 + 5000;
        let labelMs: number | null = null;
        let cameraMs = 0;
        const nearDest = () => {
          const c = map.getCenter?.() ?? { lng: 0, lat: 0 };
          const dLng = (c.lng - t[0]) * 111320 * Math.cos((c.lat * Math.PI) / 180);
          const dLat = (c.lat - t[1]) * 110540;
          return Math.hypot(dLng, dLat) < 350; // within ~350m of target
        };
        while (performance.now() < deadline) {
          if (!nearDest()) {
            await new Promise<void>((r) => window.setTimeout(r, 20));
            continue;
          }
          if (!cameraMs) cameraMs = Math.round(performance.now() - t0);
          const style = (
            map as unknown as { getStyle?: () => { layers?: { id: string }[] } }
          ).getStyle?.();
          const shopLayers = (style?.layers ?? [])
            .map((l) => l.id)
            .filter(
              (sid) =>
                sid.startsWith("shop_poi_label") ||
                sid.startsWith("sangga_shop_label_"),
            );
          const n = shopLayers.length
            ? map.queryRenderedFeatures({ layers: shopLayers }).length
            : 0;
          if (n > 0) {
            labelMs = Math.round(performance.now() - t0);
            break;
          }
          await new Promise<void>((r) => window.setTimeout(r, 20));
        }
        if (!cameraMs) cameraMs = Math.round(performance.now() - t0);
        obs.disconnect();
        const tileAvgMs =
          tileTimes.length > 0
            ? Math.round(
                tileTimes.reduce((a, b) => a + b, 0) / tileTimes.length,
              )
            : null;
        return {
          caseId: id,
          cameraMs,
          labelMs: labelMs ?? -1,
          tileCount: tileTimes.length,
          tileAvgMs,
          totalMs: labelMs ?? Math.round(performance.now() - t0),
        };
      },
      { from, to, caseId, warm },
    );
  }

  const mangwon: [number, number] = [126.9055, 37.556];
  const gangnam: [number, number] = [127.0276, 37.4979];
  const mangwonNear: [number, number] = [126.9015, 37.556];

  const farCold = await measureNav(mangwon, gangnam, "far-cold", false);
  const nearCold = await measureNav(mangwon, mangwonNear, "near-cold", false);
  const farWarm = await measureNav(mangwon, gangnam, "far-warm", true);

  console.log(
    `[search-nav] farCold=${JSON.stringify(farCold)} nearCold=${JSON.stringify(nearCold)} farWarm=${JSON.stringify(farWarm)}`,
  );

  expect(farCold.labelMs, `far-cold labelMs=${farCold.labelMs}`).toBeGreaterThan(0);
  expect(
    farCold.totalMs,
    `far-cold total ${farCold.totalMs}ms (tiles avg ${farCold.tileAvgMs} n=${farCold.tileCount})`,
  ).toBeLessThanOrEqual(1000);
  expect(
    nearCold.totalMs,
    `near-cold total ${nearCold.totalMs}ms`,
  ).toBeLessThanOrEqual(400);
  expect(
    farWarm.totalMs,
    `far-warm total ${farWarm.totalMs}ms`,
  ).toBeLessThanOrEqual(400);
});

test("map-preview major road names only; shields / alleys stay hidden", async ({
  page,
}) => {
  await openPreview(page, "/map-preview?mode=nopins");
  // z15 Hongdae: major (대로 / primary) + secondary …로; no shields / 길
  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 15, center: [126.9236, 37.5563] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 5000);
    });
  });

  const result = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    const hiddenIds = [
      "highway-name-path",
      "highway-name-minor",
      "highway-name-major",
      "highway-shield-non-us",
      "highway-shield-us-interstate",
      "road_shield_us",
      "label_bridge_ko",
    ];
    const presentHidden = hiddenIds.filter((id) => !!map.getLayer(id));
    const visibility = Object.fromEntries(
      presentHidden.map((id) => [
        id,
        map.getLayoutProperty(id, "visibility") ?? "visible",
      ]),
    );
    const hiddenFeats = presentHidden.length
      ? map.queryRenderedFeatures({ layers: presentHidden })
      : [];

    const majorOk = !!map.getLayer("road_name_major");
    const secondaryOk = !!map.getLayer("road_name_secondary");
    const roadLayers = ["road_name_major", "road_name_secondary"].filter(
      (id) => !!map.getLayer(id),
    );
    const roadFeats = roadLayers.length
      ? map.queryRenderedFeatures({ layers: roadLayers })
      : [];
    const names = [
      ...new Set(
        (
          roadFeats as Array<{
            properties?: Record<string, unknown> | null;
          }>
        ).map((f) => {
          const raw = String(
            f.properties?.["name:ko"] ||
              f.properties?.["name:nonlatin"] ||
              f.properties?.name ||
              "",
          ).trim();
          const cut = raw.indexOf("(");
          return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
        }),
      ),
    ].filter(Boolean);
    const gil = names.filter((n) => n.endsWith("길"));
    const refOnly = names.filter((n) => /^[A-Za-z0-9\-]+$/.test(n));
    return {
      presentHidden,
      visibility,
      hiddenCount: hiddenFeats.length,
      majorOk,
      secondaryOk,
      roadCount: names.length,
      samples: names.slice(0, 8),
      gil,
      refOnly,
      zoom: map.getZoom(),
    };
  });

  expect(result.majorOk, "road_name_major layer missing").toBe(true);
  expect(result.secondaryOk, "road_name_secondary layer missing").toBe(true);
  for (const id of result.presentHidden) {
    expect(
      result.visibility[id],
      `${id} should be visibility:none`,
    ).toBe("none");
  }
  expect(
    result.hiddenCount,
    `Liberty highway-name/shield must stay 0 at z${result.zoom}`,
  ).toBe(0);
  expect(
    result.roadCount,
    `expected some major road names at Hongdae z15; samples=${result.samples.join(",")}`,
  ).toBeGreaterThan(0);
  expect(result.gil, `길 alley names must not render: ${result.gil.join(",")}`).toEqual(
    [],
  );
  expect(
    result.refOnly,
    `ref/Latin-only road labels must not render: ${result.refOnly.join(",")}`,
  ).toEqual([]);
});

test("map-preview basics: korea landmarks + z16 anchors", async ({ page }) => {
  const pathMod = await import("node:path");
  const fs = await import("node:fs");
  const outDir = pathMod.join(process.cwd(), "test-results", "map-basics");
  fs.mkdirSync(outDir, { recursive: true });

  await openPreview(page, "/map-preview?theme=paper");
  await page.setViewportSize({ width: 390, height: 844 });

  const hubs = {
    seoul: { center: [126.978, 37.5665] as [number, number], z: 11 },
    mapo: { center: [126.9015, 37.5663] as [number, number], z: 13 },
    gangnam: { center: [127.0276, 37.4979] as [number, number], z: 13 },
    hongdae15: { center: [126.9236, 37.5563] as [number, number], z: 15 },
    hongdae16: { center: [126.9236, 37.5563] as [number, number], z: 16 },
    mangwon16: { center: [126.9019, 37.5565] as [number, number], z: 16 },
    gangnam16: { center: [127.0276, 37.4979] as [number, number], z: 16 },
    mangwon17: { center: [126.9019, 37.5565] as [number, number], z: 17 },
    hongdae17: { center: [126.9236, 37.5563] as [number, number], z: 17 },
    gangnam17: { center: [127.0276, 37.4979] as [number, number], z: 17 },
  };

  async function settle(zoom: number, center: [number, number]) {
    await page.evaluate(
      async ({ z, center: c }) => {
        const map = (
          window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap }
        ).__PINDMAP_PREVIEW_MAP__;
        map.jumpTo({ zoom: z, center: c });
        await new Promise<void>((resolve) => {
          map.once("idle", () => resolve());
          window.setTimeout(() => resolve(), 4000);
        });
        await new Promise<void>((r) => window.setTimeout(r, 1200));
      },
      { z: zoom, center },
    );
  }

  async function measure(zoom: number, center: [number, number]) {
    await settle(zoom, center);
    return page.evaluate(() => {
      const map = (
        window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap }
      ).__PINDMAP_PREVIEW_MAP__;
      const uniq = (ids: string[]) => {
        const layers = ids.filter((id) => !!map.getLayer(id));
        if (!layers.length) return { count: 0, names: [] as string[] };
        const feats = map.queryRenderedFeatures({ layers });
        const seen = new Set<string>();
        for (const f of feats) {
          const p =
            (f as { properties?: Record<string, unknown> }).properties ?? {};
          const name = String(p["name:ko"] || p.name || "").trim();
          if (name) seen.add(name);
        }
        return { count: seen.size, names: [...seen] };
      };
      const korea = uniq([
        "korea_landmark_tier1_far",
        "korea_landmark_tier1",
        "korea_landmark_tier2",
        "korea_landmark_tier3",
      ]);
      const tier1 = uniq(["korea_landmark_tier1_far", "korea_landmark_tier1"]);
      const styleIds = (map.getStyle?.()?.layers ?? []).map(
        (l: { id: string }) => l.id,
      );
      const anchors = uniq([
        ...styleIds.filter(
          (id: string) =>
            id === "landmark_label" ||
            id.startsWith("landmark_label_") ||
            id === "landmark_priority" ||
            id.startsWith("landmark_priority_") ||
            // Liberty has no park_label; parks render on park_name_label_*.
            id === "label_park" ||
            id === "park_label" ||
            id.startsWith("park_name_label"),
        ),
      ]);
      const stations = uniq(["poi_transit", "poi_transit_mid"]);
      // Candidates in view (school/park/gov/market/hospital + rail station)
      let candidates = 0;
      const mapAny = map as PreviewMap & {
        querySourceFeatures?: (
          source: string,
          opts: { sourceLayer: string },
        ) => Array<{
          properties?: Record<string, unknown> | null;
          geometry?: { type: string; coordinates: number[] };
        }>;
        project?: (lngLat: [number, number]) => { x: number; y: number };
      };
      if (mapAny.querySourceFeatures && mapAny.project) {
        const feats = mapAny.querySourceFeatures("openmaptiles", {
          sourceLayer: "poi",
        });
        const seen = new Set<string>();
        for (const f of feats) {
          const p = f.properties ?? {};
          const cls = String(p.class ?? "");
          const sub = String(p.subclass ?? "");
          const name = String(p["name:ko"] || p.name || "").trim();
          if (!name) continue;
          const isStation =
            (cls === "rail" || cls === "railway") &&
            ["subway", "station", "halt", "tram_stop"].includes(sub);
          const isAnchor =
            cls === "school" ||
            cls === "college" ||
            sub === "university" ||
            cls === "park" ||
            cls === "town_hall" ||
            cls === "police" ||
            (cls === "hospital" && sub === "hospital") ||
            (cls === "grocery" && sub === "marketplace") ||
            (cls === "post" && sub === "post_office");
          if (!isStation && !isAnchor) continue;
          const g = f.geometry;
          if (!g || g.type !== "Point") continue;
          const [lng, lat] = g.coordinates as [number, number];
          const pt = mapAny.project!([lng, lat]);
          if (pt.x < 0 || pt.y < 0 || pt.x > 390 || pt.y > 844) continue;
          const key = `${name}|${lng.toFixed(5)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates += 1;
        }
      }
      return {
        korea: korea.count,
        tier1: tier1.count,
        koreaNames: korea.names,
        anchors: anchors.count,
        anchorNames: anchors.names,
        stations: stations.count,
        stationNames: stations.names,
        candidates,
        layers: {
          t1: !!(
            map.getLayer("korea_landmark_tier1") ||
            map.getLayer("korea_landmark_tier1_far")
          ),
          boundarySido: !!map.getLayer("boundary_sido"),
          boundaryGu: !!map.getLayer("boundary_gu"),
          peak: !!map.getLayer("mountain_peak_label"),
          island: !!map.getLayer("place_island_ko"),
          golf: !!map.getLayer("landuse_golf"),
        },
      };
    });
  }

  const seoul = await measure(hubs.seoul.z, hubs.seoul.center);
  await page.screenshot({
    path: pathMod.join(outDir, "basics-seoul-z11.png"),
    fullPage: false,
  });
  const mapo = await measure(hubs.mapo.z, hubs.mapo.center);
  await page.screenshot({
    path: pathMod.join(outDir, "basics-mapo-z13.png"),
    fullPage: false,
  });
  const gangnam = await measure(hubs.gangnam.z, hubs.gangnam.center);
  await page.screenshot({
    path: pathMod.join(outDir, "basics-gangnam-z13.png"),
    fullPage: false,
  });
  const hong15 = await measure(hubs.hongdae15.z, hubs.hongdae15.center);
  await page.screenshot({
    path: pathMod.join(outDir, "basics-hongdae-z15.png"),
    fullPage: false,
  });
  const hong16 = await measure(hubs.hongdae16.z, hubs.hongdae16.center);
  await page.screenshot({
    path: pathMod.join(outDir, "basics-hongdae-z16.png"),
    fullPage: false,
  });
  const mang16 = await measure(hubs.mangwon16.z, hubs.mangwon16.center);
  const gang16 = await measure(hubs.gangnam16.z, hubs.gangnam16.center);
  const mang17 = await measure(hubs.mangwon17.z, hubs.mangwon17.center);
  const hong17 = await measure(hubs.hongdae17.z, hubs.hongdae17.center);
  const gang17 = await measure(hubs.gangnam17.z, hubs.gangnam17.center);

  const rows = [
    `seoul z11 tier1=${seoul.tier1} korea=${seoul.korea} names=${seoul.koreaNames.slice(0, 12).join("|")}`,
    `mapo z13 korea=${mapo.korea}`,
    `gangnam z13 korea=${gangnam.korea}`,
    `hongdae z15 korea=${hong15.korea}`,
    `hongdae z16 anchors=${hong16.anchors} stations=${hong16.stations} cand=${hong16.candidates} st=${hong16.stationNames.join("|")} an=${hong16.anchorNames.slice(0, 8).join("|")}`,
    `mangwon z16 anchors=${mang16.anchors} stations=${mang16.stations} cand=${mang16.candidates}`,
    `gangnam z16 anchors=${gang16.anchors} stations=${gang16.stations} cand=${gang16.candidates}`,
    `mangwon z17 anchors=${mang17.anchors} stations=${mang17.stations} cand=${mang17.candidates}`,
    `hongdae z17 anchors=${hong17.anchors} stations=${hong17.stations} cand=${hong17.candidates}`,
    `gangnam z17 anchors=${gang17.anchors} stations=${gang17.stations} cand=${gang17.candidates}`,
    `layers ${JSON.stringify(seoul.layers)}`,
  ];
  fs.writeFileSync(pathMod.join(outDir, "basics-report.txt"), rows.join("\n"));
  console.log(rows.join("\n"));

  expect(seoul.layers.t1, "korea_landmark_tier1 layer").toBe(true);
  expect(seoul.tier1, `seoul z11 tier1 ≥8, got ${seoul.tier1}`).toBeGreaterThanOrEqual(8);
  expect(mapo.korea, `mapo z13 korea ≥5, got ${mapo.korea}`).toBeGreaterThanOrEqual(5);
  expect(gangnam.korea, `gangnam z13 korea ≥5, got ${gangnam.korea}`).toBeGreaterThanOrEqual(5);
  expect(hong15.korea, `hongdae z15 korea ≥3, got ${hong15.korea}`).toBeGreaterThanOrEqual(3);

  const hongStationOk = hong16.stationNames.some((n) => n.includes("홍대"));
  expect(hongStationOk, `hongdae z16 station names=${hong16.stationNames.join(",")}`).toBe(true);
  const seogyoOk =
    hong16.anchorNames.some((n) => n.includes("서교")) || hong16.anchors >= 4;
  expect(
    seogyoOk,
    `hongdae z16 expect 서교초 or ≥4 anchors; anchors=${hong16.anchorNames.join("|")}`,
  ).toBe(true);

  for (const [label, m] of [
    ["mangwon16", mang16],
    ["hongdae16", hong16],
    ["gangnam16", gang16],
    ["mangwon17", mang17],
    ["hongdae17", hong17],
    ["gangnam17", gang17],
  ] as const) {
    const shown = m.anchors + m.stations;
    if (m.candidates < 4) {
      console.log(`${label}: skip ≥4 (candidates=${m.candidates} shown=${shown})`);
      continue;
    }
    expect(
      shown,
      `${label} anchors+stations ≥4 (cand=${m.candidates}), got ${shown} (a=${m.anchors} s=${m.stations})`,
    ).toBeGreaterThanOrEqual(4);
  }
});

test.skip(
  "public list MapLibre load — no durable fixture list id",
  async () => {
    /* Intentionally skipped: do not hardcode a real user's public list. */
  },
);
