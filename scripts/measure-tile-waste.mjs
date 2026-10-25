/**
 * Classify korea_base Range traffic: kind, zoom, purpose, dupes, MVT layers, cache headers.
 *
 *   PLAYWRIGHT_BASE_URL=… node scripts/measure-tile-waste.mjs
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PMTiles, tileIdToZxy, zxyToTileId, findTile } from "pmtiles";
import zlib from "node:zlib";

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
const OUT = path.join(process.cwd(), "e2e/artifacts/tile-waste");
fs.mkdirSync(OUT, { recursive: true });

const HUB = {
  id: process.env.MEASURE_HUB || "mangwon",
  lat: Number(process.env.MEASURE_LAT || 37.5565),
  lng: Number(process.env.MEASURE_LNG || 126.9019),
  z: Number(process.env.MEASURE_Z || 15),
};

function parseRange(h) {
  const m = String(h || "").match(/bytes=(\d+)-(\d+)/i);
  if (!m) return null;
  return {
    start: Number(m[1]),
    end: Number(m[2]),
    len: Number(m[2]) - Number(m[1]) + 1,
  };
}

function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

function mvtLayerSizes(buf) {
  const out = [];
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let i = 0;
  while (i < u8.length) {
    const key = u8[i++];
    const fn = key >> 3;
    const wt = key & 7;
    if (wt !== 2) break;
    let len = 0,
      s = 0;
    while (i < u8.length) {
      const b = u8[i++];
      len |= (b & 0x7f) << s;
      if (!(b & 0x80)) break;
      s += 7;
    }
    if (i + len > u8.length) break;
    const layer = u8.subarray(i, i + len);
    i += len;
    if (fn !== 3) continue;
    let name = "?";
    let j = 0;
    while (j < layer.length) {
      const k2 = layer[j++];
      const f2 = k2 >> 3;
      const w2 = k2 & 7;
      if (w2 === 2) {
        let l2 = 0,
          s2 = 0;
        while (j < layer.length) {
          const b = layer[j++];
          l2 |= (b & 0x7f) << s2;
          if (!(b & 0x80)) break;
          s2 += 7;
        }
        if (f2 === 1) name = Buffer.from(layer.subarray(j, j + l2)).toString("utf8");
        j += l2;
      } else if (w2 === 0) {
        while (j < layer.length && layer[j++] & 0x80) {}
      } else break;
    }
    out.push({ name, bytes: layer.length });
  }
  return out;
}

function decompressTile(data, tileCompression) {
  if (tileCompression === 1) return Buffer.from(data);
  try {
    return zlib.gunzipSync(data);
  } catch {
    return Buffer.from(data);
  }
}

/** Walk PMTiles directories for a grid; map tileData absolute offset → z/x/y. */
async function buildOffsetIndex(archiveUrl, hub) {
  const pm = new PMTiles(archiveUrl);
  const header = await pm.getHeader();
  const offsetMap = new Map(); // `${absOffset}:${length}` → {z,x,y}

  async function resolveEntry(z, x, y) {
    const tid = zxyToTileId(z, x, y);
    let dirOffset = header.rootDirectoryOffset;
    let dirLength = header.rootDirectoryLength;
    for (let depth = 0; depth <= 3; depth++) {
      const dir = await pm.cache.getDirectory(
        pm.source,
        dirOffset,
        dirLength,
        header,
      );
      const entry = findTile(dir, tid);
      if (!entry) return null;
      if (entry.runLength > 0) {
        return {
          z,
          x,
          y,
          absOffset: header.tileDataOffset + entry.offset,
          length: entry.length,
        };
      }
      dirOffset = header.leafDirectoryOffset + entry.offset;
      dirLength = entry.length;
    }
    return null;
  }

  const jobs = [];
  for (const z of [0, 12, 13, 14]) {
    const { x: cx, y: cy } = lngLatToTile(hub.lng, hub.lat, z);
    const rad = z === 0 ? 0 : z === 14 ? 4 : 3;
    for (let dx = -rad; dx <= rad; dx++) {
      for (let dy = -rad; dy <= rad; dy++) {
        jobs.push({ z, x: cx + dx, y: cy + dy });
      }
    }
  }
  // Prefetch pattern exact
  {
    const { x: cx, y: cy } = lngLatToTile(hub.lng, hub.lat, 14);
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -3; dy <= 3; dy++) jobs.push({ z: 14, x: cx + dx, y: cy + dy });
    const c13 = lngLatToTile(hub.lng, hub.lat, 13);
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) jobs.push({ z: 13, x: c13.x + dx, y: c13.y + dy });
  }

  const seen = new Set();
  for (const j of jobs) {
    const k = `${j.z}/${j.x}/${j.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const e = await resolveEntry(j.z, j.x, j.y);
    if (!e) continue;
    offsetMap.set(`${e.absOffset}:${e.length}`, { z: e.z, x: e.x, y: e.y, length: e.length });
  }
  return { pm, header, offsetMap };
}

function purposeFor(r, hub, prefetchZ14, prefetchZ13) {
  if (r.kind === "header") return "header";
  if (r.kind === "root_directory") return "root_directory";
  if (r.kind === "leaf_directory") return "leaf_directory";
  if (r.kind !== "tile_data") return "unknown";
  if (r.z == null) return "tile_unresolved";
  if (r.z === 0) return "root_tile_warm";
  if (r.z === 13) {
    const hit = prefetchZ13.has(`${r.x},${r.y}`);
    return hit ? "prefetch_z13" : "viewport_or_neighbor_z13";
  }
  if (r.z === 14) {
    const hit = prefetchZ14.has(`${r.x},${r.y}`);
    // Early phase more likely prefetch; still tag membership
    if (hit && r.phase !== "warm_load" && r.phase !== "warm_nav") return "boot_prefetch_z14";
    if (hit) return "viewport_z14_in_prefetch_set";
    return "viewport_z14_outside_prefetch";
  }
  if (r.z > 14) return "wrong_zoom_gt14";
  if (r.z < 13) return "low_zoom_overview";
  return "other_tile";
}

async function measureHub(hub) {
  const token = e2eToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  // Disable HTTP cache for cold; we'll do warm in same context after
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  const ranges = [];
  let phase = "boot";
  const t0 = Date.now();
  let archiveUrl = null;

  cdp.on("Network.requestWillBeSent", (p) => {
    const url = p.request?.url || "";
    if (!/korea-latest\.pmtiles/i.test(url)) return;
    archiveUrl = url.split("?")[0];
    const hdrs = p.request.headers || {};
    const rg = parseRange(hdrs.Range || hdrs.range);
    if (!rg) return;
    ranges.push({
      t: Date.now() - t0,
      phase,
      ...rg,
      key: `${rg.start}-${rg.end}`,
      requestId: p.requestId,
    });
  });

  cdp.on("Network.responseReceived", (p) => {
    const url = p.response?.url || "";
    if (!/korea-latest\.pmtiles/i.test(url)) return;
    const r = ranges.find((x) => x.requestId === p.requestId && x.status == null);
    if (!r) return;
    const h = p.response.headers || {};
    r.status = p.response.status;
    r.cacheControl = h["cache-control"] || h["Cache-Control"];
    r.etag = h.etag || h.ETag;
    r.cfCache = h["cf-cache-status"] || h["CF-Cache-Status"];
    r.fromDiskCache = !!p.response.fromDiskCache;
    r.fromPrefetchCache = !!p.response.fromPrefetchCache;
  });

  cdp.on("Network.loadingFinished", (p) => {
    const r = ranges.find((x) => x.requestId === p.requestId);
    if (r) r.encodedDataLength = p.encodedDataLength;
  });

  const coldUrl = `${BASE}/map-preview?selfTiles=1&e2e=${token}&lat=${hub.lat}&lng=${hub.lng}&z=${hub.z}&v=${Date.now()}`;
  console.log("→ cold", hub.id);
  phase = "nav";
  await page.goto(coldUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  phase = "load";
  await page.waitForTimeout(14000);
  phase = "idle";
  await page.waitForTimeout(2000);
  const coldCount = ranges.length;

  // Warm: enable cache, reload same URL
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  phase = "warm_nav";
  console.log("→ warm", hub.id);
  await page.goto(
    `${BASE}/map-preview?selfTiles=1&e2e=${token}&lat=${hub.lat}&lng=${hub.lng}&z=${hub.z}&warm=1`,
    { waitUntil: "domcontentloaded", timeout: 120000 },
  );
  phase = "warm_load";
  await page.waitForTimeout(12000);
  await browser.close();

  if (!archiveUrl) throw new Error("no korea-latest requests");

  const { pm, header, offsetMap } = await buildOffsetIndex(archiveUrl, hub);
  const leafStart = header.leafDirectoryOffset;
  const leafEnd = leafStart + header.leafDirectoryLength;
  const tileStart = header.tileDataOffset;
  const tileEnd = tileStart + header.tileDataLength;
  const rootEnd = header.rootDirectoryOffset + header.rootDirectoryLength;

  const { x: cx14, y: cy14 } = lngLatToTile(hub.lng, hub.lat, 14);
  const prefetchZ14 = new Set();
  for (let dx = -3; dx <= 3; dx++)
    for (let dy = -3; dy <= 3; dy++) prefetchZ14.add(`${cx14 + dx},${cy14 + dy}`);
  const c13 = lngLatToTile(hub.lng, hub.lat, 13);
  const prefetchZ13 = new Set();
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) prefetchZ13.add(`${c13.x + dx},${c13.y + dy}`);

  function kindOf(r) {
    const mid = r.start + Math.floor(r.len / 2);
    if (r.start === 0 && r.len <= 16384) return "header";
    if (mid >= header.rootDirectoryOffset && mid < rootEnd) return "root_directory";
    if (mid >= leafStart && mid < leafEnd) return "leaf_directory";
    if (mid >= tileStart && mid < tileEnd) return "tile_data";
    return "unknown";
  }

  function enrich(list) {
    const first = new Set();
    return list.map((r) => {
      const kind = kindOf(r);
      let zxy = offsetMap.get(`${r.start}:${r.len}`);
      if (!zxy && kind === "tile_data") {
        // try match by offset only
        for (const [k, v] of offsetMap) {
          if (k.startsWith(`${r.start}:`)) {
            zxy = v;
            break;
          }
        }
      }
      const row = {
        ...r,
        kind,
        z: zxy?.z,
        x: zxy?.x,
        y: zxy?.y,
        dupe: first.has(r.key),
        bytes: r.encodedDataLength || r.len,
      };
      first.add(r.key);
      row.purpose = purposeFor(row, hub, prefetchZ14, prefetchZ13);
      return row;
    });
  }

  const cold = enrich(ranges.slice(0, coldCount));
  const warm = enrich(ranges.slice(coldCount));

  function agg(rows) {
    const byPurpose = {};
    const byZoom = {};
    const byKind = {};
    let dupeReq = 0;
    for (const r of rows) {
      byPurpose[r.purpose] = byPurpose[r.purpose] || { req: 0, bytes: 0 };
      byPurpose[r.purpose].req += 1;
      byPurpose[r.purpose].bytes += r.bytes;
      byKind[r.kind] = byKind[r.kind] || { req: 0, bytes: 0 };
      byKind[r.kind].req += 1;
      byKind[r.kind].bytes += r.bytes;
      if (r.z != null) {
        byZoom[r.z] = byZoom[r.z] || { req: 0, bytes: 0 };
        byZoom[r.z].req += 1;
        byZoom[r.z].bytes += r.bytes;
      }
      if (r.dupe) dupeReq += 1;
    }
    const tiles = rows.filter((r) => r.kind === "tile_data");
    const avgTile =
      tiles.length > 0 ? Math.round(tiles.reduce((s, r) => s + r.bytes, 0) / tiles.length) : 0;
    const topTiles = [...tiles]
      .filter((r) => r.z != null)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10)
      .map((r) => ({
        zxy: `${r.z}/${r.x}/${r.y}`,
        bytes: r.bytes,
        purpose: r.purpose,
        phase: r.phase,
        dupe: r.dupe,
      }));
    return {
      totalReq: rows.length,
      totalBytes: rows.reduce((s, r) => s + r.bytes, 0),
      dupeReq,
      uniqueKeys: new Set(rows.map((r) => r.key)).size,
      byPurpose,
      byKind,
      byZoom,
      avgTileBytes: avgTile,
      topTiles,
      fromDiskCache: rows.filter((r) => r.fromDiskCache).length,
      cacheControl: rows.find((r) => r.cacheControl)?.cacheControl || null,
      etagSample: rows.find((r) => r.etag)?.etag || null,
      cfCache: [...new Set(rows.map((r) => r.cfCache).filter(Boolean))],
    };
  }

  // Layer share from top unique tiles by size
  const uniqueTileZxy = new Map();
  for (const r of cold.filter((x) => x.kind === "tile_data" && x.z != null)) {
    const k = `${r.z}/${r.x}/${r.y}`;
    if (!uniqueTileZxy.has(k) || uniqueTileZxy.get(k).bytes < r.bytes) {
      uniqueTileZxy.set(k, r);
    }
  }
  const topForLayers = [...uniqueTileZxy.values()]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
  const layerTotals = new Map();
  const layerDetail = [];
  for (const t of topForLayers) {
    const got = await pm.getZxy(t.z, t.x, t.y);
    if (!got?.data) continue;
    const raw = Buffer.from(got.data);
    // getZxy already decompresses — data is MVT
    const layers = mvtLayerSizes(raw).sort((a, b) => b.bytes - a.bytes);
    for (const L of layers) layerTotals.set(L.name, (layerTotals.get(L.name) || 0) + L.bytes);
    layerDetail.push({
      zxy: `${t.z}/${t.x}/${t.y}`,
      compressedApprox: t.bytes,
      uncompressed: raw.length,
      layers,
    });
  }
  const layerSum = [...layerTotals.entries()].sort((a, b) => b[1] - a[1]);
  const layerSumTotal = layerSum.reduce((s, [, b]) => s + b, 0) || 1;

  const report = {
    hub,
    base: BASE,
    at: new Date().toISOString(),
    archiveUrl,
    header: {
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
      tileCompression: header.tileCompression,
      leafDirectoryLength: header.leafDirectoryLength,
      tileDataLength: header.tileDataLength,
    },
    cold: agg(cold),
    warm: agg(warm),
    layerShareTop10Tiles: layerSum.map(([name, bytes]) => ({
      name,
      bytes,
      pct: Math.round((1000 * bytes) / layerSumTotal) / 10,
    })),
    layerDetail,
  };

  const outPath = path.join(OUT, `${hub.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        hub: hub.id,
        cold: {
          req: report.cold.totalReq,
          MB: +(report.cold.totalBytes / 1e6).toFixed(2),
          dupe: report.cold.dupeReq,
          byPurpose: report.cold.byPurpose,
          byZoom: report.cold.byZoom,
          avgTile: report.cold.avgTileBytes,
          top: report.cold.topTiles.slice(0, 5),
          cacheControl: report.cold.cacheControl,
        },
        warm: {
          req: report.warm.totalReq,
          MB: +(report.warm.totalBytes / 1e6).toFixed(2),
          diskCache: report.warm.fromDiskCache,
          cacheControl: report.warm.cacheControl,
        },
        layers: report.layerShareTop10Tiles.slice(0, 12),
      },
      null,
      2,
    ),
  );
  console.log("wrote", outPath);
  return report;
}

await measureHub(HUB);
