/**
 * Download full MapLibre glyph PBF packs (OFM/Noto Sans) and upload to
 * Supabase Storage map-tiles/glyphs/{fontstack}/{range}.pbf.
 *
 * Ranges: 0-255 … 65280-65535 (256 per stack).
 * Stacks: Noto Sans Regular | Bold | Italic (all used in pindmap styles).
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-map-glyphs.mjs
 *   node --env-file=.env.local scripts/sync-map-glyphs.mjs --download-only
 *   node --env-file=.env.local scripts/sync-map-glyphs.mjs --upload-only
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const STACKS = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"];
const OFM_FONTS = "https://tiles.openfreemap.org/fonts";
const BUCKET = "map-tiles";
const PREFIX = "glyphs";
const CACHE_DIR = path.resolve(".glyph-cache/glyphs");
const CONCURRENCY = 12;

const args = new Set(process.argv.slice(2));
const downloadOnly = args.has("--download-only");
const uploadOnly = args.has("--upload-only");

function allRanges() {
  const out = [];
  for (let i = 0; i < 256; i++) {
    const begin = i * 256;
    out.push(`${begin}-${begin + 255}`);
  }
  return out;
}

function loadEnvLocal() {
  try {
    const raw = fs.readFileSync(".env.local", "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ignore */
  }
}
loadEnvLocal();

async function mapPool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

function stackDir(stack) {
  return path.join(CACHE_DIR, stack);
}

async function downloadAll() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const ranges = allRanges();
  const jobs = [];
  for (const stack of STACKS) {
    fs.mkdirSync(stackDir(stack), { recursive: true });
    for (const range of ranges) {
      jobs.push({ stack, range });
    }
  }
  let ok = 0;
  let fail = 0;
  let bytes = 0;
  const t0 = Date.now();
  await mapPool(jobs, CONCURRENCY, async ({ stack, range }) => {
    const dest = path.join(stackDir(stack), `${range}.pbf`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      ok++;
      bytes += fs.statSync(dest).size;
      return;
    }
    const url = `${OFM_FONTS}/${encodeURIComponent(stack)}/${range}.pbf`;
    const res = await fetch(url);
    if (!res.ok) {
      fail++;
      console.error("download_fail", stack, range, res.status);
      // Write empty placeholder so upload still covers the range (safety net).
      fs.writeFileSync(dest, Buffer.alloc(0));
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    ok++;
    bytes += buf.length;
  });
  console.log(
    JSON.stringify(
      {
        download: {
          ok,
          fail,
          files: jobs.length,
          totalBytes: bytes,
          totalMB: +(bytes / 1024 / 1024).toFixed(2),
          seconds: +((Date.now() - t0) / 1000).toFixed(1),
          cacheDir: CACHE_DIR,
        },
      },
      null,
      2,
    ),
  );
  return bytes;
}

async function uploadAll() {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !key) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(base, key, { auth: { persistSession: false } });
  const ranges = allRanges();
  const jobs = [];
  for (const stack of STACKS) {
    for (const range of ranges) {
      jobs.push({ stack, range });
    }
  }
  let ok = 0;
  let fail = 0;
  let bytes = 0;
  const t0 = Date.now();
  await mapPool(jobs, CONCURRENCY, async ({ stack, range }) => {
    const file = path.join(stackDir(stack), `${range}.pbf`);
    if (!fs.existsSync(file)) {
      fail++;
      return;
    }
    const body = fs.readFileSync(file);
    const objectPath = `${PREFIX}/${stack}/${range}.pbf`;
    const { error } = await sb.storage.from(BUCKET).upload(objectPath, body, {
      contentType: "application/x-protobuf",
      upsert: true,
      cacheControl: "public, max-age=31536000, immutable",
    });
    if (error) {
      fail++;
      console.error("upload_fail", objectPath, error.message);
      return;
    }
    ok++;
    bytes += body.length;
  });
  const publicBase = `${base}/storage/v1/object/public/${BUCKET}/${PREFIX}`;
  console.log(
    JSON.stringify(
      {
        upload: {
          ok,
          fail,
          files: jobs.length,
          totalBytes: bytes,
          totalMB: +(bytes / 1024 / 1024).toFixed(2),
          seconds: +((Date.now() - t0) / 1000).toFixed(1),
          publicExample: `${publicBase}/Noto%20Sans%20Regular/0-255.pbf`,
          sameOriginTemplate: "/map/glyphs/{fontstack}/{range}.pbf",
        },
      },
      null,
      2,
    ),
  );
}

function sizeReport() {
  const byStack = {};
  let total = 0;
  let files = 0;
  for (const stack of STACKS) {
    const dir = stackDir(stack);
    if (!fs.existsSync(dir)) continue;
    let s = 0;
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".pbf")) continue;
      s += fs.statSync(path.join(dir, f)).size;
      n++;
    }
    byStack[stack] = { files: n, bytes: s, MB: +(s / 1024 / 1024).toFixed(2) };
    total += s;
    files += n;
  }
  const publicBytes = (() => {
    const root = path.resolve("public/map/glyphs");
    if (!fs.existsSync(root)) return 0;
    let b = 0;
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".pbf")) b += fs.statSync(p).size;
      }
    };
    walk(root);
    return b;
  })();
  console.log(
    JSON.stringify(
      {
        sizeReport: {
          byStack,
          totalFiles: files,
          totalMB: +(total / 1024 / 1024).toFixed(2),
          publicPartialMB: +(publicBytes / 1024 / 1024).toFixed(2),
          recommendation:
            total > 15 * 1024 * 1024
              ? "Use Supabase map-tiles/glyphs + same-origin /map/glyphs route (too large for git/public deploy)."
              : "Can vendor under public/map/glyphs.",
        },
      },
      null,
      2,
    ),
  );
}

if (!uploadOnly) await downloadAll();
sizeReport();
if (!downloadOnly) await uploadAll();
