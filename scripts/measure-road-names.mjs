/**
 * Measure major road-name labels at hubs (C-4).
 * Usage:
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 SKIP_DEPLOY_PROBE=1 \
 *   MEASURE_OUT=e2e/artifacts/road-names MEASURE_TAG=after \
 *   node scripts/measure-road-names.mjs
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

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "https://pindmap.com").replace(
  /\/$/,
  "",
);
const OUT = (() => {
  const raw = process.env.MEASURE_OUT || "e2e/artifacts/road-names";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
})();
const TAG = process.env.MEASURE_TAG || "after";
const SKIP_DEPLOY_PROBE = process.env.SKIP_DEPLOY_PROBE === "1";

const HUBS = [
  { id: "mangwon_z15", lat: 37.5565, lng: 126.9019, z: 15 },
  { id: "hongdae_z15", lat: 37.5563, lng: 126.9236, z: 15 },
  { id: "hongdae_z16", lat: 37.5563, lng: 126.9236, z: 16 },
  { id: "gangnam_z14", lat: 37.4979, lng: 127.0276, z: 14 },
  { id: "gangnam_z16", lat: 37.4979, lng: 127.0276, z: 16 },
  { id: "haeundae_z15", lat: 35.1587, lng: 129.1604, z: 15 },
  { id: "hongcheon_eup_z15", lat: 37.697, lng: 127.8889, z: 15 },
];

const HIDDEN_ROAD_IDS = [
  "highway-name-path",
  "highway-name-minor",
  "highway-name-major",
  "highway-shield-non-us",
  "highway-shield-us-interstate",
  "road_shield_us",
  "label_bridge_ko",
];

fs.mkdirSync(OUT, { recursive: true });

async function waitDeploy(page, token, maxMs = 8 * 60 * 1000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await page.goto(
      `${BASE}/map-preview?mode=nopins&theme=paper&selfTiles=1&lat=37.5563&lng=126.9236&z=15&e2e=${token}&t=${Date.now()}`,
      { waitUntil: "domcontentloaded", timeout: 120000 },
    );
    await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
      timeout: 90000,
    });
    const info = await page.evaluate(() => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      return {
        major: Boolean(map.getLayer("road_name_major")),
        secondary: Boolean(map.getLayer("road_name_secondary")),
      };
    });
    console.error("deploy_probe", JSON.stringify(info));
    if (info.major && info.secondary) return true;
    await page.waitForTimeout(20000);
  }
  return false;
}

async function measure(page) {
  return page.evaluate((hiddenIds) => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    if (!map) return null;
    const style = map.getStyle();
    const ids = style.layers.map((l) => l.id);
    const pick = (re) => ids.filter((id) => re.test(id) && map.getLayer(id));
    const nameOf = (f) => {
      const raw = String(
        f.properties?.["name:ko"] ||
          f.properties?.["name:nonlatin"] ||
          f.properties?.name ||
          "",
      ).trim();
      const cut = raw.indexOf("(");
      return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
    };
    const unique = (layerIds) => {
      if (!layerIds.length) return { n: 0, samples: [], featN: 0 };
      const feats = map.queryRenderedFeatures({ layers: layerIds });
      const names = [...new Set(feats.map(nameOf).filter(Boolean))];
      return { n: names.length, samples: names.slice(0, 10), featN: feats.length };
    };

    const roadMajor = unique(pick(/^road_name_major$/));
    const roadSecondary = unique(pick(/^road_name_secondary$/));
    const roadAllLayers = pick(/^road_name_(major|secondary)$/);
    const roadAll = unique(roadAllLayers);

    const hiddenPresent = hiddenIds.filter((id) => !!map.getLayer(id));
    const hiddenFeats = hiddenPresent.length
      ? map.queryRenderedFeatures({ layers: hiddenPresent }).length
      : 0;
    const shieldFeats = ["highway-shield-non-us", "highway-shield-us-interstate", "road_shield_us"]
      .filter((id) => !!map.getLayer(id))
      .reduce((n, id) => n + map.queryRenderedFeatures({ layers: [id] }).length, 0);

    const shop = unique(pick(/shop_poi_label|sangga_shop_label/));
    const dong = unique(
      pick(/label_dong|place_suburb|place_neighbourhood|korea_.*dong/),
    );
    const station = unique(
      pick(/korea_station|poi_transit|station_label/),
    );
    const landmark = unique(
      pick(/landmark_label|landmark_priority|korea_landmark/),
    );

    const gilLeak = roadAll.samples.filter((n) => n.endsWith("길"));
    const refLike = roadAll.samples.filter((n) => /^[A-Za-z0-9\-]+$/.test(n));

    return {
      zoom: map.getZoom(),
      roadMajor,
      roadSecondary,
      roadAll,
      shop,
      dong,
      station,
      landmark,
      hiddenFeats,
      shieldFeats,
      gilLeak,
      refLike,
      layers: {
        major: Boolean(map.getLayer("road_name_major")),
        secondary: Boolean(map.getLayer("road_name_secondary")),
      },
    };
  }, HIDDEN_ROAD_IDS);
}

async function main() {
  const token = e2eToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
  });
  const page = await context.newPage();

  if (!SKIP_DEPLOY_PROBE) {
    const ok = await waitDeploy(page, token);
    if (!ok) {
      console.error("deploy_probe_timeout");
      await browser.close();
      process.exit(2);
    }
  } else {
    await page.goto(
      `${BASE}/map-preview?mode=nopins&theme=paper&selfTiles=1&lat=37.5563&lng=126.9236&z=15&e2e=${token}&t=${Date.now()}`,
      { waitUntil: "domcontentloaded", timeout: 120000 },
    );
    await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
      timeout: 90000,
    });
  }

  const rows = [];
  for (const hub of HUBS) {
    await page.evaluate(
      async ({ lat, lng, z }) => {
        const map = window.__PINDMAP_PREVIEW_MAP__;
        map.jumpTo({ zoom: z, center: [lng, lat] });
        await new Promise((resolve) => {
          map.once("idle", () => resolve());
          window.setTimeout(resolve, 5000);
        });
        await new Promise((r) => setTimeout(r, 800));
      },
      hub,
    );
    const m = await measure(page);
    const shot = path.join(OUT, `${TAG}-${hub.id}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    const line = [
      hub.id,
      `road=${m.roadAll.n}`,
      `major=${m.roadMajor.n}`,
      `sec=${m.roadSecondary.n}`,
      `shop=${m.shop.n}`,
      `dong=${m.dong.n}`,
      `st=${m.station.n}`,
      `lm=${m.landmark.n}`,
      `hidden=${m.hiddenFeats}`,
      `shield=${m.shieldFeats}`,
      `samples=${m.roadAll.samples.join("|")}`,
    ].join(" ");
    console.log(line);
    rows.push({ hub: hub.id, ...m, screenshot: shot });
  }

  const summaryPath = path.join(OUT, `${TAG}-summary.json`);
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({ tag: TAG, base: BASE, at: new Date().toISOString(), rows }, null, 2),
  );
  console.error("wrote", summaryPath);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
