/**
 * Compare Korea PMTiles vs OFM MVT layer feature counts at e2e failure hubs.
 * Usage: node --env-file=.env.local scripts/compare-self-vs-ofm-tiles.mjs
 */
import fs from "node:fs";
import { PMTiles } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import Protobuf from "pbf";

function loadEnvLocal() {
  try {
    const raw = fs.readFileSync(".env.local", "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
}
loadEnvLocal();

function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  const max = n - 1;
  return {
    x: Math.max(0, Math.min(max, x)),
    y: Math.max(0, Math.min(max, y)),
  };
}

const LAYERS = [
  "poi",
  "place",
  "transportation",
  "building",
  "landuse",
  "water",
];

const HUBS = [
  { id: "mangwon", lng: 126.9055, lat: 37.556, zooms: [14, 15] },
  { id: "hongdae", lng: 126.924, lat: 37.5572, zooms: [15, 16] },
  { id: "hongcheon", lng: 127.888, lat: 37.692, zooms: [12, 15] },
  { id: "gangneung", lng: 128.876, lat: 37.752, zooms: [12, 15] },
  { id: "sokcho", lng: 128.592, lat: 38.207, zooms: [12, 15] },
  { id: "pyeongchang", lng: 128.39, lat: 37.37, zooms: [12, 15] },
  { id: "jeju", lng: 126.531, lat: 33.499, zooms: [12, 15] },
];

function decodeCounts(buf) {
  if (!buf || buf.byteLength === 0) {
    return { bytes: 0, counts: Object.fromEntries(LAYERS.map((l) => [l, 0])), poiSample: [] };
  }
  const tile = new VectorTile(new Protobuf(new Uint8Array(buf)));
  const counts = {};
  for (const l of LAYERS) {
    counts[l] = tile.layers[l]?.length ?? 0;
  }
  const poiSample = [];
  const poi = tile.layers.poi;
  if (poi) {
    const n = Math.min(poi.length, 12);
    for (let i = 0; i < n; i++) {
      const f = poi.feature(i);
      const p = f.properties || {};
      poiSample.push({
        class: p.class ?? null,
        subclass: p.subclass ?? null,
        rank: p.rank ?? null,
        name: p.name ?? null,
        "name:ko": p["name:ko"] ?? null,
      });
    }
  }
  // also list all layer names present
  const allLayers = Object.fromEntries(
    Object.keys(tile.layers).map((k) => [k, tile.layers[k].length]),
  );
  return { bytes: buf.byteLength, counts, poiSample, allLayers };
}

async function resolveOfmTemplate() {
  const res = await fetch("https://tiles.openfreemap.org/planet", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ofm_tilejson_${res.status}`);
  const tj = await res.json();
  const t = tj.tiles?.[0];
  if (!t) throw new Error("ofm_missing_tiles");
  return t;
}

async function fetchOfm(template, z, x, y) {
  const url = template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return res.arrayBuffer();
}

async function main() {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
  const fileUrl = `${base}/storage/v1/object/public/map-tiles/korea-latest.pmtiles`;
  const p = new PMTiles(fileUrl);
  const header = await p.getHeader();
  console.log("=== PMTiles header ===");
  console.log(
    JSON.stringify(
      {
        minLon: header.minLon,
        minLat: header.minLat,
        maxLon: header.maxLon,
        maxLat: header.maxLat,
        minZoom: header.minZoom,
        maxZoom: header.maxZoom,
        centerZoom: header.centerZoom,
      },
      null,
      2,
    ),
  );
  console.log("App KOREA_PMTILES_MAXZOOM constant = 14 (hardcoded)");
  console.log(
    "Header vs app maxzoom match:",
    header.maxZoom === 14 ? "YES" : `NO (header=${header.maxZoom})`,
  );

  const ofmTpl = await resolveOfmTemplate();
  console.log("OFM template:", ofmTpl);

  const rows = [];
  for (const hub of HUBS) {
    for (const z of hub.zooms) {
      // For z>header.maxZoom, read parent tile at maxZoom (what overzoom would use)
      const fetchZ = Math.min(z, header.maxZoom);
      const { x, y } = lngLatToTile(hub.lng, hub.lat, fetchZ);
      const selfTile = await p.getZxy(fetchZ, x, y);
      let selfBuf = null;
      if (selfTile?.data) {
        const d = selfTile.data;
        if (d instanceof ArrayBuffer) selfBuf = d;
        else if (ArrayBuffer.isView(d)) {
          selfBuf = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
        } else {
          selfBuf = new Uint8Array(d).buffer;
        }
      }
      const ofmBuf = await fetchOfm(ofmTpl, fetchZ, x, y);
      const self = decodeCounts(selfBuf);
      const ofm = decodeCounts(ofmBuf);
      rows.push({
        hub: hub.id,
        viewZ: z,
        tileZ: fetchZ,
        x,
        y,
        selfBytes: self.bytes,
        ofmBytes: ofm.bytes,
        self: self.counts,
        ofm: ofm.counts,
        selfPoiSample: self.poiSample,
        ofmPoiSample: ofm.poiSample,
        selfAllLayers: self.allLayers,
        ofmAllLayers: ofm.allLayers,
      });
    }
  }

  console.log("\n=== Layer feature counts (self vs OFM) ===");
  console.log(
    [
      "hub",
      "viewZ",
      "tileZ/x/y",
      "bytes_s/o",
      ...LAYERS.map((l) => `${l}_s/o`),
    ].join("\t"),
  );
  for (const r of rows) {
    console.log(
      [
        r.hub,
        r.viewZ,
        `${r.tileZ}/${r.x}/${r.y}`,
        `${r.selfBytes}/${r.ofmBytes}`,
        ...LAYERS.map((l) => `${r.self[l]}/${r.ofm[l]}`),
      ].join("\t"),
    );
  }

  console.log("\n=== POI samples (self) — mangwon z14 / hongdae z15 ===");
  for (const r of rows) {
    if (
      (r.hub === "mangwon" && r.viewZ === 14) ||
      (r.hub === "hongdae" && r.viewZ === 15)
    ) {
      console.log(`\n-- ${r.hub} viewZ=${r.viewZ} tile=${r.tileZ}/${r.x}/${r.y} --`);
      console.log("SELF poi sample:", JSON.stringify(r.selfPoiSample, null, 2));
      console.log("OFM  poi sample:", JSON.stringify(r.ofmPoiSample, null, 2));
      console.log("SELF all layers:", r.selfAllLayers);
      console.log("OFM  all layers:", r.ofmAllLayers);
    }
  }

  // Summary deltas
  console.log("\n=== Summary: self poi/place vs OFM ===");
  for (const r of rows) {
    const poiGap = r.self.poi - r.ofm.poi;
    const placeGap = r.self.place - r.ofm.place;
    console.log(
      `${r.hub} z${r.viewZ}: self.poi=${r.self.poi} ofm.poi=${r.ofm.poi} (Δ${poiGap}) | self.place=${r.self.place} ofm.place=${r.ofm.place} (Δ${placeGap}) | selfBytes=${r.selfBytes}`,
    );
  }

  fs.mkdirSync("e2e/artifacts", { recursive: true });
  fs.writeFileSync(
    "e2e/artifacts/self-vs-ofm-tile-compare.json",
    JSON.stringify({ header, ofmTpl, rows }, null, 2),
  );
  console.log("\nWrote e2e/artifacts/self-vs-ofm-tile-compare.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
