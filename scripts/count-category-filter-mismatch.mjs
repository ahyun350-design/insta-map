#!/usr/bin/env node
/**
 * 카테고리 필터 불일치 규모: categories에 값이 있으나
 * photo_place_tags에 해당 category 태그가 없어 카드가 제외되는 건수.
 * 캡션·이미지 URL은 출력하지 않음.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CATS = ["맛집", "술집", "카페", "쇼핑", "숙소", "놀거리", "여행지"];

function displayCategories(row) {
  if (Array.isArray(row.categories) && row.categories.length > 0) return row.categories;
  if (row.category) return [row.category];
  return [];
}

function matchingPhotoCount(row, filter) {
  const images = Array.isArray(row.images) ? row.images : [];
  const tags = Array.isArray(row.photo_place_tags) ? row.photo_place_tags : [];
  const seen = new Set();
  for (const tag of tags) {
    if ((tag?.category ?? "").trim() !== filter) continue;
    const idx = tag.photoIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= images.length) continue;
    seen.add(idx);
  }
  return seen.size;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  let from = 0;
  const page = 500;
  let total = 0;
  let archivedSkip = 0;
  /** categories includes cat but 0 matching tagged photos */
  const mismatchByCat = Object.fromEntries(CATS.map((c) => [c, 0]));
  let mismatchPosts = 0; // unique posts that mismatch for at least one listed category
  let wouldExcludeIfCafe = 0;

  for (;;) {
    const { data, error } = await admin
      .from("feed_posts")
      .select("id, category, categories, photo_place_tags, images, archived")
      .range(from, from + page - 1);
    if (error) throw error;
    const rows = data || [];
    if (rows.length === 0) break;
    for (const row of rows) {
      total += 1;
      if (row.archived) {
        archivedSkip += 1;
        continue;
      }
      const cats = displayCategories(row);
      let postMismatch = false;
      for (const cat of CATS) {
        if (!cats.includes(cat)) continue;
        if (matchingPhotoCount(row, cat) === 0) {
          mismatchByCat[cat] += 1;
          postMismatch = true;
          if (cat === "카페") wouldExcludeIfCafe += 1;
        }
      }
      if (postMismatch) mismatchPosts += 1;
    }
    from += rows.length;
    if (rows.length < page) break;
  }

  console.log(`feed_posts_total=${total} archived=${archivedSkip} active=${total - archivedSkip}`);
  console.log(`mismatch_posts_any_category=${mismatchPosts}`);
  console.log(`mismatch_if_filter_카페=${wouldExcludeIfCafe}`);
  console.log("mismatch_by_category:", JSON.stringify(mismatchByCat));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
