/**
 * Count TourAPI labels at regional hubs z12/z13/z15.
 * Usage: PLAYWRIGHT_BASE_URL=https://pindmap.com node scripts/measure-tour-pois.mjs
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
  if (!raw) throw new Error("missing e2e secret");
  return createHash("sha256")
    .update(`pindmap-map-preview-e2e:v1:${raw}`)
    .digest("hex")
    .slice(0, 32);
}

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "https://pindmap.com").replace(
  /\/$/,
  "",
);
const OUT = path.join(process.cwd(), "e2e/artifacts/tour-pois");
const ZOOMS = [12, 13, 15];
const HUBS = [
  { id: "chuncheon", label: "춘천명동·소양강", lat: 37.8813, lng: 127.73 },
  { id: "hongcheon", label: "홍천읍내", lat: 37.697, lng: 127.889 },
  { id: "haeundae", label: "해운대", lat: 35.1586, lng: 129.1603 },
  { id: "gwangan", label: "광안리", lat: 35.1532, lng: 129.1185 },
  { id: "gamcheon", label: "감천문화마을", lat: 35.0975, lng: 129.0103 },
  { id: "gyeongpo", label: "강릉경포", lat: 37.805, lng: 128.908 },
  { id: "jeonju", label: "전주한옥마을", lat: 35.815, lng: 127.153 },
  { id: "hongdae", label: "홍대", lat: 37.5563, lng: 126.9234 },
  { id: "gangnam", label: "강남", lat: 37.4979, lng: 127.0276 },
];

fs.mkdirSync(OUT, { recursive: true });

async function waitIdle(page) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        const map = window.__PINDMAP_PREVIEW_MAP__;
        if (!map) return r();
        map.once("idle", () => r());
        setTimeout(r, 14000);
      }),
  );
  await page.waitForTimeout(900);
}

async function countTour(page) {
  return page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    if (!map) return { tour: 0, hasTour: false };
    const style = map.getStyle();
    const tourIds = style.layers
      .map((l) => l.id)
      .filter((id) => id.startsWith("tour_poi_label_") && map.getLayer(id));
    const tour = tourIds.length
      ? map.queryRenderedFeatures({ layers: tourIds }).length
      : 0;
    return {
      tour,
      hasTour: Boolean(style.sources?.korea_tour),
      samples: tourIds.length
        ? [
            ...new Set(
              map
                .queryRenderedFeatures({ layers: tourIds })
                .map((f) => String(f.properties?.name || "").trim())
                .filter(Boolean),
            ),
          ].slice(0, 8)
        : [],
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
      console.error(`→ ${hub.id} z${z}`);
      await page.goto(`${BASE}/map-preview?${q}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await page.waitForFunction(
        () => window.__PINDMAP_PREVIEW_MAP__ != null,
        null,
        { timeout: 90000 },
      );
      await waitIdle(page);
      await page.waitForTimeout(1500);
      await waitIdle(page);
      const c = await countTour(page);
      const shot = `${hub.id}-z${z}.png`;
      await page
        .locator(".map-preview-gl-canvas, .map-preview-gl-root")
        .first()
        .screenshot({ path: path.join(OUT, shot) });
      const row = { hub: hub.id, label: hub.label, z, ...c, shot };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  fs.writeFileSync(
    path.join(OUT, "summary.json"),
    JSON.stringify(
      { base: BASE, measured_at: new Date().toISOString(), rows },
      null,
      2,
    ),
  );
  console.log("\nHUB\tz\ttour\thasTour");
  for (const r of rows) {
    console.log(`${r.hub}\tz${r.z}\t${r.tour}\t${r.hasTour}`);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
