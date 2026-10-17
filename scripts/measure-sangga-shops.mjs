/**
 * Count shop labels (OMT + sangga) at hubs z15/z16.
 * Usage: PLAYWRIGHT_BASE_URL=https://pindmap.com node scripts/measure-sangga-shops.mjs
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
const OUT = path.join(process.cwd(), "e2e/artifacts/sangga-shops");
const ZOOMS = [15, 16];
const HUBS = [
  { id: "mangwon", label: "망원", lat: 37.556, lng: 126.9055 },
  { id: "hongdae", label: "홍대", lat: 37.5572, lng: 126.924 },
  { id: "gangnam", label: "강남", lat: 37.4979, lng: 127.0276 },
  // 해운대해수욕장 앞 상업지
  { id: "haeundae", label: "해운대", lat: 35.1586, lng: 129.1603 },
  { id: "jeonju", label: "전주한옥마을", lat: 35.815, lng: 127.153 },
  // 강릉 교동/중앙시장 (구 좌표 37.752/128.876는 번화가 밖 — CSV 300m≈2)
  { id: "gangneung", label: "강릉", lat: 37.7555, lng: 128.8965 },
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
  await page.waitForTimeout(800);
}

async function countShops(page) {
  return page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    if (!map) return { omt: 0, sangga: 0, total: 0, hasSangga: false, overlapTrue: 0 };
    const style = map.getStyle();
    const omtIds = style.layers
      .map((l) => l.id)
      .filter((id) => id.startsWith("shop_poi_label_") && map.getLayer(id));
    const sanggaIds = style.layers
      .map((l) => l.id)
      .filter((id) => id.startsWith("sangga_shop_label_") && map.getLayer(id));
    const omt = omtIds.length
      ? map.queryRenderedFeatures({ layers: omtIds }).length
      : 0;
    const sangga = sanggaIds.length
      ? map.queryRenderedFeatures({ layers: sanggaIds }).length
      : 0;
    const placeLayers = style.layers
      .filter((l) => l.type === "symbol")
      .map((l) => l.id)
      .filter(
        (id) =>
          /label|poi|shop|landmark|sangga|apt_complex|named_building/i.test(id) &&
          !/pin|myloc|search|route|water/i.test(id),
      )
      .filter((id) => map.getLayer(id));
    const all = placeLayers.length
      ? map.queryRenderedFeatures({ layers: placeLayers }).length
      : 0;
    let overlapTrue = 0;
    for (const id of placeLayers) {
      try {
        if (map.getLayoutProperty(id, "text-allow-overlap") === true) overlapTrue++;
      } catch {
        /* */
      }
    }
    const dedupe =
      window.__PINDMAP_SANGGA_DEDUPE__ || null;
    return {
      omt,
      sangga,
      shops: omt + sangga,
      totalLabels: all,
      hasSangga: Boolean(style.sources?.korea_sangga),
      overlapTrue,
      dedupe,
      samplesSangga: sanggaIds.length
        ? [
            ...new Set(
              map
                .queryRenderedFeatures({ layers: sanggaIds })
                .map((f) => String(f.properties?.name || "").trim())
                .filter(Boolean),
            ),
          ].slice(0, 8)
        : [],
      samplesOmt: omtIds.length
        ? [
            ...new Set(
              map
                .queryRenderedFeatures({ layers: omtIds })
                .map((f) =>
                  String(f.properties?.["name:ko"] || f.properties?.name || "").trim(),
                )
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
      await page.waitForTimeout(1200);
      await waitIdle(page);
      const c = await countShops(page);
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
  const summary = {
    base: BASE,
    measured_at: new Date().toISOString(),
    rows,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("\nHUB\tz\tomt\tsangga\tshops\ttotal\toverlap");
  for (const r of rows) {
    console.log(
      `${r.hub}\tz${r.z}\t${r.omt}\t${r.sangga}\t${r.shops}\t${r.totalLabels}\t${r.overlapTrue}`,
    );
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
