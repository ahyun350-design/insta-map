/**
 * Measure admin_dong / admin_sigungu labels at hubs (z12/z13/z15)
 * on production self-tiles + screenshots.
 *
 * Usage:
 *   PLAYWRIGHT_BASE_URL=https://pindmap.com node scripts/measure-admin-place-labels.mjs
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
const OUT = path.join(process.cwd(), "e2e/artifacts/admin-place-labels");
const ZOOMS = [12, 13, 15];
const HUBS = [
  { id: "mangwon", label: "망원", lat: 37.556, lng: 126.9055 },
  { id: "hongdae", label: "홍대", lat: 37.5572, lng: 126.924 },
  { id: "gangnam", label: "강남", lat: 37.4979, lng: 127.0276 },
  { id: "jeonju", label: "전주한옥마을", lat: 35.815, lng: 127.15 },
  { id: "gangneung", label: "강릉중앙시장", lat: 37.754, lng: 128.898 },
  { id: "haeundae", label: "해운대", lat: 35.1587, lng: 129.1604 },
  { id: "chuncheon", label: "춘천", lat: 37.8813, lng: 127.73 },
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
  await page.waitForTimeout(600);
}

async function countLabels(page) {
  return page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    if (!map) {
      return {
        dong: 0,
        sigungu: 0,
        hasDong: false,
        hasSigungu: false,
        hasSource: false,
        samplesDong: [],
        samplesSigungu: [],
      };
    }
    const style = map.getStyle();
    const hasSource = Boolean(style.sources?.korea_places_extra);
    const hasDong = Boolean(map.getLayer("admin_dong_label"));
    const hasSigungu = Boolean(map.getLayer("admin_sigungu_label"));
    const nameOf = (f) =>
      String(f.properties?.["name:ko"] || f.properties?.name || "").trim();

    const dongFeats = hasDong
      ? map.queryRenderedFeatures({ layers: ["admin_dong_label"] })
      : [];
    const sigFeats = hasSigungu
      ? map.queryRenderedFeatures({ layers: ["admin_sigungu_label"] })
      : [];
    const dongNames = [...new Set(dongFeats.map(nameOf).filter(Boolean))];
    const sigNames = [...new Set(sigFeats.map(nameOf).filter(Boolean))];

    return {
      dong: dongNames.length,
      sigungu: sigNames.length,
      hasDong,
      hasSigungu,
      hasSource,
      samplesDong: dongNames.slice(0, 10),
      samplesSigungu: sigNames.slice(0, 10),
      zoom: map.getZoom(),
      sourceMinzoom: style.sources?.korea_places_extra?.minzoom ?? null,
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
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(
        () => window.__PINDMAP_PREVIEW_MAP__ != null,
        null,
        { timeout: 90000 },
      );
      await waitIdle(page, 15000);
      await page.waitForTimeout(1500);
      await waitIdle(page, 10000);

      const counts = await countLabels(page);
      const shot = `${hub.id}-z${z}.png`;
      await page
        .locator(".map-preview-gl-canvas, .map-preview-gl-root")
        .first()
        .screenshot({ path: path.join(OUT, shot) });

      const row = {
        hub: hub.id,
        label: hub.label,
        z,
        admin_dong: counts.dong,
        admin_sigungu: counts.sigungu,
        hasSource: counts.hasSource,
        hasDong: counts.hasDong,
        hasSigungu: counts.hasSigungu,
        samplesDong: counts.samplesDong,
        samplesSigungu: counts.samplesSigungu,
        shot,
      };
      rows.push(row);
      console.log(
        JSON.stringify({
          hub: hub.id,
          z,
          dong: counts.dong,
          sigungu: counts.sigungu,
          source: counts.hasSource,
          layers: [counts.hasDong, counts.hasSigungu],
          samplesDong: counts.samplesDong.slice(0, 5),
          samplesSigungu: counts.samplesSigungu.slice(0, 5),
        }),
      );
    }
  }

  const summary = {
    base: BASE,
    measured_at: new Date().toISOString(),
    rows,
  };
  fs.writeFileSync(
    path.join(OUT, "summary.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log("\nHUB\tz\tdong\tsigungu");
  for (const r of rows) {
    console.log(
      `${r.hub}\tz${r.z}\t${r.admin_dong}\t${r.admin_sigungu}`,
    );
  }

  await browser.close();
  console.log(`\nWrote ${OUT}/summary.json + screenshots`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
