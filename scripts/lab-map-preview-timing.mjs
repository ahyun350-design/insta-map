/**
 * Lab: MapLibre /map-preview cold vs warm timings + network buckets.
 * Playwright webkit, iPhone 13 viewport. Not part of npm run e2e.
 *
 * Usage: node scripts/lab-map-preview-timing.mjs [baseURL]
 */
import { chromium, webkit, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || process.env.LAB_BASE_URL || "https://pindmap.com";
const OUT = path.join(process.cwd(), "scripts", "lab-map-preview-timing-out.json");
const RUNS = 3;
const iphone = devices["iPhone 13"];

function classify(url) {
  const u = url.toLowerCase();
  if (u.includes("/map-overlay/subway") || u.includes("subway.json")) return "subway_overlay";
  if (u.includes("korea") && (u.includes("gu") || u.includes("label"))) return "gu_labels";
  if (u.includes("/styles/") || (u.includes("openfreemap") && u.includes("liberty") && !u.includes("/tiles/")))
    return "style_json";
  if (u.includes("tilejson") || (u.endsWith(".json") && (u.includes("tiles.") || u.includes("openfreemap"))))
    return "tilejson";
  if (u.includes("glyphs") || u.includes("/fonts/") || u.includes(".pbf") && u.includes("font"))
    return "glyphs";
  if (u.includes("sprite")) return "sprite";
  if (
    u.includes("/tiles/") ||
    u.includes(".pbf") ||
    u.includes("openmaptiles") ||
    /\d+\/\d+\/\d+/.test(u)
  )
    return "tiles";
  if (u.includes("/map-overlay/") || u.includes("/geojson/")) return "our_assets";
  return "other";
}

function emptyBucket() {
  return { count: 0, bytes: 0, ms: 0, cached: 0, fromNetwork: 0 };
}

async function oneVisit(browser, { clearCache }) {
  const context = await browser.newContext({
    ...iphone,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  if (clearCache) {
    await context.clearCookies();
    await context.route("**/*", async (route) => {
      const headers = {
        ...route.request().headers(),
        "cache-control": "no-cache",
        pragma: "no-cache",
      };
      await route.continue({ headers });
    });
  }
  const page = await context.newPage();
  const net = {
    style_json: emptyBucket(),
    tilejson: emptyBucket(),
    tiles: emptyBucket(),
    glyphs: emptyBucket(),
    sprite: emptyBucket(),
    subway_overlay: emptyBucket(),
    gu_labels: emptyBucket(),
    our_assets: emptyBucket(),
    other: emptyBucket(),
  };
  const t0 = Date.now();
  page.on("response", async (res) => {
    try {
      const req = res.request();
      if (req.resourceType() === "document" && !res.url().includes("openfreemap") && !res.url().includes("map-overlay")) {
        // still classify
      }
      const bucket = classify(res.url());
      const b = net[bucket] || net.other;
      b.count += 1;
      const timing = res.request().timing();
      const start = timing.responseStart >= 0 ? timing.responseStart : 0;
      const end = timing.responseEnd >= 0 ? timing.responseEnd : start;
      b.ms += Math.max(0, end - start);
      const fromCache =
        res.fromServiceWorker() ||
        (await res.headerValue("x-cache"))?.toLowerCase()?.includes("hit") ||
        res.status() === 304;
      // Playwright: encoded body size; -1 when from cache / unavailable
      const cl = await res.headerValue("content-length");
      const n = cl != null ? Number(cl) : NaN;
      if (Number.isFinite(n) && n >= 0) b.bytes += n;
      const cacheHeader = (await res.headerValue("cf-cache-status"))
        || (await res.headerValue("x-vercel-cache"))
        || (await res.headerValue("x-cache"))
        || "";
      const cachedHit =
        res.fromServiceWorker() ||
        res.status() === 304 ||
        /hit/i.test(cacheHeader);
      if (cachedHit) b.cached += 1;
      else b.fromNetwork += 1;
    } catch {
      /* ignore */
    }
  });

  await page.goto(`${BASE}/map-preview`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const d = window.__PINDMAP_PREVIEW_DIAG__;
      return d && d.loadMs != null;
    },
    { timeout: 45_000 },
  );
  // Prefer idle phase when published (post map_gl_timing deploy)
  await page.waitForFunction(
    () => {
      const d = window.__PINDMAP_PREVIEW_DIAG__;
      return d && (d.idleMs != null || d.styleLoadMs != null);
    },
    { timeout: 20_000 },
  ).catch(() => {});
  // Allow tiles / overlay to settle
  await page.waitForTimeout(1500);
  const diag = await page.evaluate(() => window.__PINDMAP_PREVIEW_DIAG__);
  const wallMs = Date.now() - t0;
  await context.close();
  return { wallMs, diag, net };
}

async function main() {
  let browserType = webkit;
  let engine = "webkit";
  try {
    const b = await webkit.launch({ headless: true });
    await b.close();
  } catch {
    browserType = chromium;
    engine = "chromium_fallback";
    console.warn("[lab] webkit unavailable — falling back to chromium (iPhone 13 viewport)");
  }

  const browser = await browserType.launch({ headless: true });
  const results = { base: BASE, engine, cold: [], warm: [] };

  for (let i = 0; i < RUNS; i++) {
    // Cold: new context, no prior map-preview assets in that context
    const cold = await oneVisit(browser, { clearCache: true });
    results.cold.push(cold);
    console.log(`[lab] cold ${i + 1}`, {
      wallMs: cold.wallMs,
      jsMs: cold.diag?.jsMs,
      createMs: cold.diag?.createMs,
      styleLoadMs: cold.diag?.styleLoadMs,
      idleMs: cold.diag?.idleMs,
      pinsMs: cold.diag?.pinsMs,
      loadMs: cold.diag?.loadMs,
    });
  }

  // Warm: reuse one context for 3 navigations so HTTP cache can hit
  const warmCtx = await browser.newContext({
    ...iphone,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  // Prime
  {
    const page = await warmCtx.newPage();
    await page.goto(`${BASE}/map-preview`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(
      () => window.__PINDMAP_PREVIEW_DIAG__?.loadMs != null,
      { timeout: 45_000 },
    );
    await page.close();
  }
  for (let i = 0; i < RUNS; i++) {
    const page = await warmCtx.newPage();
    const net = {
      style_json: emptyBucket(),
      tilejson: emptyBucket(),
      tiles: emptyBucket(),
      glyphs: emptyBucket(),
      sprite: emptyBucket(),
      subway_overlay: emptyBucket(),
      gu_labels: emptyBucket(),
      our_assets: emptyBucket(),
      other: emptyBucket(),
    };
    const t0 = Date.now();
    page.on("response", async (res) => {
      try {
        const bucket = classify(res.url());
        const b = net[bucket] || net.other;
        b.count += 1;
        const timing = res.request().timing();
        const start = timing.responseStart >= 0 ? timing.responseStart : 0;
        const end = timing.responseEnd >= 0 ? timing.responseEnd : start;
        b.ms += Math.max(0, end - start);
        const cl = await res.headerValue("content-length");
        const n = cl != null ? Number(cl) : NaN;
        if (Number.isFinite(n) && n >= 0) b.bytes += n;
        const cacheHeader = (await res.headerValue("cf-cache-status"))
          || (await res.headerValue("x-vercel-cache"))
          || (await res.headerValue("x-cache"))
          || "";
        const cachedHit =
          res.fromServiceWorker() ||
          res.status() === 304 ||
          /hit/i.test(cacheHeader);
        if (cachedHit) b.cached += 1;
        else b.fromNetwork += 1;
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/map-preview`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const d = window.__PINDMAP_PREVIEW_DIAG__;
        return d && d.loadMs != null && (d.idleMs != null || d.styleLoadMs != null);
      },
      { timeout: 45_000 },
    );
    await page.waitForTimeout(1500);
    const diag = await page.evaluate(() => window.__PINDMAP_PREVIEW_DIAG__);
    const wallMs = Date.now() - t0;
    results.warm.push({ wallMs, diag, net });
    console.log(`[lab] warm ${i + 1}`, {
      wallMs,
      jsMs: diag?.jsMs,
      createMs: diag?.createMs,
      styleLoadMs: diag?.styleLoadMs,
      idleMs: diag?.idleMs,
      pinsMs: diag?.pinsMs,
      loadMs: diag?.loadMs,
    });
    await page.close();
  }
  await warmCtx.close();
  await browser.close();

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log("[lab] wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
