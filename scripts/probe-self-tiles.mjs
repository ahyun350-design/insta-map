/**
 * Public probes: latest.json, Range 206, latency vs OFM, name:ko in Seoul z14.
 * No keys printed.
 */
import fs from "node:fs";
import { PMTiles } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

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

const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
if (!base) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL");
  process.exit(1);
}
const latestUrl = `${base}/storage/v1/object/public/map-tiles/latest.json`;
const pmUrl = `${base}/storage/v1/object/public/map-tiles/korea-latest.pmtiles`;
async function avg(fn, n = 5) {
  const times = [];
  let last;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    last = await fn();
    times.push(performance.now() - t0);
  }
  return {
    avgMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    times: times.map((t) => Math.round(t)),
    last,
  };
}

const latestRes = await fetch(latestUrl);
const latest = await latestRes.json();
console.log(
  JSON.stringify(
    {
      latest_status: latestRes.status,
      file: latest.file || latest.filename || latest.name || latest.key,
      size: latest.size || latest.bytes || latest.contentLength,
      latest,
    },
    null,
    2,
  ),
);

const range = await avg(async () => {
  const r = await fetch(pmUrl, { headers: { Range: "bytes=0-0" } });
  const buf = await r.arrayBuffer();
  return {
    status: r.status,
    acceptRanges: r.headers.get("accept-ranges"),
    contentRange: r.headers.get("content-range"),
    bytes: buf.byteLength,
  };
});
console.log(
  JSON.stringify(
    {
      pmtiles_range: {
        status: range.last.status,
        acceptRanges: range.last.acceptRanges,
        contentRange: range.last.contentRange,
        firstByteAvgMs: range.avgMs,
        times: range.times,
        urlHost: new URL(pmUrl).host,
      },
    },
    null,
    2,
  ),
);

const tj = await fetch("https://tiles.openfreemap.org/planet").then((r) =>
  r.json(),
);
const ofmTile = String(tj.tiles[0])
  .replace("{z}", "14")
  .replace("{x}", "13970")
  .replace("{y}", "6344");
const ofm = await avg(async () => {
  const r = await fetch(ofmTile, { cache: "no-store" });
  const buf = await r.arrayBuffer();
  return { status: r.status, bytes: buf.byteLength };
});
console.log(
  JSON.stringify(
    {
      ofm_tile: {
        status: ofm.last.status,
        bytes: ofm.last.bytes,
        avgMs: ofm.avgMs,
        times: ofm.times,
        path: ofmTile.replace(/^https:\/\/tiles\.openfreemap\.org/, ""),
      },
    },
    null,
    2,
  ),
);

// Seoul approx: lon 126.978, lat 37.566 → z14 tile
function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { z, x, y };
}
const { z, x, y } = lonLatToTile(126.978, 37.566, 14);
const p = new PMTiles(pmUrl);
const tile = await p.getZxy(z, x, y);
let nameKoCount = 0;
let nameKoSamples = [];
let layers = [];
if (tile?.data) {
  const vt = new VectorTile(new Pbf(tile.data));
  layers = Object.keys(vt.layers);
  for (const name of layers) {
    const layer = vt.layers[name];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const props = f.properties || {};
      if (props["name:ko"]) {
        nameKoCount++;
        if (nameKoSamples.length < 8) nameKoSamples.push(String(props["name:ko"]));
      }
    }
  }
}
console.log(
  JSON.stringify(
    {
      name_ko: {
        tile: `${z}/${x}/${y}`,
        hasTile: !!tile?.data,
        tileBytes: tile?.data?.byteLength ?? 0,
        layers: layers.length,
        nameKoCount,
        samples: nameKoSamples,
      },
    },
    null,
    2,
  ),
);
