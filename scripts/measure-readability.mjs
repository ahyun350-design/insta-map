/**
 * Readability measure: land/building colors, label density, overlap=0,
 * approximate text–background contrast at hubs.
 *
 * Usage:
 *   PLAYWRIGHT_BASE_URL=https://insta-map-production.up.railway.app \
 *   MEASURE_TAG=before node scripts/measure-readability.mjs
 *
 * Artifacts: e2e/artifacts/readability/{tag}-*.png + {tag}-summary.json
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
const OUT = path.join(process.cwd(), "e2e/artifacts/readability");
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

function relLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(fg, bg) {
  const L1 = relLuminance(fg);
  const L2 = relLuminance(bg);
  if (L1 == null || L2 == null) return null;
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

async function measure(page) {
  return page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    if (!map) return null;
    const style = map.getStyle();
    const symbolIds = (style.layers || [])
      .filter((l) => l.type === "symbol" && map.getLayer(l.id))
      .map((l) => l.id);

    const poiIds = symbolIds.filter((id) =>
      /shop_poi_label|sangga_shop_label|tour_poi_label|landmark_label|landmark_priority|korea_landmark|apt_complex|named_building|building_kr_number|road_name/i.test(
        id,
      ),
    );

    let labelCount = 0;
    const byLayer = {};
    for (const id of poiIds) {
      let feats = [];
      try {
        feats = map.queryRenderedFeatures({ layers: [id] });
      } catch {
        continue;
      }
      byLayer[id] = feats.length;
      labelCount += feats.length;
    }

    let allowOverlap = 0;
    let ignorePlacement = 0;
    for (const id of symbolIds) {
      try {
        if (map.getLayoutProperty(id, "text-allow-overlap") === true) allowOverlap++;
        if (map.getLayoutProperty(id, "text-ignore-placement") === true)
          ignorePlacement++;
        if (map.getLayoutProperty(id, "icon-allow-overlap") === true) allowOverlap++;
        if (map.getLayoutProperty(id, "icon-ignore-placement") === true)
          ignorePlacement++;
      } catch {
        /* skip */
      }
    }

    const sampleShop =
      poiIds.find((x) => x.startsWith("shop_poi_label")) || null;
    let textColor = null;
    let textSize = null;
    let textFont = null;
    let haloWidth = null;
    let iconSize = null;
    if (sampleShop) {
      try {
        textColor = map.getPaintProperty(sampleShop, "text-color");
        textSize = map.getLayoutProperty(sampleShop, "text-size");
        textFont = map.getLayoutProperty(sampleShop, "text-font");
        haloWidth = map.getPaintProperty(sampleShop, "text-halo-width");
        iconSize = map.getLayoutProperty(sampleShop, "icon-size");
      } catch {
        /* skip */
      }
    }

    const landColor = map.getLayer("background")
      ? map.getPaintProperty("background", "background-color")
      : null;
    const omtBuilding = map.getLayer("building")
      ? map.getPaintProperty("building", "fill-color")
      : null;
    const krFill = map.getLayer("building_kr_fill")
      ? map.getPaintProperty("building_kr_fill", "fill-color")
      : null;
    const krOutline = map.getLayer("building_kr_outline")
      ? map.getPaintProperty("building_kr_outline", "line-color")
      : null;
    const krCount = map.getLayer("building_kr_fill")
      ? map.queryRenderedFeatures({ layers: ["building_kr_fill"] }).length
      : 0;
    const omtCount = map.getLayer("building")
      ? map.queryRenderedFeatures({ layers: ["building"] }).length
      : 0;

    // Approximate overlap: features whose screen points are within 8px of another
    const pts = [];
    for (const id of poiIds) {
      let feats = [];
      try {
        feats = map.queryRenderedFeatures({ layers: [id] });
      } catch {
        continue;
      }
      for (const f of feats) {
        if (f.geometry?.type !== "Point") continue;
        const [lng, lat] = f.geometry.coordinates;
        const p = map.project([lng, lat]);
        pts.push({ x: p.x, y: p.y });
      }
    }
    let overlapPairs = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        if (dx * dx + dy * dy < 64) overlapPairs++;
      }
    }

    return {
      labelCount,
      overlapPairs,
      allowOverlap,
      ignorePlacement,
      landColor,
      omtBuilding,
      krFill,
      krOutline,
      kr_fill: krCount,
      omt_building: omtCount,
      textColorSample: typeof textColor === "string" ? textColor : "expr",
      textSize,
      textFont,
      haloWidth,
      iconSize,
      byLayerTop: Object.entries(byLayer)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8),
    };
  });
}

function pickContrastColors(m) {
  // Prefer concrete hex from paint; food text default for paper after change
  const land = typeof m.landColor === "string" ? m.landColor : "#F2F2F0";
  const building = typeof m.krFill === "string" ? m.krFill : m.omtBuilding;
  const text =
    typeof m.textColorSample === "string" && m.textColorSample.startsWith("#")
      ? m.textColorSample
      : "#8A3A12";
  return {
    text_vs_land: contrastRatio(text, land),
    text_vs_building:
      typeof building === "string" ? contrastRatio(text, building) : null,
    building_vs_land:
      typeof building === "string" ? contrastRatio(building, land) : null,
  };
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
    const contrast = pickContrastColors(m || {});
    const row = { hub: hub.id, z: hub.z, ...m, contrast };
    console.log(JSON.stringify(row));
    rows.push(row);
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
