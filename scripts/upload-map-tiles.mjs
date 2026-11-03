/**
 * Upload a local PMTiles archive to Supabase Storage map-tiles (Storage REST, service role).
 * Refuses to overwrite unless UPLOAD_UPSERT=1. Keys are read from .env.local and never printed.
 *
 *   node scripts/upload-map-tiles.mjs build/tiles/korea-sangga-v2.pmtiles
 */
import fs from "node:fs";
import path from "node:path";

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
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

const BUCKET = "map-tiles";
const CC = "public, max-age=31536000, immutable";
const local = process.argv[2];
if (!local || !fs.existsSync(local)) throw new Error("usage: upload-map-tiles.mjs <local.pmtiles>");
const name = path.basename(local);
const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!base || !key) throw new Error("missing supabase url / service role");

const publicUrl = `${base}/storage/v1/object/public/${BUCKET}/${name}`;
const putUrl = `${base}/storage/v1/object/${BUCKET}/${name}`;
const upsert = process.env.UPLOAD_UPSERT === "1";

const head = await fetch(publicUrl, { headers: { Range: "bytes=0-15" } });
if (head.ok && !upsert) {
  console.log(JSON.stringify({ name, skipped: "exists (set UPLOAD_UPSERT=1 to replace)" }));
  process.exit(0);
}

const buf = fs.readFileSync(local);
const put = await fetch(putUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    apikey: key,
    "Content-Type": "application/vnd.pmtiles",
    "cache-control": CC,
    "x-upsert": upsert ? "true" : "false",
  },
  body: buf,
});
if (!put.ok) {
  const t = await put.text();
  throw new Error(`upload_${name}_${put.status}:${t.slice(0, 160)}`);
}
const probe = await fetch(publicUrl, {
  headers: { Range: "bytes=0-15", "Cache-Control": "no-cache" },
});
console.log(
  JSON.stringify({
    name,
    bytes: buf.length,
    probeStatus: probe.status,
    cacheControl: probe.headers.get("cache-control"),
  }),
);
