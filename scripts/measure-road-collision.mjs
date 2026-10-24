/**
 * Measure road/shop/dong/building-number counts + overlap flags.
 * Usage:
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 MEASURE_TAG=after \
 *   node scripts/measure-road-collision.mjs
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
const OUT = path.join(
  process.cwd(),
  process.env.MEASURE_OUT || "e2e/artifacts/road-collision",
);
const TAG = process.env.MEASURE_TAG || "after";
fs.mkdirSync(OUT, { recursive: true });

const HUBS = [
  { id: "hongdae_z15", lat: 37.5563, lng: 126.9236, z: 15 },
  { id: "hongdae_z16", lat: 37.5563, lng: 126.9236, z: 16 },
  { id: "gangnam_z14", lat: 37.4979, lng: 127.0276, z: 14 },
  { id: "gangnam_z16", lat: 37.4979, lng: 127.0276, z: 16 },
  { id: "mangwon_z15", lat: 37.5565, lng: 126.9019, z: 15 },
  { id: "mangwon_z17", lat: 37.5565, lng: 126.9019, z: 17 },
];

async function measure(page) {
  return page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    if (!map) return null;
    const style = map.getStyle();
    const ids = style.layers.map((l) => l.id);
    const pick = (re) => ids.filter((id) => re.test(id) && map.getLayer(id));
    const count = (layerIds) =>
      layerIds.length ? map.queryRenderedFeatures({ layers: layerIds }).length : 0;
    let ignoreTrue = 0;
    let allowOverlapTrue = 0;
    for (const id of [
      "road_name_major",
      "road_name_secondary",
      "building_kr_number",
    ]) {
      if (!map.getLayer(id)) continue;
      try {
        if (map.getLayoutProperty(id, "text-allow-overlap") === true)
          allowOverlapTrue++;
        if (map.getLayoutProperty(id, "text-ignore-placement") === true)
          ignoreTrue++;
      } catch {
        /* skip */
      }
    }
    let anyAllowOverlap = 0;
    for (const id of ids) {
      const l = style.layers.find((x) => x.id === id);
      if (!l || l.type !== "symbol") continue;
      if (/pin|myloc|search|route|cluster/i.test(id)) continue;
      try {
        if (map.getLayoutProperty(id, "text-allow-overlap") === true)
          anyAllowOverlap++;
      } catch {
        /* skip */
      }
    }
    return {
      road: count(pick(/^road_name_(major|secondary)$/)),
      shop: count(pick(/shop_poi_label|sangga_shop_label/)),
      dong: count(
        pick(/admin_dong_label|label_dong|place_suburb|place_neighbourhood/),
      ),
      bld_no: count(pick(/^building_kr_number$/)),
      ignoreTrue,
      allowOverlapTrue,
      anyAllowOverlap,
      roadIgnoreMajor: map.getLayer("road_name_major")
        ? map.getLayoutProperty("road_name_major", "text-ignore-placement")
        : null,
      bldIgnore: map.getLayer("building_kr_number")
        ? map.getLayoutProperty("building_kr_number", "text-ignore-placement")
        : null,
    };
  });
}

async function main() {
  const token = e2eToken();
  const browser = await chromium.launch({ headless: true });
  const page = await (
    await browser.newContext({ ...devices["iPhone 13"], locale: "ko-KR" })
  ).newPage();
  await page.goto(
    `${BASE}/map-preview?mode=nopins&theme=paper&selfTiles=1&lat=37.5563&lng=126.9236&z=15&e2e=${token}&t=${Date.now()}`,
    { waitUntil: "domcontentloaded", timeout: 120000 },
  );
  await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
    timeout: 90000,
  });
  await page.waitForTimeout(4000);

  const rows = [];
  for (const hub of HUBS) {
    await page.evaluate(async ({ lat, lng, z }) => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      map.jumpTo({ zoom: z, center: [lng, lat] });
      await new Promise((r) => {
        map.once("idle", r);
        setTimeout(r, 6000);
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
