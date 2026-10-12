import { test, expect, type Page } from "@playwright/test";

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
    map.jumpTo({ zoom: 15, center: [126.924, 37.5572] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 3000);
    });
  });

  const z15 = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    return {
      landmark: map.queryRenderedFeatures({ layers: ["landmark_label"] }).length,
      line: map.queryRenderedFeatures({ layers: ["subway_overlay_line"] }).length,
      station: map.queryRenderedFeatures({
        layers: ["subway_overlay_station", "subway_overlay_station_transfer"],
      }).length,
      building: map.getLayer("building")
        ? map.queryRenderedFeatures({ layers: ["building"] }).length
        : 0,
      zoom: map.getZoom(),
    };
  });

  // Landmarks start at z13–14; z15 still shows subway + buildings + landmarks
  expect(z15.landmark, `z15 landmark count=${z15.landmark}`).toBeGreaterThan(0);
  expect(z15.line, `z15 subway line count=${z15.line}`).toBeGreaterThan(0);
  expect(z15.station, `z15 station count=${z15.station}`).toBeGreaterThan(0);
  expect(z15.building, `z15 building count=${z15.building}`).toBeGreaterThan(0);

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
    return {
      landmark: map.queryRenderedFeatures({ layers: ["landmark_label"] }).length,
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
  await page.route("**/tiles.openfreemap.org/styles/liberty**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "e2e_style_fail",
    });
  });

  await page.goto("/map-preview?probe=public-list", {
    waitUntil: "domcontentloaded",
  });

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
  const targets: Record<number, { totalMin: number; totalMax: number }> = {
    11: { totalMin: 15, totalMax: 25 },
    12: { totalMin: 20, totalMax: 35 },
    13: { totalMin: 25, totalMax: 40 },
  };
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
        "label_suburb_ko",
        "label_dong_major_ko",
        "label_dong_ko",
        "label_korea_dong_overlay",
      ]);
      const station = countUnique(["poi_transit", "poi_transit_mid"]);
      const landmark = countUnique([
        "landmark_label",
        "label_korea_landmark_overlay",
        "label_korea_landmark_overlay_z13",
        "label_park",
        "park_label",
      ].filter((id) => layerIds.includes(id) || !!map.getLayer(id)));
      const mountain = countUnique([
        "label_korea_mountain_overlay",
        ...layerIds.filter(
          (id) => id.includes("mountain") || id.includes("peak"),
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
      expect(m.roadNames, `${hub.id} z${z} road names must be 0`).toBe(0);
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
  const roadIds = [
    "highway-name-path",
    "highway-name-minor",
    "highway-name-major",
    "highway-shield-non-us",
    "highway-shield-us-interstate",
    "road_shield_us",
    "label_bridge_ko",
  ];
  const targets: Record<
    number,
    { totalMin: number; totalMax: number; shopMin: number }
  > = {
    14: { totalMin: 25, totalMax: 40, shopMin: 8 },
    15: { totalMin: 30, totalMax: 45, shopMin: 20 },
    16: { totalMin: 35, totalMax: 50, shopMin: 30 },
    17: { totalMin: 35, totalMax: 55, shopMin: 30 },
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
      const shopLayers = layerIds.filter((id) =>
        id.startsWith("shop_poi_label"),
      );
      const shop = shopLayers.length
        ? map.queryRenderedFeatures({ layers: shopLayers })
        : [];
      const landmarkLayers = [
        "landmark_label",
        "label_korea_landmark_overlay",
      ].filter((id) => !!map.getLayer(id));
      const landmark = landmarkLayers.length
        ? map.queryRenderedFeatures({ layers: landmarkLayers })
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

      return {
        shopCount: shop.length,
        landmarkCount: landmark.length,
        stationCount: station.length,
        total: shop.length + landmark.length + station.length,
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
        `${hub.id} z${z} road names must be 0`,
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
        `${hub.id} z${z} total ${t.totalMin}–${t.totalMax}, got ${m.total} (shop=${m.shopCount} lm=${m.landmarkCount} st=${m.stationCount})`,
      ).toBeGreaterThanOrEqual(t.totalMin);
      expect(
        m.total,
        `${hub.id} z${z} total ${t.totalMin}–${t.totalMax}, got ${m.total} (shop=${m.shopCount} lm=${m.landmarkCount} st=${m.stationCount})`,
      ).toBeLessThanOrEqual(t.totalMax);
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
    return {
      subway: map.getLayer("subway_overlay_line")
        ? map.queryRenderedFeatures({ layers: ["subway_overlay_line"] }).length
        : 0,
      building: map.getLayer("building")
        ? map.queryRenderedFeatures({ layers: ["building"] }).length
        : 0,
    };
  });
  expect(hz15Extra.subway).toBeGreaterThanOrEqual(1);
  expect(hz15Extra.building).toBeGreaterThanOrEqual(1);
  expect(hz15.roadNames).toBe(0);

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
        .filter((id) => id.startsWith("shop_poi_label"));
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
        .filter((id) => id.startsWith("shop_poi_label"));
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

test("map-preview road name / shield labels are hidden (0 features)", async ({
  page,
}) => {
  await openPreview(page, "/map-preview?mode=nopins");
  // Zooms where highway-name / shields previously appeared (major z13+, shields z8+)
  await page.evaluate(async () => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 14, center: [126.92, 37.56] });
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 4000);
    });
  });

  const result = await page.evaluate(() => {
    const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
      .__PINDMAP_PREVIEW_MAP__;
    const roadLabelIds = [
      "highway-name-path",
      "highway-name-minor",
      "highway-name-major",
      "highway-shield-non-us",
      "highway-shield-us-interstate",
      "road_shield_us",
      "label_bridge_ko",
    ];
    const present = roadLabelIds.filter((id) => !!map.getLayer(id));
    const visibility = Object.fromEntries(
      present.map((id) => [
        id,
        map.getLayoutProperty(id, "visibility") ?? "visible",
      ]),
    );
    const feats = present.length
      ? map.queryRenderedFeatures({ layers: present })
      : [];
    return {
      present,
      visibility,
      featureCount: feats.length,
      zoom: map.getZoom(),
    };
  });

  for (const id of result.present) {
    expect(
      result.visibility[id],
      `${id} should be visibility:none`,
    ).toBe("none");
  }
  expect(
    result.featureCount,
    `road name/shield labels must be 0 at z${result.zoom}; layers=${result.present.join(",")}`,
  ).toBe(0);
});

test.skip(
  "public list MapLibre load — no durable fixture list id",
  async () => {
    /* Intentionally skipped: do not hardcode a real user's public list. */
  },
);
