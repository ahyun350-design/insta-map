/**
 * Tile host experiment: Supabase (default) vs NCP Seoul (?tileHost=ncp).
 * Hubs: mangwon / hongdae / hongcheon × unlimited / 4G × cold / warm.
 * iPhone 13 viewport; 4G via Chromium CDP (WebKit cannot emulate network).
 *
 *   MEASURE_TAG=supabase PLAYWRIGHT_BASE_URL=… node scripts/measure-tile-host-exp.mjs
 *   MEASURE_TAG=ncp MEASURE_QUERY_EXTRA='&tileHost=ncp' …
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
const TAG = process.env.MEASURE_TAG || "supabase";
const EXTRA = process.env.MEASURE_QUERY_EXTRA || "";
const OUT = path.join(process.cwd(), "e2e/artifacts/tile-host-exp");
fs.mkdirSync(OUT, { recursive: true });

const HUBS = [
  { id: "mangwon", lat: 37.5565, lng: 126.9019, z: 15 },
  { id: "hongdae", lat: 37.5572, lng: 126.924, z: 15 },
  { id: "hongcheon", lat: 37.697, lng: 127.889, z: 12 },
];

const NET = {
  unlimited: null,
  "4g": {
    offline: false,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (0.75 * 1024 * 1024) / 8,
    latency: 150,
  },
};

function classifyUrl(url) {
  const u = String(url || "");
  if (/korea-buildings|pindbuildings/i.test(u)) return "buildings";
  if (/korea-sangga|pindsangga/i.test(u)) return "sangga";
  if (/korea-tour|pindtour/i.test(u)) return "tour";
  if (/korea-places-extra|pindplaces/i.test(u)) return "places_extra";
  if (/korea-latest|pindself/i.test(u)) return "korea_base";
  if (/\/map\/glyphs\/|glyphs\//i.test(u)) return "glyphs";
  if (/ncloudstorage\.com/i.test(u) && /pmtiles/i.test(u)) return "ncp_other";
  if (/supabase\.co|storage\/v1\/object/i.test(u) && /pmtiles|map-tiles/i.test(u))
    return "supabase_other";
  return "other";
}

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

function emptyBucket() {
  return {
    bytes: 0,
    requests: 0,
    durations: [],
  };
}

async function measureOnce(page, cdp, hub, token) {
  const bySource = {
    korea_base: emptyBucket(),
    sangga: emptyBucket(),
    tour: emptyBucket(),
    places_extra: emptyBucket(),
    buildings: emptyBucket(),
    glyphs: emptyBucket(),
    other: emptyBucket(),
  };
  const reqMeta = new Map(); // requestId -> { url, t0 }

  const onReq = (p) => {
    const url = p.request?.url || "";
    const id = p.requestId;
    if (!id) return;
    reqMeta.set(id, { url, t0: Date.now() });
  };
  const onFinished = (p) => {
    const id = p.requestId;
    const meta = reqMeta.get(id);
    if (!meta) return;
    const src = classifyUrl(meta.url);
    const bucket = bySource[src] || bySource.other;
    const bytes = Number(p.encodedDataLength || 0);
    bucket.bytes += bytes;
    bucket.requests += 1;
    const dur = Math.max(0, Date.now() - meta.t0);
    bucket.durations.push(dur);
  };
  cdp.on("Network.requestWillBeSent", onReq);
  cdp.on("Network.loadingFinished", onFinished);

  const q = `mode=nopins&theme=paper&selfTiles=1&lat=${hub.lat}&lng=${hub.lng}&z=${hub.z}&e2e=${token}&t=${Date.now()}${EXTRA}`;
  const navT0 = Date.now();
  await page.goto(`${BASE}/map-preview?${q}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
    timeout: 90000,
  });

  const paint = await page.evaluate(async () => {
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
      if (firstBasemap == null) {
        for (const id of ids.filter(
          (id) =>
            /^(landcover|landuse|water$|road_|bridge_|tunnel_|building)/.test(id) &&
            map.getLayer(id),
        ).slice(0, 12)) {
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
        for (const id of ids.filter(
          (id) =>
            labelRe.test(id) &&
            map.getLayer(id) &&
            map.getLayoutProperty(id, "visibility") !== "none",
        )) {
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
        for (const id of ids.filter((id) => shopRe.test(id) && map.getLayer(id))) {
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
    const deadline = now() + 28000;
    while (now() < deadline && (firstBasemap == null || firstLabel == null)) {
      sample();
      if (
        firstBasemap != null &&
        firstLabel != null &&
        (firstShop != null || now() - t0 > 10000)
      ) {
        break;
      }
      await new Promise((r) => {
        map.once("render", () => r());
        setTimeout(r, 200);
      });
    }
    sample();
    await new Promise((r) => setTimeout(r, 1500));
    const hostHint =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("tileHost") || "default"
        : "default";
    return {
      firstBasemapMs: firstBasemap,
      firstLabelMs: firstLabel,
      firstShopMs: firstShop,
      tileHost: hostHint,
    };
  });

  // Let late Range responses settle
  await page.waitForTimeout(2500);
  cdp.off("Network.requestWillBeSent", onReq);
  cdp.off("Network.loadingFinished", onFinished);

  const sources = {};
  let totalBytes = 0;
  let totalReq = 0;
  const allDur = [];
  for (const [k, v] of Object.entries(bySource)) {
    const avg =
      v.durations.length > 0
        ? Math.round(
            v.durations.reduce((a, b) => a + b, 0) / v.durations.length,
          )
        : null;
    sources[k] = {
      bytes: v.bytes,
      requests: v.requests,
      avgDelayMs: avg,
    };
    totalBytes += v.bytes;
    totalReq += v.requests;
    allDur.push(...v.durations);
  }

  return {
    hub: hub.id,
    ...paint,
    navWallMs: Date.now() - navT0,
    totalBytes,
    totalRequests: totalReq,
    avgDelayMs:
      allDur.length > 0
        ? Math.round(allDur.reduce((a, b) => a + b, 0) / allDur.length)
        : null,
    sources,
  };
}

async function main() {
  const token = e2eToken();
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  console.log(`BASE=${BASE} TAG=${TAG} EXTRA=${EXTRA || "(none)"}`);

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

      try {
        await cdp.send("Network.clearBrowserCache");
      } catch {
        /* ignore */
      }
      await context.clearCookies();

      console.error(`→ ${hub.id} ${netName} cold`);
      const cold = await measureOnce(page, cdp, hub, token);
      console.error(`→ ${hub.id} ${netName} warm`);
      const warm = await measureOnce(page, cdp, hub, token);

      rows.push({ hub: hub.id, net: netName, cold, warm });
      console.log(
        JSON.stringify({
          hub: hub.id,
          net: netName,
          cold: {
            base: cold.firstBasemapMs,
            label: cold.firstLabelMs,
            shop: cold.firstShopMs,
            bytes: cold.totalBytes,
            req: cold.totalRequests,
            avgMs: cold.avgDelayMs,
          },
          warm: {
            base: warm.firstBasemapMs,
            label: warm.firstLabelMs,
            shop: warm.firstShopMs,
            bytes: warm.totalBytes,
            req: warm.totalRequests,
            avgMs: warm.avgDelayMs,
          },
        }),
      );
      await context.close();
    }
  }

  const summary = {
    tag: TAG,
    base: BASE,
    extra: EXTRA,
    at: new Date().toISOString(),
    viewport: "iPhone 13 (Chromium; 4G via CDP)",
    rows,
  };
  const outFile = path.join(OUT, `${TAG}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.error("wrote", outFile);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
