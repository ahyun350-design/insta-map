/**
 * Measure POI icon↔name binding + building_kr at hubs.
 * Usage:
 *   PLAYWRIGHT_BASE_URL=https://insta-map-production.up.railway.app \
 *   MEASURE_TAG=after node scripts/measure-poi-binding.mjs
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
  if (!raw) throw new Error("missing EXTRACT_INTERNAL_SECRET / SERVICE_ROLE_KEY");
  return createHash("sha256")
    .update(`pindmap-map-preview-e2e:v1:${raw}`)
    .digest("hex")
    .slice(0, 32);
}

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const OUT = path.join(process.cwd(), "e2e/artifacts/poi-binding");
const TAG = process.env.MEASURE_TAG || "after";
fs.mkdirSync(OUT, { recursive: true });

const HUBS = [
  { id: "mangwon_z16", lat: 37.556, lng: 126.9055, z: 16 },
  { id: "mangwon_z17", lat: 37.556, lng: 126.9055, z: 17 },
  { id: "hongdae_z16", lat: 37.5563, lng: 126.9236, z: 16 },
  { id: "hongdae_z17", lat: 37.5563, lng: 126.9236, z: 17 },
  { id: "gangnam_z16", lat: 37.4979, lng: 127.0276, z: 16 },
  { id: "gangnam_z17", lat: 37.4979, lng: 127.0276, z: 17 },
];

async function measure(page) {
  return page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    if (!map) return null;
    const style = map.getStyle();
    const poiLayerIds = style.layers
      .filter((l) => l.type === "symbol" && map.getLayer(l.id))
      .map((l) => l.id)
      .filter((id) =>
        /shop_poi_label|sangga_shop_label|tour_poi_label|landmark_label|korea_landmark/.test(
          id,
        ),
      );

    let namelessIcon = 0;
    let withBoth = 0;
    let maxGapPx = 0;
    let labelCount = 0;
    const gaps = [];

    for (const id of poiLayerIds) {
      let feats = [];
      try {
        feats = map.queryRenderedFeatures({ layers: [id] });
      } catch {
        continue;
      }
      for (const f of feats) {
        labelCount++;
        const g = f.geometry;
        if (!g || g.type !== "Point") continue;
        const [lng, lat] = g.coordinates;
        const pt = map.project([lng, lat]);
        const name = String(
          f.properties?.["name:ko"] ||
            f.properties?.["name:nonlatin"] ||
            f.properties?.name ||
            f.properties?.no ||
            "",
        ).trim();
        const hasIcon = Boolean(
          map.getLayoutProperty(id, "icon-image") ||
            f.layer?.layout?.["icon-image"],
        );
        // Screen: query rendered icons via feature — nameless = empty name with icon layer
        if (hasIcon && !name) namelessIcon++;
        if (hasIcon && name) {
          withBoth++;
          // Approximate gap: radial offset * text-size (em→px)
          let radial = 1.15;
          let textSize = 12.5;
          try {
            radial = Number(map.getLayoutProperty(id, "text-radial-offset")) || 1.15;
            const ts = map.getLayoutProperty(id, "text-size");
            textSize = typeof ts === "number" ? ts : 12.5;
          } catch {
            /* keep defaults */
          }
          const gap = radial * textSize;
          gaps.push(gap);
          if (gap > maxGapPx) maxGapPx = gap;
        }
      }
    }

    // Layout flag audit
    let badAnchor = 0;
    let optionalMismatch = 0;
    for (const id of poiLayerIds) {
      try {
        const va = map.getLayoutProperty(id, "text-variable-anchor");
        if (Array.isArray(va) && (va.includes("top") || va.includes("bottom")))
          badAnchor++;
        const io = map.getLayoutProperty(id, "icon-optional");
        const to = map.getLayoutProperty(id, "text-optional");
        if (io === true || to === true) optionalMismatch++;
      } catch {
        /* skip */
      }
    }

    const kr = map.getLayer("building_kr_fill")
      ? map.queryRenderedFeatures({ layers: ["building_kr_fill"] }).length
      : 0;
    const omt = map.getLayer("building")
      ? map.queryRenderedFeatures({ layers: ["building"] }).length
      : 0;

    return {
      labelCount,
      namelessIcon,
      withBoth,
      maxGapPx: Math.round(maxGapPx * 10) / 10,
      medianGapPx: gaps.length
        ? Math.round(
            [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] * 10,
          ) / 10
        : 0,
      badAnchor,
      optionalMismatch,
      kr_fill: kr,
      omt_building: omt,
      hasKrSource: Boolean(style.sources?.korea_buildings),
      fillColor: map.getLayer("building_kr_fill")
        ? map.getPaintProperty("building_kr_fill", "fill-color")
        : null,
      shopAnchor: (() => {
        const id = poiLayerIds.find((x) => x.startsWith("shop_poi_label"));
        if (!id) return null;
        try {
          return map.getLayoutProperty(id, "text-variable-anchor");
        } catch {
          return null;
        }
      })(),
      iconSize: (() => {
        const id = poiLayerIds.find((x) => x.startsWith("shop_poi_label"));
        if (!id) return null;
        try {
          return map.getLayoutProperty(id, "icon-size");
        } catch {
          return null;
        }
      })(),
    };
  });
}

async function main() {
  const token = e2eToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
  });
  const page = await context.newPage();
  await page.goto(
    `${BASE}/map-preview?mode=nopins&theme=paper&selfTiles=1&lat=37.556&lng=126.9055&z=17&e2e=${token}&t=${Date.now()}`,
    { waitUntil: "domcontentloaded", timeout: 120000 },
  );
  await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
    timeout: 90000,
  });
  await page.waitForTimeout(5000);

  const rows = [];
  for (const hub of HUBS) {
    await page.evaluate(async ({ lat, lng, z }) => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      map.jumpTo({ zoom: z, center: [lng, lat] });
      await new Promise((r) => {
        map.once("idle", r);
        setTimeout(r, 7000);
      });
      await new Promise((r) => setTimeout(r, 1500));
    }, hub);
    const m = await measure(page);
    console.log(JSON.stringify({ hub: hub.id, ...m }));
    rows.push({ hub: hub.id, z: hub.z, ...m });
    await page.screenshot({
      path: path.join(OUT, `${TAG}-${hub.id}.png`),
      fullPage: false,
    });
  }

  const summaryPath = path.join(OUT, `${TAG}-summary.json`);
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      { tag: TAG, base: BASE, at: new Date().toISOString(), rows },
      null,
      2,
    ),
  );
  console.error("wrote", summaryPath);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
