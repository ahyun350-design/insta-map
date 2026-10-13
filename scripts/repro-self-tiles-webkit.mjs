/**
 * Reproduce admin self-tiles on WebKit: Range/CORS, protocol, console errors.
 */
import { webkit, devices } from "playwright";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { PMTiles } from "pmtiles";

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

const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const pmUrl = `${base}/storage/v1/object/public/map-tiles/korea-latest.pmtiles`;
const tok = createHash("sha256")
  .update(
    `pindmap-map-preview-e2e:v1:${(
      process.env.EXTRACT_INTERNAL_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ""
    ).trim()}`,
  )
  .digest("hex")
  .slice(0, 32);

// Node Range probe (not WebKit, but CORS headers check)
const rangeRes = await fetch(pmUrl, {
  headers: {
    Range: "bytes=0-0",
    Origin: "http://localhost:3456",
  },
});
console.log(
  JSON.stringify({
    node_range: {
      status: rangeRes.status,
      acao: rangeRes.headers.get("access-control-allow-origin"),
      acah: rangeRes.headers.get("access-control-allow-headers"),
      acex: rangeRes.headers.get("access-control-expose-headers"),
      acam: rangeRes.headers.get("access-control-allow-methods"),
      cr: rangeRes.headers.get("content-range"),
    },
  }),
);

const pre = await fetch(pmUrl, {
  method: "OPTIONS",
  headers: {
    Origin: "http://localhost:3456",
    "Access-Control-Request-Method": "GET",
    "Access-Control-Request-Headers": "range",
  },
});
console.log(
  JSON.stringify({
    preflight: {
      status: pre.status,
      acao: pre.headers.get("access-control-allow-origin"),
      acah: pre.headers.get("access-control-allow-headers"),
      acam: pre.headers.get("access-control-allow-methods"),
    },
  }),
);

const browser = await webkit.launch();
const context = await browser.newContext({
  ...devices["iPhone 13"],
  locale: "ko-KR",
});
const page = await context.newPage();
const consoleErrs = [];
const failed = [];
const pmtilesReqs = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrs.push(msg.text().slice(0, 300));
});
page.on("requestfailed", (req) => {
  failed.push({
    url: req.url().slice(0, 140),
    err: req.failure()?.errorText || "?",
  });
});
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("korea-latest.pmtiles") || u.includes("openfreemap")) {
    pmtilesReqs.push({
      status: res.status(),
      url: u.replace(base, "{supabase}").slice(0, 120),
    });
  }
});

const url = `http://localhost:3456/map-preview?mode=nopins&theme=paper&selfTiles=1&lat=37.5565&lng=126.9019&z=15&e2e=${tok}&t=${Date.now()}`;
const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
const ready = await page
  .waitForFunction(() => window.__PINDMAP_PREVIEW_MAP__ != null, null, {
    timeout: 90000,
  })
  .then(() => true)
  .catch(() => false);

const diag = await page.evaluate(async () => {
  const map = window.__PINDMAP_PREVIEW_MAP__;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (map?.areTilesLoaded?.()) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const src = map?.getSource?.("openmaptiles");
  return {
    hasMap: !!map,
    tiles0: src?.tiles?.[0] || null,
    loaded: map?.loaded?.() ?? null,
    areTilesLoaded: map?.areTilesLoaded?.() ?? null,
    diag: window.__PINDMAP_PREVIEW_DIAG__ || null,
  };
});

// WebKit in-page Range fetch (CORS)
const wkRange = await page.evaluate(async (u) => {
  try {
    const r = await fetch(u, { headers: { Range: "bytes=0-0" } });
    return {
      ok: r.ok,
      status: r.status,
      cr: r.headers.get("content-range"),
      type: r.type,
    };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
}, pmUrl);

// Fetch a tile via the registered pindself protocol path (MapLibre source)
const wkTile = await page.evaluate(async () => {
  const map = window.__PINDMAP_PREVIEW_MAP__;
  const src = map?.getSource?.("openmaptiles");
  const t0 = performance.now();
  try {
    // Force a small pan to solicit tiles
    map.jumpTo({ zoom: 15, center: [126.9019, 37.5565] });
    await new Promise((r) => {
      map.once("idle", () => r());
      setTimeout(r, 8000);
    });
    return {
      ok: true,
      ms: Math.round(performance.now() - t0),
      tiles0: src?.tiles?.[0] || null,
      areTilesLoaded: map.areTilesLoaded(),
    };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
});

console.log(
  JSON.stringify(
    {
      readyMs: Date.now() - t0,
      ready,
      diag,
      wkRange,
      wkTile,
      consoleErrs: consoleErrs.slice(0, 20),
      failed: failed.slice(0, 20),
      pmtilesReqs: pmtilesReqs.slice(0, 30),
    },
    null,
    2,
  ),
);
await browser.close();
