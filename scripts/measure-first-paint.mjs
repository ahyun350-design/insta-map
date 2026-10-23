/**
 * First-paint timing for admin self-tiles map-preview.
 * Usage:
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
 *   MEASURE_TAG=before|after \
 *   node scripts/measure-first-paint.mjs
 *
 * Profiles: unlimited + Slow 4G (CDP). Cold (cache cleared) + warm (reload).
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
const TAG = process.env.MEASURE_TAG || "after";
const OUT = path.join(process.cwd(), "e2e/artifacts/first-paint-local");
fs.mkdirSync(OUT, { recursive: true });

const HUBS = [
  { id: "mangwon", lat: 37.5565, lng: 126.9019, z: 15 },
  { id: "hongdae", lat: 37.5572, lng: 126.924, z: 15 },
  { id: "hongcheon", lat: 37.697, lng: 127.889, z: 12 },
];

/** CDP Slow 4G-ish (downlink Mbps, RTT ms). */
const NET = {
  unlimited: null,
  "4g": { offline: false, downloadThroughput: ((1.6 * 1024 * 1024) / 8), uploadThroughput: ((0.75 * 1024 * 1024) / 8), latency: 150 },
};

async function applyNet(cdp, profile) {
  if (!profile) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });
    return;
  }
  await cdp.send("Network.emulateNetworkConditions", profile);
}

async function measureOnce(page, hub, token) {
  const extra = process.env.MEASURE_QUERY_EXTRA || "";
  const q = `mode=nopins&theme=paper&selfTiles=1&lat=${hub.lat}&lng=${hub.lng}&z=${hub.z}&e2e=${token}&t=${Date.now()}${extra}`;
  const navT0 = Date.now();
  await page.goto(`${BASE}/map-preview?${q}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
    timeout: 90000,
  });
  const result = await page.evaluate(async () => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    const t0 =
      window.__PINDMAP_PREVIEW_MAP_T0__ ||
      (typeof performance !== "undefined" ? performance.now() : Date.now());
    const now = () =>
      typeof performance !== "undefined" ? performance.now() : Date.now();

    const shopRe = /shop_poi_label|sangga_shop_label/;
    const labelRe =
      /label_|_label|mountain_peak|gu_overlay|dong|station_label|park_name|water_name|town_|suburb_|place_/;

    let firstBasemap = null;
    let firstLabel = null;
    let firstShop = null;

    const sample = () => {
      const style = map.getStyle();
      if (!style) return;
      const ids = style.layers.map((l) => l.id);
      // Basemap: any filled land/water/road layer with features
      if (firstBasemap == null) {
        const baseIds = ids.filter(
          (id) =>
            /^(landcover|landuse|water$|road_|bridge_|tunnel_|building)/.test(id) &&
            map.getLayer(id),
        );
        for (const id of baseIds.slice(0, 12)) {
          try {
            if (map.queryRenderedFeatures({ layers: [id] }).length > 0) {
              firstBasemap = Math.round(now() - t0);
              break;
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (firstLabel == null) {
        const labelIds = ids.filter(
          (id) => labelRe.test(id) && map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none",
        );
        for (const id of labelIds) {
          try {
            if (map.queryRenderedFeatures({ layers: [id] }).length > 0) {
              firstLabel = Math.round(now() - t0);
              break;
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (firstShop == null) {
        const shopIds = ids.filter((id) => shopRe.test(id) && map.getLayer(id));
        for (const id of shopIds) {
          try {
            if (map.queryRenderedFeatures({ layers: [id] }).length > 0) {
              firstShop = Math.round(now() - t0);
              break;
            }
          } catch {
            /* ignore */
          }
        }
      }
    };

    const deadline = now() + 25000;
    while (now() < deadline && (firstBasemap == null || firstLabel == null)) {
      sample();
      if (firstBasemap != null && firstLabel != null && (firstShop != null || now() - t0 > 8000)) {
        break;
      }
      await new Promise((r) => {
        map.once("render", () => r());
        setTimeout(r, 200);
      });
    }
    sample();

    // Resource waterfall summary
    const entries =
      typeof performance !== "undefined" && performance.getEntriesByType
        ? performance.getEntriesByType("resource")
        : [];
    let pmtilesBytes = 0;
    let pmtilesN = 0;
    let glyphN = 0;
    let glyphWait = 0;
    let styleMs = null;
    const byHost = {};
    for (const e of entries) {
      const name = String(e.name || "");
      const size = e.transferSize || e.encodedBodySize || 0;
      if (/pmtiles|pindself|pindsangga|pindtour|places-extra/i.test(name)) {
        pmtilesN += 1;
        pmtilesBytes += size;
      }
      if (/\/map\/glyphs\/|\.pbf/i.test(name) && /glyph|Noto|font/i.test(name)) {
        glyphN += 1;
        glyphWait = Math.max(glyphWait, e.duration || 0);
      }
      if (/liberty|style.*json|openfreemap/i.test(name) && styleMs == null) {
        styleMs = Math.round(e.duration || 0);
      }
      try {
        const u = new URL(name);
        byHost[u.host] = (byHost[u.host] || 0) + size;
      } catch {
        /* ignore */
      }
    }
    const diag = window.__PINDMAP_PREVIEW_DIAG__ || {};
    return {
      firstBasemapMs: firstBasemap,
      firstLabelMs: firstLabel,
      firstShopMs: firstShop,
      styleLoadMs: diag.styleLoadMs ?? styleMs,
      createMs: diag.createMs ?? null,
      idleMs: diag.idleMs ?? null,
      loadMs: diag.loadMs ?? null,
      pmtilesRequests: pmtilesN,
      pmtilesBytes,
      glyphRequests: glyphN,
      glyphMaxDurationMs: Math.round(glyphWait),
      topHosts: Object.entries(byHost)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([h, b]) => ({ host: h, bytes: b })),
    };
  });
  return { ...result, navWallMs: Date.now() - navT0, hub: hub.id };
}

async function main() {
  const token = e2eToken();
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  console.log(`BASE=${BASE} TAG=${TAG}`);

  for (const [netName, netProfile] of Object.entries(NET)) {
    for (const hub of HUBS) {
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        locale: "ko-KR",
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await applyNet(cdp, netProfile);

      // Cold
      await context.clearCookies();
      await page.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {
          /* ignore */
        }
      }).catch(() => {});
      // Best-effort cache clear
      try {
        await cdp.send("Network.clearBrowserCache");
      } catch {
        /* ignore */
      }

      console.error(`→ ${hub.id} ${netName} cold`);
      const cold = await measureOnce(page, hub, token);
      console.error(`→ ${hub.id} ${netName} warm`);
      const warm = await measureOnce(page, hub, token);

      rows.push({
        hub: hub.id,
        net: netName,
        cold,
        warm,
      });
      console.log(
        JSON.stringify({
          hub: hub.id,
          net: netName,
          coldLabel: cold.firstLabelMs,
          warmLabel: warm.firstLabelMs,
          coldBase: cold.firstBasemapMs,
          warmBase: warm.firstBasemapMs,
          coldShop: cold.firstShopMs,
          warmShop: warm.firstShopMs,
          coldPmtiles: cold.pmtilesRequests,
          warmPmtiles: warm.pmtilesRequests,
        }),
      );
      await context.close();
    }
  }

  const summary = {
    base: BASE,
    tag: TAG,
    measured_at: new Date().toISOString(),
    goals: { warmLabelMs: 1000, cold4gLabelMs: 2500 },
    rows,
  };
  const outFile = path.join(OUT, `${TAG}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${outFile}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
