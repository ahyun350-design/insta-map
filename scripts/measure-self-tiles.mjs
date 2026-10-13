/**
 * OFM vs self-tiles label latency + density checks (iPhone 13, no HTTP cache).
 * Usage: node scripts/measure-self-tiles.mjs
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv(".env.local");

function e2eToken() {
  const raw =
    process.env.EXTRACT_INTERNAL_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  return createHash("sha256")
    .update(`pindmap-map-preview-e2e:v1:${raw}`)
    .digest("hex")
    .slice(0, 32);
}

const BASE = "http://localhost:3456";
const outDir = path.join(process.cwd(), "test-results", "self-tiles");
fs.mkdirSync(outDir, { recursive: true });

async function openMode(browser, selfTiles, view = null) {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
  });
  // OFM: no HTTP cache (cold CDN). Self: keep session cache so app-start prefetch counts.
  if (!selfTiles) {
    await context.route("**/*", async (route) => {
      const headers = {
        ...route.request().headers(),
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      };
      await route.continue({ headers });
    });
  }
  const page = await context.newPage();
  let q = selfTiles
    ? `mode=nopins&theme=paper&selfTiles=1&e2e=${e2eToken()}&t=${Date.now()}`
    : `mode=nopins&theme=paper&selfTiles=0&e2e=${e2eToken()}&t=${Date.now()}`;
  if (view) {
    q += `&lat=${view.lat}&lng=${view.lng}&z=${view.z}`;
  }
  await page.goto(`${BASE}/map-preview?${q}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForFunction(
    () => window.__PINDMAP_PREVIEW_MAP__ != null,
    null,
    { timeout: 90000 },
  );
  return { context, page };
}

/** Time from Map() construct to place labels (last-location first open). */
async function firstOpenLabelMs(page, nameHint) {
  return page.evaluate(async (nameHint) => {
    const hintRe = nameHint ? new RegExp(nameHint) : null;
    const t0 =
      window.__PINDMAP_PREVIEW_MAP_T0__ ?? performance.now();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      if (!map) {
        await new Promise((r) => setTimeout(r, 16));
        continue;
      }
      const placeLayers = map
        .getStyle()
        .layers.filter((l) => l.type === "symbol")
        .map((l) => l.id)
        .filter(
          (id) =>
            /label|poi|shop|landmark|park|place|station|transit|dong|gu|mountain|korea_/i.test(
              id,
            ) && !/pin|myloc|search|route|water/i.test(id),
        )
        .filter((id) => !!map.getLayer(id));
      if (!placeLayers.length) {
        await new Promise((r) => setTimeout(r, 16));
        continue;
      }
      const names = map
        .queryRenderedFeatures({ layers: placeLayers })
        .map((f) =>
          String(f.properties?.["name:ko"] || f.properties?.name || "").trim(),
        )
        .filter(Boolean);
      const hits = hintRe ? names.filter((n) => hintRe.test(n)) : names;
      if (hits.length >= 1 && names.length >= 3) {
        return {
          ms: Math.round(performance.now() - t0),
          labels: names.length,
          sample: hits.slice(0, 6),
        };
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return { ms: null, labels: 0, sample: [] };
  }, nameHint);
}

async function firstLabelMs(page, z, center, opts = {}) {
  const nameHint = opts.nameHint || null;
  return page.evaluate(
    async ({ z, center, nameHint }) => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      const placeLayers = map
        .getStyle()
        .layers.filter((l) => l.type === "symbol")
        .map((l) => l.id)
        .filter(
          (id) =>
            /label|poi|shop|landmark|park|place|station|transit|dong|gu|mountain|korea_/i.test(
              id,
            ) && !/pin|myloc|search|route|water/i.test(id),
        )
        .filter((id) => !!map.getLayer(id));

      const hintRe = nameHint ? new RegExp(nameHint) : null;
      const t0 = performance.now();
      map.jumpTo({ zoom: z, center });
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const feats = map.queryRenderedFeatures({ layers: placeLayers });
        const names = feats
          .map((f) =>
            String(
              f.properties?.["name:ko"] || f.properties?.name || "",
            ).trim(),
          )
          .filter(Boolean);
        const hits = hintRe ? names.filter((n) => hintRe.test(n)) : names;
        if (hits.length >= 1 && names.length >= 3) {
          return {
            ms: Math.round(performance.now() - t0),
            labels: names.length,
            sample: (hintRe ? hits : names).slice(0, 6),
          };
        }
        await new Promise((r) => setTimeout(r, 16));
      }
      return { ms: null, labels: 0, sample: [] };
    },
    { z, center, nameHint },
  );
}

async function densityChecks(page, z, center) {
  await page.evaluate(async ({ z, center }) => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: z, center });
    await new Promise((r) => {
      map.once("idle", () => r());
      setTimeout(r, 8000);
    });
    await new Promise((r) => setTimeout(r, 2000));
  }, { z, center });

  return page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    const placeLayers = map
      .getStyle()
      .layers.filter((l) => l.type === "symbol")
      .map((l) => l.id)
      .filter(
        (id) =>
          /label|poi|shop|landmark|park|place|station|transit|dong|gu|mountain|korea_/i.test(
            id,
          ) && !/pin|myloc|search|route|water/i.test(id),
      )
      .filter((id) => !!map.getLayer(id));
    const feats = map.queryRenderedFeatures({ layers: placeLayers });
    const names = feats
      .map((f) =>
        String(f.properties?.["name:ko"] || f.properties?.name || "").trim(),
      )
      .filter(Boolean);
    const counts = {};
    for (const n of names) counts[n] = (counts[n] || 0) + 1;
    const dupes = Object.entries(counts).filter(([, c]) => c > 1);
    let bold = 0;
    let overlapTrue = 0;
    const broken = [];
    for (const id of placeLayers) {
      try {
        const font = map.getLayoutProperty(id, "text-font");
        if (Array.isArray(font) && font.some((f) => /Bold/i.test(f))) bold++;
        for (const k of [
          "text-allow-overlap",
          "text-ignore-placement",
          "icon-allow-overlap",
          "icon-ignore-placement",
        ]) {
          try {
            if (map.getLayoutProperty(id, k) === true) overlapTrue++;
          } catch {
            /* skip */
          }
        }
      } catch {
        broken.push(id);
      }
    }
    const roadIds = [
      "highway-name-path",
      "highway-name-minor",
      "highway-name-major",
      "highway-shield-non-us",
      "label_bridge_ko",
    ].filter((id) => map.getLayer(id));
    const roadNames = roadIds.length
      ? map.queryRenderedFeatures({ layers: roadIds }).length
      : 0;
    const koreaIds = [
      "korea_landmark_tier1_far",
      "korea_landmark_tier1",
      "korea_landmark_tier2",
      "korea_landmark_tier3",
    ].filter((id) => map.getLayer(id));
    const korea = koreaIds.length
      ? new Set(
          map
            .queryRenderedFeatures({ layers: koreaIds })
            .map((f) => String(f.properties?.name || "").trim())
            .filter(Boolean),
        ).size
      : 0;
    const src = map.getSource("openmaptiles");
    const srcType = src
      ? {
          hasTiles: Array.isArray(src.tiles),
          tiles0: src.tiles?.[0]?.slice?.(0, 24) || null,
          url: typeof src.url === "string" ? "tilejson" : null,
          maxzoom: src.maxzoom ?? null,
        }
      : null;
    return {
      labels: names.length,
      unique: Object.keys(counts).length,
      dupeCount: dupes.length,
      dupes: dupes.slice(0, 6),
      boldLayers: bold,
      overlapTrue,
      roadNames,
      korea,
      brokenLayers: broken,
      source: srcType,
    };
  });
}

async function measureMode(browser, selfTiles) {
  // Mangwon = last-location first open (lat/lng/z on boot + self prefetch).
  const { context, page } = await openMode(browser, selfTiles, {
    lat: 37.5565,
    lng: 126.9019,
    z: 16,
  });
  const tag = selfTiles ? "self" : "ofm";
  const out = { mode: tag };

  out.mangwon16 = await firstOpenLabelMs(
    page,
    "망원|동교|합정|성산|월드컵|옹달샘",
  );

  // Subsequent neighborhoods: prefetch (search warm) then jump.
  async function timedJump(z, center, nameHint) {
    await page.evaluate(async ({ lat, lng }) => {
      const nav = window.__PINDMAP_SEARCH_NAV__;
      if (nav?.prefetchZ14Around) await nav.prefetchZ14Around(lat, lng);
    }, { lat: center[1], lng: center[0] });
    return firstLabelMs(page, z, center, { nameHint });
  }

  out.gangnam15 = await timedJump(
    15,
    [127.0276, 37.4979],
    "강남|역삼|삼성|논현|서초|포스코|CGV",
  );
  out.haeundae15 = await timedJump(
    15,
    [129.1604, 35.1587],
    "해운대|우동|중1|센텀|달맞이",
  );

  // Far search jump: Seoul → Busan (prefetch dest like search); Busan-local names
  await page.evaluate(async () => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    map.jumpTo({ zoom: 12, center: [126.978, 37.5665] });
    await new Promise((r) => {
      map.once("idle", () => r());
      setTimeout(r, 3000);
    });
    const nav = window.__PINDMAP_SEARCH_NAV__;
    if (nav?.prefetchZ14Around) await nav.prefetchZ14Around(35.1796, 129.0756);
  });
  const far = await page.evaluate(async () => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    const placeLayers = map
      .getStyle()
      .layers.filter((l) => l.type === "symbol")
      .map((l) => l.id)
      .filter(
        (id) =>
          /label|poi|shop|landmark|park|place|station|transit|dong|gu|mountain|korea_/i.test(
            id,
          ) && !/pin|myloc|search|route|water/i.test(id),
      )
      .filter((id) => !!map.getLayer(id));
    const busanHint = /부산|해운대|서면|광안|남포|동래|센텀/;
    const t0 = performance.now();
    map.jumpTo({ zoom: 14, center: [129.0756, 35.1796] });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const feats = map.queryRenderedFeatures({ layers: placeLayers });
      const names = feats
        .map((f) =>
          String(f.properties?.["name:ko"] || f.properties?.name || "").trim(),
        )
        .filter(Boolean);
      const busanHits = names.filter((n) => busanHint.test(n));
      if (busanHits.length >= 1 && names.length >= 3) {
        return {
          ms: Math.round(performance.now() - t0),
          labels: names.length,
          sample: busanHits.slice(0, 4),
        };
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return { ms: null, labels: 0, sample: [] };
  });
  out.farJumpBusan14 = far;

  out.checksHongdae15 = await densityChecks(page, 15, [126.9236, 37.5563]);
  out.checksNw12 = await densityChecks(page, 12, [126.92, 37.55]);
  out.checksYeouido13 = await densityChecks(page, 13, [126.925, 37.525]);

  await page.screenshot({
    path: path.join(outDir, `${tag}-hongdae-z15.png`),
    fullPage: false,
  });

  await context.close();
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const ofm = await measureMode(browser, false);
  const self = await measureMode(browser, true);
  const report = { ofm, self, at: new Date().toISOString() };
  fs.writeFileSync(
    path.join(outDir, "measure.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();

  const okSelf =
    self.checksHongdae15.dupeCount === 0 &&
    self.checksHongdae15.boldLayers === 0 &&
    self.checksHongdae15.overlapTrue === 0 &&
    self.checksHongdae15.roadNames === 0 &&
    self.checksNw12.dupeCount === 0 &&
    self.checksYeouido13.dupeCount === 0;
  console.log("SELF_CHECKS_OK", okSelf);
  process.exit(okSelf ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
