/**
 * Screenshots + building use=shop ratio at z16/z17 for hubs.
 *   PLAYWRIGHT_BASE_URL=… node scripts/measure-building-use-icons.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv(".env.local");

function e2eToken() {
  const raw =
    process.env.EXTRACT_INTERNAL_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  if (!raw) throw new Error("missing secret");
  return createHash("sha256")
    .update(`pindmap-map-preview-e2e:v1:${raw}`)
    .digest("hex")
    .slice(0, 32);
}

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT = path.join(process.cwd(), "e2e/artifacts/building-use-icons");
fs.mkdirSync(OUT, { recursive: true });

const HUBS = [
  { id: "mangwon", lat: 37.5565, lng: 126.9019 },
  { id: "hongdae", lat: 37.5572, lng: 126.924 },
  { id: "gangnam", lat: 37.4979, lng: 127.0276 },
  { id: "hongcheon", lat: 37.697, lng: 127.889 },
];

/** Mapo Hangang I-Park — use-value probe only (no coords in report). */
const MAPO_IPARK = { id: "mapo_ipark", lat: 37.5426, lng: 126.947 };

async function main() {
  const token = e2eToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  const rows = [];

  for (const hub of HUBS) {
    for (const z of [16, 17]) {
      const url = `${BASE}/map-preview?selfTiles=1&mode=nopins&theme=paper&lat=${hub.lat}&lng=${hub.lng}&z=${z}&e2e=${token}&t=${Date.now()}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
        timeout: 90000,
      });
      await page.waitForTimeout(6000);
      const stats = await page.evaluate(() => {
        const map = window.__PINDMAP_PREVIEW_MAP__;
        let total = 0;
        let shop = 0;
        let apt = 0;
        try {
          const feats = map.querySourceFeatures("korea_buildings", {
            sourceLayer: "building_kr",
          });
          for (const f of feats) {
            total += 1;
            const u = f.properties?.use;
            const sn = Number(f.properties?.shop_n || 0);
            // Style paints apricot only when use=shop AND shop_n≥2.
            if (u === "shop" && sn >= 2) shop += 1;
            else if (u === "apt") apt += 1;
          }
        } catch {
          /* missing source */
        }
        return {
          total,
          shop,
          apt,
          shopPct: total ? Math.round((1000 * shop) / total) / 10 : 0,
          aptPct: total ? Math.round((1000 * apt) / total) / 10 : 0,
          buildingsUrl: map.getSource("korea_buildings")?.tiles?.[0] || null,
        };
      });
      const shot = path.join(OUT, `${hub.id}-z${z}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      rows.push({ hub: hub.id, z, ...stats, shot: path.relative(process.cwd(), shot) });
      console.log(JSON.stringify(rows[rows.length - 1]));
    }
  }

  // Icon strip at z17 mangwon
  await page.goto(
    `${BASE}/map-preview?selfTiles=1&mode=nopins&theme=paper&lat=37.5565&lng=126.9019&z=17&e2e=${token}&t=${Date.now()}`,
    { waitUntil: "domcontentloaded", timeout: 120000 },
  );
  await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
    timeout: 90000,
  });
  await page.waitForTimeout(5000);
  const iconShot = path.join(OUT, "icons-z17-mangwon.png");
  await page.screenshot({ path: iconShot, fullPage: false });

  // Mapo I-Park: report use values only (no coordinates).
  const ipUrl = `${BASE}/map-preview?selfTiles=1&mode=nopins&theme=paper&lat=${MAPO_IPARK.lat}&lng=${MAPO_IPARK.lng}&z=17&e2e=${token}&t=${Date.now()}`;
  await page.goto(ipUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
    timeout: 90000,
  });
  await page.waitForTimeout(6000);
  const ipark = await page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    const counts = { shop: 0, apt: 0, other: 0, total: 0 };
    const useValues = [];
    try {
      const feats = map.querySourceFeatures("korea_buildings", {
        sourceLayer: "building_kr",
      });
      for (const f of feats) {
        counts.total += 1;
        const u = f.properties?.use;
        const sn = Number(f.properties?.shop_n || 0);
        // Painted apricot only when use=shop AND shop_n≥2
        if (u === "shop" && sn >= 2) counts.shop += 1;
        else if (u === "apt") counts.apt += 1;
        else counts.other += 1;
        if (u) useValues.push(String(u));
      }
    } catch {
      /* missing */
    }
    const uniq = [...new Set(useValues)].sort();
    return { counts, useValuesUniq: uniq };
  });
  const iparkShot = path.join(OUT, "mapo-ipark-z17.png");
  await page.screenshot({ path: iparkShot, fullPage: false });
  console.log(JSON.stringify({ hub: "mapo_ipark", z: 17, ...ipark }));

  const report = {
    at: new Date().toISOString(),
    base: BASE,
    rows,
    iconShot: path.relative(process.cwd(), iconShot),
    mapoIpark: { ...ipark, shot: path.relative(process.cwd(), iparkShot) },
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(report, null, 2));
  console.log("wrote", path.join(OUT, "summary.json"));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
