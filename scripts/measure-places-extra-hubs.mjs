/**
 * Measure apt_complex / named_building / total symbol labels at hubs
 * on production self-tiles, and write screenshots.
 *
 * Usage:
 *   PLAYWRIGHT_BASE_URL=https://pindmap.com node scripts/measure-places-extra-hubs.mjs
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
const OUT = path.join(process.cwd(), "e2e/artifacts/places-extra");
const ZOOMS = [14, 15, 16];
const HUBS = [
  { id: "mangwon", label: "망원", lat: 37.556, lng: 126.9055 },
  { id: "hongdae", label: "홍대", lat: 37.5572, lng: 126.924 },
  { id: "gangnam", label: "강남", lat: 37.4979, lng: 127.0276 },
  { id: "haeundae", label: "해운대", lat: 35.1587, lng: 129.1604 },
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
        apt: 0,
        building: 0,
        total: 0,
        hasAptLayer: false,
        hasBldLayer: false,
        hasSource: false,
        samplesApt: [],
        samplesBld: [],
      };
    }
    const style = map.getStyle();
    const hasSource = Boolean(style.sources?.korea_places_extra);
    const aptLayerIds = [
      "apt_complex_label",
      "apt_complex_label_small",
    ].filter((id) => !!map.getLayer(id));
    const hasAptLayer = aptLayerIds.length > 0;
    const hasBldLayer = Boolean(map.getLayer("named_building_label"));
    const placeLayers = style.layers
      .filter((l) => l.type === "symbol")
      .map((l) => l.id)
      .filter(
        (id) =>
          /label|poi|shop|landmark|park|place|station|transit|dong|gu|mountain|korea_|apt_complex|named_building/i.test(
            id,
          ) && !/pin|myloc|search|route|water/i.test(id),
      )
      .filter((id) => !!map.getLayer(id));

    const nameOf = (f) =>
      String(f.properties?.["name:ko"] || f.properties?.name || "").trim();

    const aptFeats = aptLayerIds.length
      ? map.queryRenderedFeatures({ layers: aptLayerIds })
      : [];
    const bldFeats = hasBldLayer
      ? map.queryRenderedFeatures({ layers: ["named_building_label"] })
      : [];
    const allFeats = placeLayers.length
      ? map.queryRenderedFeatures({ layers: placeLayers })
      : [];

    const aptNames = aptFeats.map(nameOf).filter(Boolean);
    const bldNames = bldFeats.map(nameOf).filter(Boolean);
    const allNames = allFeats.map(nameOf).filter(Boolean);
    const counts = {};
    for (const n of allNames) counts[n] = (counts[n] || 0) + 1;
    const dupes = Object.entries(counts).filter(([, c]) => c > 1).length;
    let overlapTrue = 0;
    for (const id of placeLayers) {
      try {
        if (map.getLayoutProperty(id, "text-allow-overlap") === true)
          overlapTrue++;
      } catch {
        /* skip */
      }
    }

    return {
      apt: aptNames.length,
      building: bldNames.length,
      total: allNames.length,
      dupes,
      overlapTrue,
      hasAptLayer,
      hasBldLayer,
      hasSource,
      samplesApt: [...new Set(aptNames)].slice(0, 8),
      samplesBld: [...new Set(bldNames)].slice(0, 8),
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
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(
        () => window.__PINDMAP_PREVIEW_MAP__ != null,
        null,
        { timeout: 90000 },
      );
      await waitIdle(page, 15000);
      // Extra settle for places-extra PMTiles fetch
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
        apt_complex: counts.apt,
        named_building: counts.building,
        total_labels: counts.total,
        dupes: counts.dupes,
        overlapTrue: counts.overlapTrue,
        hasSource: counts.hasSource,
        hasAptLayer: counts.hasAptLayer,
        hasBldLayer: counts.hasBldLayer,
        samplesApt: counts.samplesApt,
        samplesBld: counts.samplesBld,
        shot,
      };
      rows.push(row);
      console.log(
        JSON.stringify({
          hub: hub.id,
          z,
          apt: counts.apt,
          bld: counts.building,
          total: counts.total,
          dupes: counts.dupes,
          overlapTrue: counts.overlapTrue,
          source: counts.hasSource,
          layers: [counts.hasAptLayer, counts.hasBldLayer],
          samplesApt: counts.samplesApt.slice(0, 4),
          samplesBld: counts.samplesBld.slice(0, 4),
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

  // Markdown-ish table for report
  console.log("\nHUB\tz\tapt\tbld\ttotal");
  for (const r of rows) {
    console.log(
      `${r.hub}\tz${r.z}\t${r.apt_complex}\t${r.named_building}\t${r.total_labels}`,
    );
  }

  await browser.close();
  console.log(`\nWrote ${OUT}/summary.json + screenshots`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
