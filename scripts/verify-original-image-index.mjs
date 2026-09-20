#!/usr/bin/env node
/**
 * Verify originalImageIndex from projectPostForCategoryFilter semantics.
 * Usage: node --env-file=.env.local scripts/verify-original-image-index.mjs
 */
import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadEnv() {
  const p = resolve(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();

const require = createRequire(resolve(ROOT, "package.json"));
const { createClient } = require("@supabase/supabase-js");

function pickRep(images, tags, filter) {
  if (!tags?.length || images.length <= 0) return null;
  const f = filter && filter !== "all" ? filter.trim() : null;
  const candidates = tags
    .filter((t) => {
      const idx = t.photoIndex;
      if (!Number.isInteger(idx) || idx < 0 || idx >= images.length) return false;
      if (f && (t.category?.trim() ?? "") !== f) return false;
      return true;
    })
    .sort((a, b) => a.photoIndex - b.photoIndex);
  if (!candidates.length) return null;
  const withUrl = candidates.find((t) => String(images[t.photoIndex] ?? "").trim());
  const tag = withUrl ?? candidates[0];
  return { sourceIndex: tag.photoIndex, category: tag.category?.trim() ?? "" };
}

function originalImageIndexFor(images, tags, filter) {
  if (!filter || filter === "all") return 0;
  const rep = pickRep(images, tags, filter);
  return rep ? rep.sourceIndex : 0;
}

const CATS = ["맛집", "술집", "카페", "쇼핑", "숙소", "놀거리", "여행지"];

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const posts = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("feed_posts")
      .select("id, images, photo_place_tags, archived")
      .range(from, from + 499);
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) break;
    for (const p of rows) {
      if (p.archived) continue;
      posts.push({
        id: p.id,
        images: Array.isArray(p.images) ? p.images : [],
        tags: Array.isArray(p.photo_place_tags) ? p.photo_place_tags : [],
      });
    }
    from += rows.length;
    if (rows.length < 500) break;
  }

  let allNonZero = 0;
  for (const p of posts) {
    const idx = originalImageIndexFor(p.images, p.tags, "all");
    if (idx !== 0) allNonZero += 1;
  }
  console.log(`chip_all_non_zero=${allNonZero} (expect 0) total_posts=${posts.length}`);

  let oob = 0;
  const oobSamples = [];
  for (const p of posts) {
    for (const cat of CATS) {
      const rep = pickRep(p.images, p.tags, cat);
      if (!rep) continue;
      const idx = originalImageIndexFor(p.images, p.tags, cat);
      if (idx < 0 || idx >= p.images.length) {
        oob += 1;
        if (oobSamples.length < 5)
          oobSamples.push({ id: p.id.slice(0, 8), cat, idx, len: p.images.length });
      }
    }
  }
  console.log(`oob_originalImageIndex=${oob} (expect 0)`);
  for (const s of oobSamples) console.log("  oob", s);

  const samples = [];
  for (const cat of CATS) {
    for (const p of posts) {
      const rep = pickRep(p.images, p.tags, cat);
      if (!rep) continue;
      const idx = originalImageIndexFor(p.images, p.tags, cat);
      const tagsAt = p.tags.filter((t) => t.photoIndex === idx);
      const match = tagsAt.some((t) => (t.category?.trim() ?? "") === cat);
      samples.push({
        cat,
        id: p.id.slice(0, 8),
        idx,
        match,
        tagsAt: tagsAt.map((t) => t.category),
      });
      if (samples.length >= 20) break;
    }
    if (samples.length >= 20) break;
  }

  const mismatch = samples.filter((s) => !s.match);
  console.log(`chip_on_samples=${samples.length} mismatch=${mismatch.length} (expect 0)`);
  for (const s of samples) {
    console.log(
      `  cat=${s.cat} post=${s.id} originalImageIndex=${s.idx} tagsAt=${JSON.stringify(s.tagsAt)} match=${s.match}`,
    );
  }
  if (mismatch.length || allNonZero || oob) {
    console.log("FAIL");
    process.exit(1);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
