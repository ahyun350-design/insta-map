/**
 * Extra Stage-1 breakdown: class/subclass/rank + geometry + viewport size.
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "../e2e/artifacts");
fs.mkdirSync(outDir, { recursive: true });

const CENTER = [126.9055, 37.5560];
const URL = "https://pindmap.com/map-preview?mode=nopins&theme=paper";

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["iPhone 13"],
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(
  () => window.__PINDMAP_PREVIEW_DIAG__?.loadMs != null,
  null,
  { timeout: 25_000 },
);

const report = await page.evaluate(async ({ center }) => {
  const map = window.__PINDMAP_PREVIEW_MAP__;
  const out = {};

  for (const zoom of [16, 17, 18]) {
    map.jumpTo({ zoom, center });
    await new Promise((r) => {
      map.once("idle", r);
      setTimeout(r, 4500);
    });
    const bounds = map.getBounds();
    const inView = (lng, lat) =>
      lng >= bounds.getWest() &&
      lng <= bounds.getEast() &&
      lat >= bounds.getSouth() &&
      lat <= bounds.getNorth();

    // rough meters for viewport
    const lat = center[1];
    const mPerDegLat = 111_320;
    const mPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);
    const widthM =
      (bounds.getEast() - bounds.getWest()) * mPerDegLng;
    const heightM =
      (bounds.getNorth() - bounds.getSouth()) * mPerDegLat;

    const srcFeats = map.querySourceFeatures("openmaptiles", {
      sourceLayer: "poi",
    });

    const byClass = {};
    const byClassSub = {};
    const ranks = [];
    let namedInView = 0;
    let anyGeomInView = 0;
    let pointNamed = 0;
    let nonPointNamed = 0;
    const shopish = [];
    const SHOP_CLASSES = new Set([
      "cafe",
      "restaurant",
      "shop",
      "grocery",
      "bank",
      "pharmacy",
      "bar",
      "fast_food",
      "bakery",
      "alcohol_shop",
      "ice_cream",
      "biergarten",
      "food_court",
      "marketplace",
      "laundry",
      "hairdresser",
      "beauty",
      "books",
      "clothes",
      "florist",
      "furniture",
      "gift",
      "jewelry",
      "shoes",
      "sports",
      "stationery",
      "toys",
      "optician",
      "chemist",
      "convenience",
      "supermarket",
      "mall",
      "department_store",
      "doityourself",
      "hardware",
      "electronics",
      "mobile_phone",
      "bicycle",
      "car",
      "travel_agent",
      "ticket",
      "laundry",
      "dry_cleaning",
      "tattoo",
      "massage",
      "copyshop",
      "art",
      "music",
      "video",
      "pet",
      "wine",
      "beverages",
      "butcher",
      "cheese",
      "chocolate",
      "coffee",
      "confectionery",
      "dairy",
      "deli",
      "greengrocer",
      "seafood",
      "tea",
      "pastry",
      "outdoor",
      "variety_store",
      "kiosk",
      "newsagent",
      "tobacco",
      "perfumery",
      "cosmetics",
      "hearing_aids",
      "medical_supply",
      "dentist",
      "doctors",
      "clinic",
      "veterinary",
    ]);

    const seen = new Set();
    for (const f of srcFeats) {
      const p = f.properties || {};
      const name = String(p["name:ko"] || p.name || "").trim();
      const g = f.geometry;
      if (!g) continue;

      let lng;
      let lat2;
      if (g.type === "Point") {
        lng = g.coordinates[0];
        lat2 = g.coordinates[1];
      } else if (g.type === "MultiPoint" && g.coordinates?.[0]) {
        lng = g.coordinates[0][0];
        lat2 = g.coordinates[0][1];
      } else {
        // try first coord of polygon/line
        const c = g.coordinates;
        const dig = (x) =>
          typeof x[0] === "number" ? x : dig(x[0]);
        try {
          const pt = dig(c);
          lng = pt[0];
          lat2 = pt[1];
        } catch {
          continue;
        }
      }
      if (!inView(lng, lat2)) continue;
      anyGeomInView += 1;
      if (!name) continue;

      const key = `${name}|${p.class}|${p.subclass}|${lng.toFixed(5)}|${lat2.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      namedInView += 1;
      if (g.type === "Point") pointNamed += 1;
      else nonPointNamed += 1;

      const cls = String(p.class || "");
      const sub = String(p.subclass || "");
      byClass[cls] = (byClass[cls] || 0) + 1;
      const cs = `${cls}/${sub}`;
      byClassSub[cs] = (byClassSub[cs] || 0) + 1;
      const rank = Number(p.rank);
      if (Number.isFinite(rank)) ranks.push(rank);

      // OMT: many shops are class=shop subclass=*, or class=cafe etc.
      const isShopish =
        SHOP_CLASSES.has(cls) ||
        SHOP_CLASSES.has(sub) ||
        cls === "shop" ||
        cls === "grocery" ||
        cls === "cafe" ||
        cls === "restaurant" ||
        cls === "bar" ||
        cls === "fast_food" ||
        cls === "bakery" ||
        cls === "bank" ||
        cls === "pharmacy" ||
        cls === "alcohol" ||
        cls === "ice_cream";
      if (isShopish) {
        shopish.push({
          class: cls,
          subclass: sub,
          rank: p.rank,
          name: name.slice(0, 40),
        });
      }
    }

    ranks.sort((a, b) => a - b);
    const rankHist = { "1-10": 0, "11-18": 0, "19-32": 0, "33-50": 0, "51+": 0, missing: 0 };
    for (const f of srcFeats) {
      const p = f.properties || {};
      const name = String(p["name:ko"] || p.name || "").trim();
      if (!name) continue;
      const g = f.geometry;
      if (!g || g.type !== "Point") continue;
      const [lng, lat2] = g.coordinates;
      if (!inView(lng, lat2)) continue;
      const rank = p.rank == null ? null : Number(p.rank);
      if (rank == null || !Number.isFinite(rank)) rankHist.missing += 1;
      else if (rank <= 10) rankHist["1-10"] += 1;
      else if (rank <= 18) rankHist["11-18"] += 1;
      else if (rank <= 32) rankHist["19-32"] += 1;
      else if (rank <= 50) rankHist["33-50"] += 1;
      else rankHist["51+"] += 1;
    }

    // How many would pass a broad shop filter (class in shop-like OR subclass shop-like), any rank
    const broadPass = shopish.length;

    // Top class/subclass
    const topClass = Object.entries(byClass)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);
    const topCS = Object.entries(byClassSub)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40);

    out[zoom] = {
      viewportM: { width: Math.round(widthM), height: Math.round(heightM) },
      srcFeatureCount: srcFeats.length,
      anyGeomInView,
      namedInView,
      pointNamed,
      nonPointNamed,
      shopishCount: broadPass,
      shopishSample: shopish.slice(0, 30),
      topClass,
      topCS,
      rankHist,
      rankP50: ranks[Math.floor(ranks.length / 2)] ?? null,
      rankP90: ranks[Math.floor(ranks.length * 0.9)] ?? null,
    };
  }
  return out;
}, { center: CENTER });

fs.writeFileSync(
  path.join(outDir, "shop-poi-breakdown.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
