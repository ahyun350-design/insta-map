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

test("map-preview Hongdae layers at z15 / exit at z16", async ({ page }) => {
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
    // Neighborhood landmarks start at z15
    if (Math.abs(map.getZoom() - 15) > 0.2) {
      map.jumpTo({ zoom: 15, center: [126.9236, 37.5563] });
    }
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      window.setTimeout(() => resolve(), 2500);
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
      zoom: map.getZoom(),
    };
  });

  expect(z15.landmark, `z15 landmark_label count=${z15.landmark}`).toBeGreaterThan(
    0,
  );
  expect(z15.line, `z15 subway line count=${z15.line}`).toBeGreaterThan(0);
  expect(z15.station, `z15 station count=${z15.station}`).toBeGreaterThan(0);

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

test("map-preview Mangwon: shop labels z16≥1, z14=0, roads=0", async ({
  page,
}) => {
  await openPreview(page, "/map-preview?mode=nopins&theme=paper");
  // 망원동 ≈ 126.9015, 37.5563
  const roadIds = [
    "highway-name-path",
    "highway-name-minor",
    "highway-name-major",
    "highway-shield-non-us",
    "highway-shield-us-interstate",
    "road_shield_us",
    "label_bridge_ko",
  ];

  async function measureAt(zoom: number) {
    await page.evaluate(async (z) => {
      const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
        .__PINDMAP_PREVIEW_MAP__;
      map.jumpTo({ zoom: z, center: [126.9015, 37.5563] });
      await new Promise<void>((resolve) => {
        map.once("idle", () => resolve());
        window.setTimeout(() => resolve(), 4500);
      });
    }, zoom);
    return page.evaluate((roads) => {
      const map = (window as unknown as { __PINDMAP_PREVIEW_MAP__: PreviewMap })
        .__PINDMAP_PREVIEW_MAP__;
      const style = (
        map as unknown as { getStyle?: () => { layers?: { id: string }[] } }
      ).getStyle?.();
      const shopLayers = (style?.layers ?? [])
        .map((l) => l.id)
        .filter((id) => id.startsWith("shop_poi_label"));
      const shop = shopLayers.length
        ? map.queryRenderedFeatures({ layers: shopLayers })
        : [];
      const roadPresent = roads.filter((id) => !!map.getLayer(id));
      const roadFeats = roadPresent.length
        ? map.queryRenderedFeatures({ layers: roadPresent })
        : [];
      return {
        shopCount: shop.length,
        roadNames: roadFeats.length,
        zoom: map.getZoom(),
        shopLayers,
      };
    }, roadIds);
  }

  const z14 = await measureAt(14);
  expect(
    z14.shopLayers.length,
    `shop_poi_label_* missing: ${z14.shopLayers.join(",")}`,
  ).toBeGreaterThanOrEqual(1);
  expect(
    z14.shopCount,
    `Mangwon z14: shop labels must be 0, got ${z14.shopCount}`,
  ).toBe(0);

  const z16 = await measureAt(16);
  expect(
    z16.shopCount,
    `Mangwon z16: expected ≥1 shop labels, got ${z16.shopCount}`,
  ).toBeGreaterThanOrEqual(1);
  expect(
    z16.roadNames,
    `Mangwon z16: road name/shield labels must be 0`,
  ).toBe(0);

  const z17 = await measureAt(17);
  const z18 = await measureAt(18);
  // Rendered counts for report (collision may thin labels at denser zooms)
  console.log(
    `[Mangwon shop labels] z14=${z14.shopCount} z16=${z16.shopCount} z17=${z17.shopCount} z18=${z18.shopCount}`,
  );
  expect(z16.roadNames, "road names must stay hidden at z16").toBe(0);
  expect(z17.roadNames, "road names must stay hidden at z17").toBe(0);
  expect(z18.roadNames, "road names must stay hidden at z18").toBe(0);
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
