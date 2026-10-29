/**
 * polish-v3 A/B: road colour hierarchy, z14–15 anchors, label weight.
 *   PHASE=main   PLAYWRIGHT_BASE_URL=https://pindmap.com node scripts/capture-polish-v3-shots.mjs
 *   PHASE=branch PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 node scripts/capture-polish-v3-shots.mjs
 *   PHASE=compose node scripts/capture-polish-v3-shots.mjs
 */
import { chromium, devices } from "playwright";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
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

const ROOT = path.join("e2e", "artifacts", "polish-v3");
const SHOTS = [
  { id: "mangwon-z13", lat: 37.5565, lng: 126.9019, z: 13 },
  { id: "mangwon-z15", lat: 37.5565, lng: 126.9019, z: 15 },
  { id: "mangwon-z16", lat: 37.5565, lng: 126.9019, z: 16 },
  { id: "hongdae-z15", lat: 37.5572, lng: 126.924, z: 15 },
  { id: "hongdae-z16", lat: 37.5572, lng: 126.924, z: 16 },
  { id: "gangnam-z14", lat: 37.4979, lng: 127.0276, z: 14 },
];

async function capture(phase) {
  const base = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(
    /\/$/,
    "",
  );
  const out = path.join(ROOT, phase);
  fs.mkdirSync(out, { recursive: true });
  const token = e2eToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await context.newPage();
  const diag = [];
  for (const s of SHOTS) {
    const url = `${base}/map-preview?selfTiles=1&mode=nopins&theme=paper&lat=${s.lat}&lng=${s.lng}&z=${s.z}&e2e=${token}&t=${Date.now()}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
      timeout: 90000,
    });
    await page.waitForTimeout(6500);
    const d = await page.evaluate(() => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      const ids = (map.getStyle()?.layers ?? []).map((l) => l.id);
      const shopIds = ids.filter(
        (id) => id.startsWith("shop_poi_label") || id.startsWith("sangga_shop_label_"),
      );
      const shops = shopIds.length ? map.queryRenderedFeatures({ layers: shopIds }).length : 0;
      return {
        zoom: Number(map.getZoom().toFixed(2)),
        shops,
        tourZ14: ids.includes("tour_poi_label_z14"),
        sanggaZ15: ids.includes("sangga_shop_label_z15"),
        cap: window.__PINDMAP_SHOP_CAP__ ?? null,
      };
    });
    const dest = path.join(out, `${s.id}.png`);
    await page.screenshot({ path: dest, fullPage: false });
    diag.push({ shot: s.id, ...d });
    console.log(JSON.stringify({ phase, shot: dest, ...d }));
  }
  fs.writeFileSync(path.join(out, "diag.json"), JSON.stringify(diag, null, 2));
  await browser.close();
}

async function header(text, width) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="44">
  <rect width="100%" height="100%" fill="#111"/>
  <text x="14" y="29" font-family="Apple SD Gothic Neo, sans-serif" font-size="20" font-weight="700" fill="#fff">${text}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function compose() {
  const outDir = path.join(ROOT, "compare");
  fs.mkdirSync(outDir, { recursive: true });
  const paths = [];
  const gap = 8;
  for (const s of SHOTS) {
    const a = path.join(ROOT, "main", `${s.id}.png`);
    const b = path.join(ROOT, "branch", `${s.id}.png`);
    if (!fs.existsSync(a) || !fs.existsSync(b)) {
      console.log("skip (missing)", s.id);
      continue;
    }
    const am = await sharp(a).metadata();
    const bm = await sharp(b).metadata();
    const w = am.width || 0;
    const h = Math.max(am.height || 0, bm.height || 0);
    const ha = await header(`지금 (main) · ${s.id}`, w);
    const hb = await header(`새 (map-polish-v3) · ${s.id}`, bm.width || 0);
    const dest = path.join(outDir, `${s.id}.png`);
    await sharp({
      create: {
        width: w + gap + (bm.width || 0),
        height: h + 44,
        channels: 3,
        background: "#111111",
      },
    })
      .composite([
        { input: ha, top: 0, left: 0 },
        { input: hb, top: 0, left: w + gap },
        { input: a, top: 44, left: 0 },
        { input: b, top: 44, left: w + gap },
      ])
      .png()
      .toFile(dest);
    paths.push(dest);
    console.log("wrote", dest);
  }
  fs.writeFileSync(
    path.join(ROOT, "compare-index.json"),
    JSON.stringify({ paths }, null, 2),
  );
}

const PHASE = process.env.PHASE || "branch";
const run = PHASE === "compose" ? compose() : capture(PHASE === "main" ? "main" : "branch");
run.catch((e) => {
  console.error(e);
  process.exit(1);
});
