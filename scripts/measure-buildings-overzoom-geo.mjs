/**
 * Compare one building_kr polygon centroid at mangwon z16 / z17 / z18.
 * Reports haversine delta meters (native overzoom ≈ 0–few m; bad clamp ≈ large).
 *
 *   PLAYWRIGHT_BASE_URL=… MEASURE_TAG=before node scripts/measure-buildings-overzoom-geo.mjs
 */
import { webkit, devices } from "playwright";
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

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const TAG = process.env.MEASURE_TAG || "after";
const OUT = path.join(process.cwd(), "e2e/artifacts/buildings-overzoom-geo");
fs.mkdirSync(OUT, { recursive: true });

const HUB = { lat: 37.556, lng: 126.9055 };
const ZOOMS = [16, 17, 18, 19];

function haversineM(a, b) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const la1 = toR(a.lat);
  const la2 = toR(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function main() {
  const token = e2eToken();
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
  });
  const page = await context.newPage();

  // Intercept tile URL zooms requested via protocol pattern in console/network — via page evaluate hook
  await page.addInitScript(() => {
    window.__PIND_BUILDING_TILE_ZS__ = [];
  });

  await page.goto(
    `${BASE}/map-preview?mode=nopins&theme=paper&selfTiles=1&lat=${HUB.lat}&lng=${HUB.lng}&z=16&e2e=${token}&t=${Date.now()}`,
    { waitUntil: "domcontentloaded", timeout: 120000 },
  );
  await page.waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
    timeout: 90000,
  });
  await page.waitForTimeout(4000);

  // Hook transformRequest if available to record building tile z
  await page.evaluate(() => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    const zs = (window.__PIND_BUILDING_TILE_ZS__ = []);
    const prev = map._requestManager?.transformRequest?.bind(map._requestManager);
    if (map._requestManager && prev) {
      map._requestManager.transformRequest = (url, type) => {
        if (typeof url === "string" && url.startsWith("pindbuildings://")) {
          const m = /pindbuildings:\/\/(\d+)\//.exec(url);
          if (m) zs.push(Number(m[1]));
        }
        return prev(url, type);
      };
    }
  });

  const byZoom = {};
  let trackCenter = { lat: HUB.lat, lng: HUB.lng };
  for (const z of ZOOMS) {
    await page.evaluate(async ({ lat, lng, z }) => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      window.__PIND_BUILDING_TILE_ZS__ = [];
      map.jumpTo({ zoom: z, center: [lng, lat] });
      await new Promise((r) => {
        map.once("idle", r);
        setTimeout(r, 8000);
      });
      await new Promise((r) => setTimeout(r, 1200));
    }, { lat: trackCenter.lat, lng: trackCenter.lng, z });

    const snap = await page.evaluate((wantNo) => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      const src = map.getSource("korea_buildings");
      const feats = map.getLayer("building_kr_fill")
        ? map.queryRenderedFeatures({ layers: ["building_kr_fill"] })
        : [];

      function ringCentroid(ring) {
        let a = 0,
          cx = 0,
          cy = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i][0],
            yi = ring[i][1];
          const xj = ring[j][0],
            yj = ring[j][1];
          const f = xi * yj - xj * yi;
          a += f;
          cx += (xi + xj) * f;
          cy += (yi + yj) * f;
        }
        a *= 0.5;
        if (Math.abs(a) < 1e-18) {
          const n = ring.length || 1;
          return [
            ring.reduce((s, p) => s + p[0], 0) / n,
            ring.reduce((s, p) => s + p[1], 0) / n,
          ];
        }
        return [cx / (6 * a), cy / (6 * a)];
      }

      function featureCentroid(f) {
        const g = f.geometry;
        if (!g) return null;
        let ring = null;
        if (g.type === "Polygon") ring = g.coordinates[0];
        else if (g.type === "MultiPolygon") ring = g.coordinates[0]?.[0];
        if (!ring || ring.length < 3) return null;
        const [lng, lat] = ringCentroid(ring);
        return { lng, lat };
      }

      const anchor = { lng: 126.9055, lat: 37.556 };
      let pick = null;
      let pickD = Infinity;

      // Prefer same houseno across zooms; else nearest numbered building to anchor
      for (const f of feats) {
        const no = String(f.properties?.no || "");
        if (wantNo) {
          if (no !== wantNo) continue;
        } else if (!no) {
          continue;
        }
        const c = featureCentroid(f);
        if (!c) continue;
        const d = (c.lng - anchor.lng) ** 2 + (c.lat - anchor.lat) ** 2;
        if (d < pickD) {
          pickD = d;
          pick = { lng: c.lng, lat: c.lat, no };
        }
      }

      // Source-cache canonical tile zs currently held for korea_buildings
      const cache = map.style?.sourceCaches?.korea_buildings;
      const heldZs = [];
      if (cache?._tiles) {
        for (const t of Object.values(cache._tiles)) {
          const cz = t?.tileID?.canonical?.z;
          if (typeof cz === "number") heldZs.push(cz);
        }
      }

      return {
        zoom: map.getZoom(),
        kr_fill: feats.length,
        src_maxzoom: src?.maxzoom ?? null,
        src_minzoom: src?.minzoom ?? null,
        held_canonical_zs: [...new Set(heldZs)].sort((a, b) => a - b),
        pick,
        omt_visible: map.getLayer("building")
          ? map.getLayoutProperty("building", "visibility")
          : null,
      };
    }, byZoom[16]?.pick?.no || null);

    byZoom[z] = snap;
    if (z === 16 && snap.pick) {
      trackCenter = { lat: snap.pick.lat, lng: snap.pick.lng };
    }
    console.log(JSON.stringify({ z, ...snap }));
    await page.screenshot({
      path: path.join(OUT, `${TAG}-mangwon-z${z}.png`),
      fullPage: false,
    });
  }

  const ref = byZoom[16]?.pick;
  const deltas = {};
  if (ref?.no) {
    for (const z of [17, 18, 19]) {
      const cur = byZoom[z]?.pick;
      if (!cur || cur.no !== ref.no) {
        deltas[`z16_vs_z${z}_m`] = null;
        deltas[`z16_vs_z${z}_match`] = false;
        continue;
      }
      const m = haversineM(ref, cur);
      deltas[`z16_vs_z${z}_m`] = Math.round(m * 100) / 100;
      deltas[`z16_vs_z${z}_match`] = true;
      deltas[`z16_vs_z${z}_no`] = ref.no;
    }
  }

  const summary = {
    tag: TAG,
    base: BASE,
    at: new Date().toISOString(),
    engine: "webkit",
    byZoom,
    deltas,
  };
  fs.writeFileSync(
    path.join(OUT, `${TAG}-summary.json`),
    JSON.stringify(summary, null, 2),
  );
  console.error("deltas", JSON.stringify(deltas));
  console.error("wrote", path.join(OUT, `${TAG}-summary.json`));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
