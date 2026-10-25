/**
 * Measure mapo z13 korea-landmark: source-in-view vs rendered, layout props,
 * competing symbol counts. Relative artifact paths only.
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
const outDir = "e2e/artifacts/landmark-collision";
fs.mkdirSync(outDir, { recursive: true });

const hubs = [
  { id: "mapo", lat: 37.5663, lng: 126.9015, z: 13 },
  { id: "gangnam", lat: 37.4979, lng: 127.0276, z: 13 },
  { id: "hongdae", lat: 37.5563, lng: 126.9236, z: 15 },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
const rows = [];

for (const h of hubs) {
  const url = `${base}/map-preview?selfTiles=1&mode=nopins&theme=paper&lat=${h.lat}&lng=${h.lng}&z=${h.z}&e2e=${token}&t=${Date.now()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, {
    timeout: 90000,
  });
  await page.waitForTimeout(5000);
  const m = await page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    const koreaIds = [
      "korea_landmark_tier1_far",
      "korea_landmark_tier1",
      "korea_landmark_tier2",
      "korea_landmark_tier3",
    ];
    const layout = {};
    for (const id of koreaIds) {
      if (!map.getLayer(id)) continue;
      layout[id] = {
        iconAllow: map.getLayoutProperty(id, "icon-allow-overlap"),
        textAllow: map.getLayoutProperty(id, "text-allow-overlap"),
        iconIgnore: map.getLayoutProperty(id, "icon-ignore-placement"),
        textIgnore: map.getLayoutProperty(id, "text-ignore-placement"),
        textOptional: map.getLayoutProperty(id, "text-optional"),
        iconPad: map.getLayoutProperty(id, "icon-padding"),
        textPad: map.getLayoutProperty(id, "text-padding"),
        sort: map.getLayoutProperty(id, "symbol-sort-key"),
        iconSize: map.getLayoutProperty(id, "icon-size"),
      };
    }
    const uniq = (ids) => {
      const layers = ids.filter((id) => !!map.getLayer(id));
      if (!layers.length) return { count: 0, names: [] };
      const seen = new Set();
      for (const f of map.queryRenderedFeatures({ layers })) {
        const p = f.properties || {};
        const n = String(p["name:ko"] || p.name || "").trim();
        if (n) seen.add(n);
      }
      return { count: seen.size, names: [...seen] };
    };
    const rendered = uniq(koreaIds);
    let sourceInView = 0;
    const sourceNames = [];
    try {
      const feats = map.querySourceFeatures("korea_landmarks");
      const w = 390;
      const h = 844;
      const seen = new Set();
      for (const f of feats) {
        const g = f.geometry;
        if (!g || g.type !== "Point") continue;
        const [lng, lat] = g.coordinates;
        const pt = map.project([lng, lat]);
        if (pt.x < 0 || pt.y < 0 || pt.x > w || pt.y > h) continue;
        const n = String(f.properties?.name || "").trim();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        sourceInView += 1;
        sourceNames.push({
          name: n,
          tier: f.properties?.tier,
          kind: f.properties?.kind,
        });
      }
    } catch (e) {
      /* source may be geojson */
    }
    const styleIds = (map.getStyle?.()?.layers || []).map((l) => l.id);
    const shopLayers = styleIds.filter(
      (id) =>
        id.startsWith("shop_poi_label") || id.startsWith("sangga_shop_label_"),
    );
    const stationLayers = styleIds.filter(
      (id) => id === "poi_transit" || id === "poi_transit_mid",
    );
    const dongLayers = styleIds.filter(
      (id) =>
        id.includes("dong") ||
        id === "admin_dong_label" ||
        id.startsWith("label_dong"),
    );
    const countLayers = (layers) => {
      const L = layers.filter((id) => !!map.getLayer(id));
      if (!L.length) return 0;
      try {
        return map.queryRenderedFeatures({ layers: L }).length;
      } catch {
        return 0;
      }
    };
    let poiIconPx = null;
    try {
      const img = map.listImages?.() || [];
      // badge size is CSS via addImage; report shop icon-size layout
      if (shopLayers[0])
        poiIconPx = {
          iconSize: map.getLayoutProperty(shopLayers[0], "icon-size"),
          iconPad: map.getLayoutProperty(shopLayers[0], "icon-padding"),
          textPad: map.getLayoutProperty(shopLayers[0], "text-padding"),
        };
    } catch {}
    return {
      zoom: map.getZoom(),
      rendered: rendered.count,
      renderedNames: rendered.names,
      sourceInView,
      sourceNames,
      hidden: sourceNames
        .filter((s) => !rendered.names.includes(s.name))
        .map((s) => s.name),
      competing: {
        shop: countLayers(shopLayers),
        station: countLayers(stationLayers),
        dong: countLayers(dongLayers),
      },
      layout,
      poiIconPx,
    };
  });
  const shot = path.join(outDir, `${h.id}-z${h.z}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  const row = { hub: h.id, z: h.z, shot, ...m };
  rows.push(row);
  console.log(JSON.stringify(row));
}

const summary = path.join(outDir, "summary.json");
fs.writeFileSync(summary, JSON.stringify({ at: new Date().toISOString(), base, rows }, null, 2));
console.log("wrote", summary);
await browser.close();
