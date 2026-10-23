/**
 * Measure nature/transit labels at hubs on production self-tiles.
 * Usage: PLAYWRIGHT_BASE_URL=https://pindmap.com node scripts/measure-nature-transit.mjs
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
  const raw = process.env.MEASURE_OUT || "e2e/artifacts/nature-transit";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
})();
const TAG = process.env.MEASURE_TAG || "after";
/** Skip deploy layer probe when measuring local builds (default off). */
const SKIP_DEPLOY_PROBE = process.env.SKIP_DEPLOY_PROBE === "1";
const HUBS = [
  { id: "seoul_z10", lat: 37.56, lng: 126.98, z: 10 },
  { id: "bukhansan_z12", lat: 37.6585, lng: 126.977, z: 12 },
  { id: "chuncheon_z13", lat: 37.89, lng: 127.725, z: 13 },
  { id: "seorak_z12", lat: 38.1195, lng: 128.4655, z: 12 },
  { id: "hongdae_z16", lat: 37.5572, lng: 126.924, z: 16 },
  { id: "hongdae_z17", lat: 37.5572, lng: 126.924, z: 17 },
  { id: "gangnam_z17", lat: 37.4979, lng: 127.0276, z: 17 },
];

fs.mkdirSync(OUT, { recursive: true });

async function waitDeploy(page, token, maxMs = 12 * 60 * 1000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await page.goto(
      `${BASE}/map-preview?mode=nopins&theme=paper&selfTiles=1&lat=37.56&lng=126.98&z=12&e2e=${token}&t=${Date.now()}`,
      { waitUntil: "domcontentloaded", timeout: 120000 },
    );
    await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
      timeout: 90000,
    });
    const info = await page.evaluate(() => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      return {
        park: Boolean(map.getLayer("park_name_label_z12")),
        peakZ10: Boolean(map.getLayer("mountain_peak_label_z10")),
        busText: map.getLayer("bus_stop_icon")
          ? map.getLayoutProperty("bus_stop_icon", "text-field") != null
          : false,
      };
    });
    console.error("deploy_probe", JSON.stringify(info));
    if (info.park && info.peakZ10 && info.busText) return true;
    await page.waitForTimeout(25000);
  }
  return false;
}

async function measure(page) {
  return page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    if (!map) return null;
    const style = map.getStyle();
    const ids = style.layers.map((l) => l.id);
    const pick = (re) => ids.filter((id) => re.test(id) && map.getLayer(id));
    const nameOf = (f) =>
      String(
        f.properties?.["name:ko"] ||
          f.properties?.name ||
          f.properties?.ref ||
          "",
      ).trim();
    const count = (layerIds) => {
      if (!layerIds.length) return { n: 0, samples: [], featN: 0 };
      const feats = map.queryRenderedFeatures({ layers: layerIds });
      const names = [...new Set(feats.map(nameOf).filter(Boolean))];
      return { n: names.length, samples: names.slice(0, 8), featN: feats.length };
    };
    const hangul = /[\uac00-\ud7a3]/;
    const shopLayers = pick(/shop_poi_label|sangga_shop_label/);
    let koPreferred = 0;
    let latinOnly = 0;
    if (shopLayers.length) {
      for (const f of map.queryRenderedFeatures({ layers: shopLayers })) {
        const ko = String(f.properties?.["name:ko"] || "").trim();
        const non = String(f.properties?.["name:nonlatin"] || "").trim();
        const en = String(f.properties?.name || "").trim();
        const shown = ko || non || en;
        if ((ko || non) && hangul.test(shown) && en && !hangul.test(en)) {
          koPreferred++;
        } else if (en && !hangul.test(en) && !ko && !non) {
          latinOnly++;
        }
      }
    }
    const symIds = ids.filter(
      (id) =>
        map.getLayer(id) &&
        map.getLayoutProperty(id, "visibility") !== "none" &&
        (map.getStyle().layers.find((l) => l.id === id)?.type === "symbol"),
    );
    let totalLabels = 0;
    for (const id of symIds) {
      try {
        totalLabels += map.queryRenderedFeatures({ layers: [id] }).length;
      } catch {
        /* ignore */
      }
    }
    return {
      peak: count(pick(/mountain_peak|korea_mountain/i)),
      water: count(pick(/water_name|waterway_line_label/i)),
      park: count(pick(/park_name_label/i)),
      subwayLine: ids.some((id) => id.includes("subway_overlay_line")),
      exits: count(pick(/subway_overlay_exit$/)),
      bus: count(pick(/bus_stop/)),
      totalLabels,
      koPreferred,
      latinOnly,
      layers: {
        park: Boolean(map.getLayer("park_name_label_z12")),
        peakZ10: Boolean(map.getLayer("mountain_peak_label_z10")),
      },
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

  if (process.env.WAIT_DEPLOY === "1" && !SKIP_DEPLOY_PROBE) {
    const ok = await waitDeploy(page, token);
    console.error(ok ? "DEPLOY_OK" : "DEPLOY_TIMEOUT");
  }

  const rows = [];
  let koSwap = 0;
  let latinKeep = 0;
  console.log(`BASE=${BASE} TAG=${TAG}`);

  for (const h of HUBS) {
    const q = `mode=nopins&theme=paper&selfTiles=1&lat=${h.lat}&lng=${h.lng}&z=${h.z}&e2e=${token}&t=${Date.now()}`;
    console.error(`→ ${h.id}`);
    await page.goto(`${BASE}/map-preview?${q}`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
      timeout: 90000,
    });
    await page.waitForTimeout(2000);
    await page.evaluate(
      (ms) =>
        new Promise((r) => {
          const m = window.__PINDMAP_PREVIEW_MAP__;
          m.once("idle", () => r());
          setTimeout(r, ms);
        }),
      12000,
    );
    const m = await measure(page);
    koSwap += m?.koPreferred || 0;
    latinKeep += m?.latinOnly || 0;
    const shot = `${h.id}-${TAG}.png`;
    await page
      .locator(".map-preview-gl-canvas, .map-preview-gl-root")
      .first()
      .screenshot({ path: path.join(OUT, shot) })
      .catch(() => {});
    rows.push({ hub: h.id, ...m, shot });
    console.log(
      JSON.stringify({
        hub: h.id,
        peak: m?.peak?.n,
        water: m?.water?.n,
        park: m?.park?.n,
        subway: m?.subwayLine,
        exits: m?.exits?.n,
        bus: m?.bus?.n,
        samples: {
          peak: m?.peak?.samples,
          water: m?.water?.samples,
          park: m?.park?.samples,
          bus: m?.bus?.samples,
        },
        layers: m?.layers,
      }),
    );
  }

  const summary = {
    base: BASE,
    tag: TAG,
    measured_at: new Date().toISOString(),
    koPreferredTotal: koSwap,
    latinOnlyTotal: latinKeep,
    rows,
  };
  fs.writeFileSync(
    path.join(OUT, `${TAG}.json`),
    JSON.stringify(summary, null, 2),
  );
  console.log(`KO_SWAP=${koSwap} LATIN_KEEP=${latinKeep}`);
  console.log(`Wrote ${OUT}/${TAG}.json`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
