/**
 * Compare OFM glyphs vs same-origin /map/glyphs with selfTiles=1.
 * Metrics: mangwon z16 first paint; Seoul→Busan search jump settle.
 *
 * Usage:
 *   MEASURE_BASE=https://pindmap.com node scripts/measure-glyph-latency.mjs
 *   MEASURE_BASE=http://127.0.0.1:3000 MEASURE_GLYPH=local node ...
 */
import { chromium, devices } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv(".env.local");

const BASE = (process.env.MEASURE_BASE || "https://pindmap.com").replace(/\/$/, "");
const tok = createHash("sha256")
  .update(
    `pindmap-map-preview-e2e:v1:${(
      process.env.EXTRACT_INTERNAL_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ""
    ).trim()}`,
  )
  .digest("hex")
  .slice(0, 32);

function withE2e(path) {
  const u = new URL(path, BASE);
  u.searchParams.set("e2e", "1");
  u.searchParams.set("e2e_tok", tok);
  return u.pathname + u.search;
}

async function runOnce(label, forceGlyph) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["iPhone 13"], locale: "ko-KR" });
  const page = await context.newPage();
  const glyphReqs = [];
  page.on("response", (r) => {
    const u = r.url();
    if (/glyphs|\/fonts\//i.test(u) && /\.pbf/i.test(u)) {
      glyphReqs.push({ status: r.status(), url: u.slice(0, 120), ms: 0 });
    }
  });

  // Mangwon z16 first paint
  const mangwonPath = withE2e(
    `/map-preview?mode=nopins&theme=paper&selfTiles=1&lat=37.556&lng=126.9055&z=16`,
  );
  const tNav = Date.now();
  await page.goto(BASE + mangwonPath, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => !!(window).__PINDMAP_PREVIEW_MAP__, { timeout: 90000 });

  if (forceGlyph === "ofm") {
    await page.evaluate(() => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      const style = map.getStyle();
      style.glyphs = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
      // Can't easily reset style glyphs mid-flight; record current for comparison runs only.
    });
  }

  const firstPaint = await page.evaluate(async () => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    const t0 = performance.now();
    await new Promise((r) => {
      const done = () => r(null);
      map.once("idle", done);
      setTimeout(done, 20000);
    });
    let baseN = 0;
    let shopN = 0;
    try {
      const ids = (map.getStyle().layers || [])
        .filter((l) => l.source === "openmaptiles" && (l.type === "fill" || l.type === "line"))
        .map((l) => l.id)
        .filter((id) => map.getLayer(id));
      baseN = map.queryRenderedFeatures(undefined, { layers: ids }).length;
      const shopIds = (map.getStyle().layers || [])
        .map((l) => l.id)
        .filter((id) => /shop_poi|landmark_label/i.test(id) && map.getLayer(id));
      shopN = shopIds.length
        ? map.queryRenderedFeatures(undefined, { layers: shopIds }).length
        : 0;
    } catch {
      /* ignore */
    }
    return {
      idleMs: Math.round(performance.now() - t0),
      glyphs: map.getStyle().glyphs,
      baseN,
      shopN,
      tiles0: map.getSource("openmaptiles")?.tiles?.[0] ?? null,
    };
  });
  const mangwonNavMs = Date.now() - tNav;

  // Seoul → Busan camera jump
  const tJump = Date.now();
  const jump = await page.evaluate(async () => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    const t0 = performance.now();
    map.jumpTo({ center: [129.0756, 35.1796], zoom: 14 }); // Busan
    await new Promise((r) => {
      map.once("idle", () => r(null));
      setTimeout(() => r(null), 20000);
    });
    let baseN = 0;
    try {
      const ids = (map.getStyle().layers || [])
        .filter((l) => l.source === "openmaptiles" && (l.type === "fill" || l.type === "line"))
        .map((l) => l.id)
        .filter((id) => map.getLayer(id));
      baseN = map.queryRenderedFeatures(undefined, { layers: ids }).length;
    } catch {
      /* ignore */
    }
    return { settleMs: Math.round(performance.now() - t0), baseN };
  });
  const jumpWallMs = Date.now() - tJump;

  const glyphHosts = {};
  for (const g of glyphReqs) {
    try {
      const host = new URL(g.url).host + (g.url.includes("/map/glyphs") ? "/map/glyphs" : "/fonts");
      glyphHosts[host] = (glyphHosts[host] || 0) + 1;
    } catch {
      /* ignore */
    }
  }

  await browser.close();
  return {
    label,
    mangwonNavMs,
    mangwonIdleMs: firstPaint.idleMs,
    mangwonBaseN: firstPaint.baseN,
    mangwonShopN: firstPaint.shopN,
    glyphs: firstPaint.glyphs,
    tiles0: firstPaint.tiles0,
    busanJumpMs: jump.settleMs,
    busanJumpWallMs: jumpWallMs,
    busanBaseN: jump.baseN,
    glyphHosts,
    glyphReqCount: glyphReqs.length,
  };
}

const local = await runOnce("local-same-origin", "local");
console.log(JSON.stringify({ local }, null, 2));
