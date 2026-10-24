/**
 * Measure Juso building_kr fill/number labels at hubs (local screenshots only).
 *
 * Usage:
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 node scripts/measure-buildings-kr.mjs
 *   PLAYWRIGHT_BASE_URL=https://pindmap.com node scripts/measure-buildings-kr.mjs
 *
 * Writes e2e/artifacts/buildings-kr/ (gitignored screenshots + summary.json).
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
const OUT = path.join(process.cwd(), "e2e/artifacts/buildings-kr");
const ZOOMS = [15, 16, 17];
const HUBS = [
  { id: "hongcheon", label: "홍천읍", lat: 37.697, lng: 127.889 },
  { id: "sokcho", label: "속초 수복탑", lat: 38.207, lng: 128.592 },
  { id: "mangwon", label: "망원", lat: 37.556, lng: 126.9055 },
  { id: "haeundae", label: "해운대", lat: 35.1587, lng: 129.1604 },
  { id: "jeonju", label: "전주 한옥마을", lat: 35.815, lng: 127.153 },
];

fs.mkdirSync(OUT, { recursive: true });

async function waitIdle(page, ms = 12000) {
  await page.evaluate(
    (timeout) =>
      new Promise((r) => {
        const map = window.__PINDMAP_PREVIEW_MAP__;
        if (!map) return r();
        map.once("idle", () => r());
        setTimeout(r, timeout);
      }),
    ms,
  );
  await page.waitForTimeout(500);
}

async function measureBuildings(page) {
  return page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    if (!map) {
      return {
        omt_building: 0,
        kr_fill: 0,
        kr_number: 0,
        hasKrSource: false,
        hasKrFill: false,
        hasKrNumber: false,
        firstKrMs: null,
      };
    }
    const style = map.getStyle();
    const hasKrSource = Boolean(style.sources?.korea_buildings);
    const hasKrFill = Boolean(map.getLayer("building_kr_fill"));
    const hasKrNumber = Boolean(map.getLayer("building_kr_number"));
    const hasOmt = Boolean(map.getLayer("building"));

    const omt = hasOmt
      ? map.queryRenderedFeatures({ layers: ["building"] }).length
      : 0;
    const krFill = hasKrFill
      ? map.queryRenderedFeatures({ layers: ["building_kr_fill"] }).length
      : 0;
    const krNumber = hasKrNumber
      ? map.queryRenderedFeatures({ layers: ["building_kr_number"] }).length
      : 0;

    return {
      omt_building: omt,
      kr_fill: krFill,
      kr_number: krNumber,
      hasKrSource,
      hasKrFill,
      hasKrNumber,
      zoom: map.getZoom(),
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
  });
  const page = await context.newPage();
  const token = e2eToken();
  const rows = [];

  console.log(`BASE=${BASE}`);

  for (const hub of HUBS) {
    for (const z of ZOOMS) {
      const q = `mode=nopins&theme=paper&selfTiles=1&lat=${hub.lat}&lng=${hub.lng}&z=${z}&e2e=${token}&t=${Date.now()}`;
      const url = `${BASE}/map-preview?${q}`;
      console.error(`→ ${hub.id} z${z}`);
      const t0 = Date.now();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(
        () => window.__PINDMAP_PREVIEW_MAP__ != null,
        null,
        { timeout: 90000 },
      );
      await waitIdle(page, 15000);
      // Settle PMTiles Range fetches for buildings
      await page.waitForTimeout(2000);
      await waitIdle(page, 12000);

      let counts = await measureBuildings(page);
      // Wait up to ~8s more if KR fill still empty (cold NCP)
      if (counts.hasKrSource && counts.kr_fill === 0) {
        for (let i = 0; i < 4; i++) {
          await page.waitForTimeout(2000);
          await waitIdle(page, 8000);
          counts = await measureBuildings(page);
          if (counts.kr_fill > 0) break;
        }
      }
      const firstPaintMs = Date.now() - t0;

      const shot = `${hub.id}-z${z}.png`;
      await page
        .locator(".map-preview-gl-canvas, .map-preview-gl-root")
        .first()
        .screenshot({ path: path.join(OUT, shot) });

      const row = {
        hub: hub.id,
        label: hub.label,
        z,
        omt_building: counts.omt_building,
        kr_fill: counts.kr_fill,
        kr_number: counts.kr_number,
        hasKrSource: counts.hasKrSource,
        hasKrFill: counts.hasKrFill,
        hasKrNumber: counts.hasKrNumber,
        first_idle_ms: firstPaintMs,
        shot,
      };
      rows.push(row);
      console.log(
        JSON.stringify({
          hub: hub.id,
          z,
          omt: counts.omt_building,
          kr_fill: counts.kr_fill,
          kr_no: counts.kr_number,
          source: counts.hasKrSource,
          layers: [counts.hasKrFill, counts.hasKrNumber],
          ms: firstPaintMs,
        }),
      );
    }
  }

  const summary = {
    base: BASE,
    measured_at: new Date().toISOString(),
    note: "before: no building_kr (N/A); after = this run",
    rows,
  };
  fs.writeFileSync(
    path.join(OUT, "summary.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log("\nHUB\tz\tomt\tkr_fill\tkr_no\tms");
  for (const r of rows) {
    console.log(
      `${r.hub}\tz${r.z}\t${r.omt_building}\t${r.kr_fill}\t${r.kr_number}\t${r.first_idle_ms}`,
    );
  }

  await browser.close();
  console.log(`\nWrote ${OUT}/summary.json + screenshots`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
