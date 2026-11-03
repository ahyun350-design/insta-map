/**
 * D-1 cross-source shop dedupe: before (?dedupe=0) vs after on one local server.
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 node scripts/capture-d1-shots.mjs
 * Writes e2e/artifacts/d1/{dedupe-before,dedupe-after}/*.png, dedupe-*.png (side by side),
 * dedupe-counts.json (rendered same-shop pairs across OMT · 상가 · Tour, names not stored).
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv(".env.local");

function e2eToken() {
  const raw = process.env.EXTRACT_INTERNAL_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!raw) throw new Error("missing secret");
  return createHash("sha256").update(`pindmap-map-preview-e2e:v1:${raw}`).digest("hex").slice(0, 32);
}

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const ROOT = path.join("e2e", "artifacts", "d1");
const HUBS = [
  { id: "mangwon", lat: 37.5565, lng: 126.9019 },
  { id: "hongdae", lat: 37.5572, lng: 126.924 },
  { id: "gangnam", lat: 37.4979, lng: 127.0276 },
];
const SHOTS = new Set(["mangwon-z17", "hongdae-z16"]);

/** In-page: rendered cross-source twins (same shop shown by 2 sources ≤50m). */
function countTwins() {
  const map = window.__PINDMAP_PREVIEW_MAP__;
  const ids = (map.getStyle()?.layers ?? []).map((l) => l.id);
  const groupOf = (id) =>
    id.startsWith("shop_poi_label_") ? "omt" : id.startsWith("sangga_shop_label_") ? "sangga" : id.startsWith("tour_poi_label_") ? "tour" : null;
  const layers = ids.filter((id) => groupOf(id));
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s()[\]{}·.,'"-]/g, "");
  const sim = (a, b) => a === b || (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)));
  const R = 6371000, toR = (d) => (d * Math.PI) / 180;
  const dist = (a, b) => {
    const dLat = toR(b[1] - a[1]), dLng = toR(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const pts = [];
  for (const f of map.queryRenderedFeatures({ layers })) {
    if (f.geometry?.type !== "Point") continue;
    const n = norm(f.properties?.["name:ko"] || f.properties?.name);
    if (n.length < 2) continue;
    pts.push({ g: groupOf(f.layer.id), n, c: f.geometry.coordinates });
  }
  let twins = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[i].g === pts[j].g) continue;
      if (!sim(pts[i].n, pts[j].n)) continue;
      if (dist(pts[i].c, pts[j].c) <= 50) twins++;
    }
  }
  const hiddenLayer = ids.includes("sangga_shop_label_z17_hidden");
  const hiddenRendered = hiddenLayer ? map.queryRenderedFeatures({ layers: ["sangga_shop_label_z17_hidden"] }).length : 0;
  return { labels: pts.length, twins, hiddenLayer, hiddenRendered, stats: window.__PINDMAP_SANGGA_DEDUPE__ ?? null };
}

async function main() {
  const token = e2eToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices["iPhone 13"], locale: "ko-KR" });
  const page = await context.newPage();
  const counts = {};
  for (const phase of ["before", "after"]) {
    fs.mkdirSync(path.join(ROOT, `dedupe-${phase}`), { recursive: true });
    for (const hub of HUBS) {
      for (const z of [16, 17]) {
        const id = `${hub.id}-z${z}`;
        const q = phase === "before" ? "&dedupe=0" : "";
        await page.goto(
          `${BASE}/map-preview?selfTiles=1&mode=nopins&theme=paper&lat=${hub.lat}&lng=${hub.lng}&z=${z}${q}&e2e=${token}&t=${Date.now()}`,
          { waitUntil: "domcontentloaded", timeout: 120000 },
        );
        await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, { timeout: 90000 });
        await page.waitForTimeout(7000);
        const m = await page.evaluate(countTwins);
        counts[`${phase}:${id}`] = m;
        console.log(JSON.stringify({ phase, id, labels: m.labels, twins: m.twins, hiddenLayer: m.hiddenLayer, hiddenRendered: m.hiddenRendered }));
        if (SHOTS.has(id)) {
          await page.screenshot({ path: path.join(ROOT, `dedupe-${phase}`, `${id}.png`) });
        }
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, "dedupe-counts.json"), JSON.stringify(counts, null, 2));

  for (const id of SHOTS) {
    const a = path.join(ROOT, "dedupe-before", `${id}.png`);
    const b = path.join(ROOT, "dedupe-after", `${id}.png`);
    const am = await sharp(a).metadata();
    const bm = await sharp(b).metadata();
    const head = async (t, w) =>
      sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="44"><rect width="100%" height="100%" fill="#111"/><text x="14" y="29" font-family="Apple SD Gothic Neo, sans-serif" font-size="20" font-weight="700" fill="#fff">${t}</text></svg>`)).png().toBuffer();
    const before = counts[`before:${id}`]?.twins ?? "?";
    const after = counts[`after:${id}`]?.twins ?? "?";
    const out = path.join(ROOT, `dedupe-${id}.png`);
    await sharp({ create: { width: am.width + 8 + bm.width, height: Math.max(am.height, bm.height) + 44, channels: 3, background: "#111111" } })
      .composite([
        { input: await head(`전 · ${id} · 중복 ${before}쌍`, am.width), top: 0, left: 0 },
        { input: await head(`후 · ${id} · 중복 ${after}쌍`, bm.width), top: 0, left: am.width + 8 },
        { input: a, top: 44, left: 0 },
        { input: b, top: 44, left: am.width + 8 },
      ])
      .png()
      .toFile(out);
    console.log("wrote", out);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
