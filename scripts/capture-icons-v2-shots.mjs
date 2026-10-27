/**
 * Capture hub screenshots for icons-v2 A/B.
 *   PHASE=before|after PLAYWRIGHT_BASE_URL=… node scripts/capture-icons-v2-shots.mjs
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

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const PHASE = process.env.PHASE === "after" ? "after" : "before";
const OUT = path.join(process.cwd(), "e2e/artifacts/icons-v2", PHASE);
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { id: "mangwon-z13", lat: 37.5565, lng: 126.9019, z: 13 },
  { id: "mangwon-z15", lat: 37.5565, lng: 126.9019, z: 15 },
  { id: "mangwon-z16", lat: 37.5565, lng: 126.9019, z: 16 },
  { id: "mangwon-z17", lat: 37.5565, lng: 126.9019, z: 17 },
  { id: "hongdae-z15", lat: 37.5572, lng: 126.924, z: 15 },
  { id: "hongdae-z16", lat: 37.5572, lng: 126.924, z: 16 },
  { id: "gangnam-z16", lat: 37.4979, lng: 127.0276, z: 16 },
];

async function main() {
  const token = e2eToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  for (const s of SHOTS) {
    const url = `${BASE}/map-preview?selfTiles=1&mode=nopins&theme=paper&lat=${s.lat}&lng=${s.lng}&z=${s.z}&e2e=${token}&t=${Date.now()}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
      timeout: 90000,
    });
    await page.waitForTimeout(5500);
    const dest = path.join(OUT, `${s.id}.png`);
    await page.screenshot({ path: dest, fullPage: false });
    console.log(JSON.stringify({ phase: PHASE, shot: path.relative(process.cwd(), dest) }));
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
