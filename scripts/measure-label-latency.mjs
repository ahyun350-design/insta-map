/**
 * Measure shop label first-paint after jump to Mangwon z17 + font/tile/sprite network.
 * Usage: LABEL_URL=https://pindmap.com/... node scripts/measure-label-latency.mjs
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const URL =
  process.env.LABEL_URL ||
  "https://pindmap.com/map-preview?mode=nopins&theme=paper";
const CENTER = [126.9055, 37.556];
const outDir = path.resolve("e2e/artifacts");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["iPhone 13"],
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();

/** @type {{url:string, kind:string, start:number, end?:number, status?:number, size?:number}[]} */
const tracked = [];
const wall0 = Date.now();

page.on("request", (req) => {
  const u = req.url();
  let kind = null;
  if (/\/fonts\//i.test(u) && /\.pbf/i.test(u)) kind = "font";
  else if (/sprite/i.test(u) && /\.(png|json)/i.test(u)) kind = "sprite";
  else if (/tiles\.openfreemap|\/planet\//i.test(u) && /\.pbf/i.test(u))
    kind = "tile";
  if (!kind) return;
  tracked.push({ url: u.slice(0, 160), kind, start: Date.now() - wall0 });
});

page.on("requestfinished", async (req) => {
  const u = req.url();
  const entry = [...tracked]
    .reverse()
    .find((t) => u.startsWith(t.url.slice(0, 80)) && t.end == null);
  if (!entry) return;
  entry.end = Date.now() - wall0;
  try {
    const res = await req.response();
    entry.status = res?.status();
    entry.size = (await res?.body())?.byteLength ?? null;
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForFunction(
  () => window.__PINDMAP_PREVIEW_DIAG__?.loadMs != null,
  null,
  { timeout: 45_000 },
);
// Park far away so Mangwon tiles/fonts are cold for the jump window
await page.evaluate(async () => {
  const map = window.__PINDMAP_PREVIEW_MAP__;
  map.jumpTo({ zoom: 6, center: [127.8, 36.2] });
  await new Promise((r) => {
    map.once("idle", r);
    setTimeout(r, 3000);
  });
});

const mark = Date.now() - wall0;
const result = await page.evaluate(async ({ center }) => {
  const map = window.__PINDMAP_PREVIEW_MAP__;
  const t0 = performance.now();
  map.jumpTo({ zoom: 17, center });
  let firstLabelMs = null;
  let shopCountAtFirst = 0;
  const deadline = t0 + 15000;
  while (performance.now() < deadline) {
    const layers = map
      .getStyle()
      .layers.filter((l) => String(l.id).startsWith("shop_poi_label"))
      .map((l) => l.id);
    const feats = layers.length
      ? map.queryRenderedFeatures({ layers })
      : [];
    if (feats.length > 0) {
      firstLabelMs = Math.round(performance.now() - t0);
      shopCountAtFirst = feats.length;
      break;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  await new Promise((r) => {
    map.once("idle", r);
    setTimeout(r, 2000);
  });
  const layers = map
    .getStyle()
    .layers.filter((l) => String(l.id).startsWith("shop_poi_label"))
    .map((l) => l.id);
  const finalCount = layers.length
    ? map.queryRenderedFeatures({ layers }).length
    : 0;
  return {
    firstLabelMs,
    shopCountAtFirst,
    finalCount,
    localIdeograph: String(map._localIdeographFontFamily ?? "(unavailable)"),
    elapsedToIdleMs: Math.round(performance.now() - t0),
  };
}, { center: CENTER });

const after = tracked.filter((t) => t.start >= mark);
const byKind = (kind) => {
  const rows = after.filter((t) => t.kind === kind);
  const durs = rows.map((t) =>
    t.end != null ? Math.max(0, t.end - t.start) : 0,
  );
  const hangul = rows.filter((t) => {
    const m = t.url.match(/\/(\d+)-(\d+)\.pbf/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    // Hangul syllables U+AC00–U+D7A3 ≈ 44032–55203
    return a >= 44032 && b <= 55296;
  });
  return {
    count: rows.length,
    totalDurationMs: durs.reduce((s, d) => s + d, 0),
    maxDurationMs: durs.length ? Math.max(...durs) : 0,
    hangulRangeCount: hangul.length,
    sample: rows.slice(0, 10).map((t) => ({
      url: t.url,
      durationMs: t.end != null ? t.end - t.start : null,
      size: t.size,
      status: t.status,
    })),
  };
};

const report = {
  url: URL,
  ...result,
  fonts: byKind("font"),
  tiles: byKind("tile"),
  sprites: byKind("sprite"),
};
fs.writeFileSync(
  path.join(outDir, "label-latency.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
