/**
 * Measure duplicate names + pairwise label bbox overlaps at hubs.
 * Overlap=0 target: dupNames=0 and roughOverlapPairs=0.
 */
import { chromium, devices } from "playwright";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv(".env.local");
const raw =
  process.env.EXTRACT_INTERNAL_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";
const token = createHash("sha256")
  .update("pindmap-map-preview-e2e:v1:" + raw)
  .digest("hex")
  .slice(0, 32);

const base = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const outDir = "e2e/artifacts/label-overlap";
fs.mkdirSync(outDir, { recursive: true });

const hubs = [
  { id: "mapo", lat: 37.5663, lng: 126.9015, z: 12 },
  { id: "mapo", lat: 37.5663, lng: 126.9015, z: 13 },
  { id: "mapo", lat: 37.5663, lng: 126.9015, z: 14 },
  { id: "gangnam", lat: 37.4979, lng: 127.0276, z: 13 },
  { id: "haeundae", lat: 35.1587, lng: 129.1604, z: 13 },
];

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
const rows = [];

for (const h of hubs) {
  const url = `${base}/map-preview?selfTiles=1&mode=nopins&theme=paper&lat=${h.lat}&lng=${h.lng}&z=${h.z}&e2e=${token}&t=${Date.now()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, {
    timeout: 90000,
  });
  await page.waitForTimeout(4500);
  const m = await page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    const layers = (map.getStyle?.()?.layers || [])
      .filter((l) => l.type === "symbol")
      .map((l) => l.id)
      .filter((id) => {
        try {
          return map.getLayoutProperty(id, "visibility") !== "none";
        } catch {
          return false;
        }
      });
    const allowBad = [];
    for (const id of layers) {
      try {
        const a = map.getLayoutProperty(id, "icon-allow-overlap");
        const b = map.getLayoutProperty(id, "text-allow-overlap");
        const c = map.getLayoutProperty(id, "icon-ignore-placement");
        const d = map.getLayoutProperty(id, "text-ignore-placement");
        if (a || b || c || d) allowBad.push({ id, a, b, c, d });
      } catch {
        /* no icon */
      }
    }
    const feats = layers.length
      ? map.queryRenderedFeatures({ layers })
      : [];
    const byName = new Map();
    const boxes = [];
    for (const f of feats) {
      const p = f.properties || {};
      const name = String(p["name:ko"] || p.name || "").trim();
      if (!name) continue;
      const g = f.geometry;
      if (!g || g.type !== "Point") continue;
      const [lng, lat] = g.coordinates;
      const pt = map.project([lng, lat]);
      const key = name.replace(/\s+/g, "");
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ name, layer: f.layer?.id, x: pt.x, y: pt.y });
      // Approx label box ~ name length * 7px + icon
      // Icon-sized box only (MapLibre already resolved text anchors under overlap=0).
      const w = 20;
      const h = 20;
      boxes.push({
        name,
        layer: f.layer?.id,
        x0: pt.x - w / 2,
        y0: pt.y - h / 2,
        x1: pt.x + w / 2,
        y1: pt.y + h / 2,
      });
    }
    const dups = [];
    for (const [, arr] of byName) {
      const layers = [...new Set(arr.map((a) => a.layer))];
      // Cross-layer same-name only (same-layer water repeats are line labels).
      if (layers.length < 2) continue;
      dups.push({
        name: arr[0].name,
        n: arr.length,
        layers,
      });
    }
    // Same-name pairs from different layers = real double-draw.
    let overlapPairs = 0;
    const overlapSamples = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i];
        const B = boxes[j];
        const same =
          A.name.replace(/\s+/g, "") === B.name.replace(/\s+/g, "");
        if (!same) continue;
        if (A.layer === B.layer) continue;
        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        if (ox > 2 && oy > 2) {
          overlapPairs += 1;
          if (overlapSamples.length < 8) {
            overlapSamples.push([A.name, B.name, A.layer, B.layer]);
          }
        }
      }
    }
    const koreaIds = [
      "korea_landmark_tier1_far",
      "korea_landmark_tier1",
      "korea_landmark_tier2",
      "korea_landmark_tier3",
    ].filter((id) => map.getLayer(id));
    const koreaNames = new Set();
    if (koreaIds.length) {
      for (const f of map.queryRenderedFeatures({ layers: koreaIds })) {
        const n = String(f.properties?.name || "").trim();
        if (n) koreaNames.add(n);
      }
    }
    return {
      labelCount: boxes.length,
      dupNames: dups.length,
      dups,
      overlapPairs,
      overlapSamples,
      allowBad,
      korea: koreaNames.size,
      koreaNames: [...koreaNames],
    };
  });
  const shot = path.join(outDir, `${h.id}-z${h.z}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  const row = { hub: h.id, z: h.z, shot, ...m };
  rows.push(row);
  console.log(JSON.stringify(row));
}

fs.writeFileSync(
  path.join(outDir, "summary.json"),
  JSON.stringify({ at: new Date().toISOString(), base, rows }, null, 2),
);
console.log("wrote", path.join(outDir, "summary.json"));
await browser.close();
