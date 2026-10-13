/**
 * Bottleneck breakdown for admin self-tiles (Mangwon z16, no HTTP cache).
 * Usage: node scripts/measure-self-bottleneck.mjs
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
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
const MANGWON = [126.9019, 37.5565];

function classify(url) {
  const u = url.toLowerCase();
  if (u.includes("styles/liberty") || u.endsWith("/liberty")) return "style_json";
  if (u.includes("sprite") && (u.endsWith(".json") || u.includes("sprite.json")))
    return "sprite_json";
  if (u.includes("sprite") && (u.endsWith(".png") || u.includes("sprite.png")))
    return "sprite_png";
  if (u.includes("glyph") || /\/fonts?\//.test(u) || /noto%20sans|noto sans/i.test(u))
    return "glyph";
  if (u.includes(".pmtiles") || u.includes("korea-latest")) return "pmtiles";
  if (u.includes("korea-landmarks") || u.includes("korea-station"))
    return "landmarks_geojson";
  if (u.includes("pindself") || u.includes("openfreemap.org/planet") || u.includes(".pbf"))
    return "tile";
  if (u.includes("/map/") && u.endsWith(".geojson")) return "landmarks_geojson";
  return "other";
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
  });
  // Cold-network breakdown: disable HTTP cache (isolates overseas RTT).
  const cold = process.env.BOTTLENECK_COLD !== "0";
  if (cold) {
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
  const buckets = {};
  const bump = (kind, ms, url) => {
    if (!buckets[kind]) buckets[kind] = { count: 0, totalMs: 0, urls: [] };
    buckets[kind].count += 1;
    buckets[kind].totalMs += ms;
    if (buckets[kind].urls.length < 8) buckets[kind].urls.push({ ms: Math.round(ms), url: url.slice(0, 100) });
  };

  page.on("response", async (res) => {
    try {
      const req = res.request();
      const url = res.url();
      const timing = req.timing();
      // responseEnd relative; fall back to wall if needed
      let ms = 0;
      if (timing && timing.responseEnd >= 0 && timing.startTime >= 0) {
        ms = timing.responseEnd;
      }
      const kind = classify(url);
      bump(kind, ms, url);
    } catch {
      /* ignore */
    }
  });

  const tNav = Date.now();
  const q = `mode=nopins&theme=paper&selfTiles=1&lat=${MANGWON[1]}&lng=${MANGWON[0]}&z=16&e2e=${e2eToken()}&t=${Date.now()}`;
  await page.goto(`${BASE}/map-preview?${q}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForFunction(
    () => window.__PINDMAP_PREVIEW_MAP_T0__ != null,
    null,
    { timeout: 90000 },
  );

  // Last-location first open: Map() → mangwon labels (hinted).
  const result = await page.evaluate(async () => {
    const hint = /망원|동교|합정|성산|월드컵|옹달샘/;
    const t0 = window.__PINDMAP_PREVIEW_MAP_T0__ ?? performance.now();
    const marks = { jumpMs: 0 };
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      if (!map?.getStyle) {
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
      if (names.filter((n) => hint.test(n)).length >= 1 && names.length >= 3) {
        marks.firstLabelMs = Math.round(performance.now() - t0);
        marks.labels = names.length;
        break;
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    const map = window.__PINDMAP_PREVIEW_MAP__;
    await new Promise((r) => {
      if (!map) return r();
      map.once("idle", () => r());
      setTimeout(r, 5000);
    });
    marks.idleMs = Math.round(performance.now() - t0);
    const src = map?.getSource?.("openmaptiles");
    marks.source = src
      ? {
          tiles: src.tiles?.[0]?.slice?.(0, 40) ?? null,
          maxzoom: src.maxzoom,
        }
      : null;
    return marks;
  });

  // Also pull PerformanceResourceTiming for finer buckets
  const perf = await page.evaluate(() => {
    const entries = performance.getEntriesByType("resource");
    const out = {};
    const add = (k, e) => {
      if (!out[k]) out[k] = { count: 0, totalMs: 0, maxMs: 0, samples: [] };
      const ms = e.duration;
      out[k].count += 1;
      out[k].totalMs += ms;
      out[k].maxMs = Math.max(out[k].maxMs, ms);
      if (out[k].samples.length < 6) {
        out[k].samples.push({
          ms: Math.round(ms),
          name: String(e.name).slice(0, 110),
          transfer: e.transferSize,
        });
      }
    };
    for (const e of entries) {
      const n = e.name;
      if (/styles\/liberty|\/liberty(\?|$)/i.test(n)) add("style_json", e);
      else if (/sprite.*\.json/i.test(n)) add("sprite_json", e);
      else if (/sprite.*\.png/i.test(n)) add("sprite_png", e);
      else if (/glyph|Noto%20Sans|fonts\//i.test(n)) add("glyph", e);
      else if (/korea-latest\.pmtiles|map-tiles\/korea/i.test(n)) add("pmtiles_range", e);
      else if (/korea-landmarks|korea-station/i.test(n)) add("landmarks_geojson", e);
      else if (/openfreemap\.org\/planet|pindself:|\.pbf/i.test(n)) add("tile_or_pbf", e);
      else if (/\/_next\//.test(n)) add("next_asset", e);
    }
    for (const k of Object.keys(out)) {
      out[k].totalMs = Math.round(out[k].totalMs);
      out[k].maxMs = Math.round(out[k].maxMs);
    }
    return out;
  });

  const report = {
    navToMapMs: Date.now() - tNav,
    mangwon: result,
    performanceResources: perf,
    responseBuckets: Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [
        k,
        { count: v.count, totalMs: Math.round(v.totalMs), urls: v.urls },
      ]),
    ),
    at: new Date().toISOString(),
  };
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
