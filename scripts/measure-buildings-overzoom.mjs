/**
 * WebKit iPhone viewport: mangwon building_kr counts at z17/z18/z19.
 * Fail if any zoom has kr_fill === 0.
 *
 *   PLAYWRIGHT_BASE_URL=… node scripts/measure-buildings-overzoom.mjs
 */
import { webkit, devices } from "playwright";
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
const OUT = path.join(process.cwd(), "e2e/artifacts/buildings-overzoom");
fs.mkdirSync(OUT, { recursive: true });

const HUB = { lat: 37.556, lng: 126.9055 };
const ZOOMS = [17, 18, 19];

async function main() {
  const token = e2eToken();
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
  });
  const page = await context.newPage();
  await page.goto(
    `${BASE}/map-preview?mode=nopins&theme=paper&selfTiles=1&lat=${HUB.lat}&lng=${HUB.lng}&z=16&e2e=${token}&t=${Date.now()}`,
    { waitUntil: "domcontentloaded", timeout: 120000 },
  );
  await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
    timeout: 90000,
  });
  await page.waitForTimeout(5000);

  const rows = [];
  for (const z of ZOOMS) {
    await page.evaluate(async ({ lat, lng, z }) => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      map.jumpTo({ zoom: z, center: [lng, lat] });
      await new Promise((r) => {
        map.once("idle", r);
        setTimeout(r, 8000);
      });
      await new Promise((r) => setTimeout(r, 1500));
    }, { ...HUB, z });
    const m = await page.evaluate(() => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      const src = map.getSource("korea_buildings");
      return {
        zoom: map.getZoom(),
        kr_fill: map.getLayer("building_kr_fill")
          ? map.queryRenderedFeatures({ layers: ["building_kr_fill"] }).length
          : 0,
        kr_outline: map.getLayer("building_kr_outline")
          ? map.queryRenderedFeatures({ layers: ["building_kr_outline"] }).length
          : 0,
        kr_number: map.getLayer("building_kr_number")
          ? map.queryRenderedFeatures({ layers: ["building_kr_number"] }).length
          : 0,
        omt_building: map.getLayer("building")
          ? map.queryRenderedFeatures({ layers: ["building"] }).length
          : 0,
        src_maxzoom: src?.maxzoom ?? null,
        fill_maxzoom: map.getLayer("building_kr_fill")
          ? map.getLayer("building_kr_fill").maxzoom
          : null,
        omt_visible: map.getLayer("building")
          ? map.getLayoutProperty("building", "visibility")
          : null,
      };
    });
    console.log(JSON.stringify({ z, ...m }));
    rows.push({ z, ...m });
    await page.screenshot({
      path: path.join(OUT, `mangwon-z${z}.png`),
      fullPage: false,
    });
  }

  const summary = {
    base: BASE,
    at: new Date().toISOString(),
    engine: "webkit",
    device: "iPhone 13",
    rows,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  const bad = rows.filter((r) => r.kr_fill <= 0);
  await browser.close();
  if (bad.length) {
    console.error("FAIL empty building_kr at", bad.map((r) => r.z));
    process.exit(2);
  }
  console.error("OK wrote", path.join(OUT, "summary.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
