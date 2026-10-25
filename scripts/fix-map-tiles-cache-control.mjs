/**
 * Re-upload map-tiles objects with Cache-Control: public, max-age=31536000, immutable.
 * Uses Storage REST (cache-control request header) — supabase-js seconds-only form was ignored.
 *
 *   node scripts/fix-map-tiles-cache-control.mjs
 *   FIX_ONLY=korea-tour.pmtiles node scripts/fix-map-tiles-cache-control.mjs
 */
import fs from "node:fs";

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

const BUCKET = "map-tiles";
const CC = "public, max-age=31536000, immutable";
const FILES = (
  process.env.FIX_ONLY
    ? [process.env.FIX_ONLY]
    : [
        "korea-tour.pmtiles",
        "korea-places-extra.pmtiles",
        "korea-sangga.pmtiles",
        "korea-latest.pmtiles",
      ]
).filter(Boolean);

const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!base || !key) throw new Error("missing supabase url / service role");

async function fixOne(name) {
  const publicUrl = `${base}/storage/v1/object/public/${BUCKET}/${name}`;
  const putUrl = `${base}/storage/v1/object/${BUCKET}/${name}`;
  console.log("fetch", name);
  const res = await fetch(publicUrl);
  if (!res.ok) throw new Error(`fetch_${name}_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ctype = name.endsWith(".pmtiles")
    ? "application/vnd.pmtiles"
    : "application/octet-stream";
  console.log("upload", name, "bytes", buf.length);
  const put = await fetch(putUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": ctype,
      "cache-control": CC,
      "x-upsert": "true",
    },
    body: buf,
  });
  if (!put.ok) {
    const t = await put.text();
    throw new Error(`upload_${name}_${put.status}:${t.slice(0, 200)}`);
  }
  // Bust CDN edge briefly
  const probe = await fetch(publicUrl, {
    headers: { Range: "bytes=0-15", "Cache-Control": "no-cache" },
  });
  const cc = probe.headers.get("cache-control");
  console.log("ok", name, "status", probe.status, "cache-control=", cc);
  return { name, bytes: buf.length, cacheControl: cc };
}

const out = [];
for (const f of FILES) {
  out.push(await fixOne(f));
}
console.log(JSON.stringify(out, null, 2));
