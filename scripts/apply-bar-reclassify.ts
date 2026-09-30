/**
 * Apply (C): 맛집 → 술집 when Kakao L2 is 술집, with meal-name keep for 호프,요리주점.
 * Also fills subcategory; updates feed_posts tags + categories.
 *
 *   npx tsx scripts/apply-bar-reclassify.ts
 *
 * ★ Never persists Kakao responses
 * ★ Stops on first batch failure
 * ★ Backup → scripts/localdata/out/bar_reclass_backup_YYYYMMDD.json
 */
import fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BATCH = 40;
const QPS = 8;
const MEAL_RE =
  /치킨|곱창|막창|고기|갈비|삼겹|빈대떡|분식|국밥|족발|보쌈/;

type PlaceRow = {
  id: string;
  name: string;
  category: string;
  lat: number | null;
  lng: number | null;
  source: string | null;
  poi_id: string | null;
  subcategory: string | null;
  edited: boolean;
};

type Flip = {
  id: string;
  name: string;
  poi_id: string | null;
  source: string | null;
  old_category: string;
  old_subcategory: string | null;
  new_category: "술집";
  new_subcategory: string | null;
  l3: string;
};

function loadEnv(): Record<string, string> {
  const raw = fs.readFileSync(resolve(ROOT, ".env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[m[1]!] = v;
  }
  return env;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeRateLimiter(qps: number) {
  const minGap = Math.ceil(1000 / qps);
  let lastAt = 0;
  return async function throttle() {
    const now = Date.now();
    const wait = lastAt + minGap - now;
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
  };
}

function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseL3(path: string): string {
  const parts = path
    .split(/\s*>\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[2] ?? "";
}

function subFromL3(l3: string): string | null {
  if (l3 === "호프,요리주점") return "호프";
  if (l3 === "일본식주점") return "이자카야";
  if (l3 === "와인바") return "와인바";
  if (l3 === "칵테일바") return "칵테일바";
  if (l3 === "실내포장마차" || l3 === "오뎅바") return "포차";
  return null;
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function loadPlaces(): PlaceRow[] {
  const dbUrl = fs
    .readFileSync(resolve(ROOT, "scripts/localdata/.db_url"), "utf8")
    .trim();
  const py = resolve(ROOT, "scripts/localdata/.venv/bin/python");
  const code = `
import json, psycopg2
conn = psycopg2.connect(${JSON.stringify(dbUrl)})
cur = conn.cursor()
cur.execute("""
  SELECT id::text, name, category, lat, lng, source, poi_id::text, subcategory,
         COALESCE(category_edited_by_user,false)
  FROM public.places
  WHERE category = '맛집'
  ORDER BY id
""")
out=[]
for r in cur.fetchall():
  out.append({
    "id": r[0], "name": r[1] or "", "category": r[2],
    "lat": float(r[3]) if r[3] is not None else None,
    "lng": float(r[4]) if r[4] is not None else None,
    "source": r[5], "poi_id": r[6], "subcategory": r[7], "edited": bool(r[8]),
  })
print(json.dumps(out, ensure_ascii=False))
conn.close()
`;
  const r = spawnSync(py, ["-c", code], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    cwd: ROOT,
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "places load fail");
  return JSON.parse(r.stdout.trim()) as PlaceRow[];
}

async function fetchKakaoPath(
  kakaoKey: string,
  place: PlaceRow,
  throttle: () => Promise<void>,
): Promise<string | null> {
  await throttle();
  const u = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  u.searchParams.set("query", place.name || ".");
  u.searchParams.set("size", "7");
  if (place.lat != null && place.lng != null) {
    u.searchParams.set("x", String(place.lng));
    u.searchParams.set("y", String(place.lat));
    u.searchParams.set("radius", "20000");
  }
  const res = await fetch(u, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });
  const text = await res.text();
  if (res.status === 429 || /limit has been exceeded/i.test(text)) {
    throw new Error(`Kakao quota: ${text.slice(0, 200)}`);
  }
  if (!res.ok) return null;
  let data: {
    documents?: Array<{
      id?: string;
      category_name?: string;
      place_name?: string;
      x?: string;
      y?: string;
    }>;
  };
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const docs = data.documents || [];
  if (!docs.length) return null;

  if (place.source === "kakao" && place.poi_id) {
    const byId = docs.find((d) => String(d.id) === String(place.poi_id));
    if (byId) return String(byId.category_name ?? "");
  }
  if (place.lat != null && place.lng != null) {
    let best: (typeof docs)[0] | null = null;
    let bestD = Infinity;
    for (const d of docs) {
      const lat = Number(d.y);
      const lng = Number(d.x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const dist = haversineM(place.lat, place.lng, lat, lng);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    if (best && bestD <= 100) return String(best.category_name ?? "");
  }
  const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const want = compact(place.name);
  const byName = docs.find((d) => compact(String(d.place_name ?? "")) === want);
  if (byName) return String(byName.category_name ?? "");
  return null;
}

function chipCountsFromPosts(
  posts: Array<{ categories: string[] | null }>,
): Record<string, number> {
  const c: Record<string, number> = { 맛집: 0, 술집: 0 };
  for (const p of posts) {
    for (const cat of p.categories || []) {
      if (cat === "맛집" || cat === "술집") c[cat] = (c[cat] || 0) + 1;
    }
  }
  return c;
}

async function main() {
  const env = loadEnv();
  const kakaoKey = env.KAKAO_REST_API_KEY!;
  const url = env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!kakaoKey || !url || !key) throw new Error("env missing");

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const throttle = makeRateLimiter(QPS);

  console.log("loading places…");
  const all = loadPlaces();
  const candidates = all.filter((p) => !p.edited && !p.subcategory);
  console.log(
    JSON.stringify({
      matjib: all.length,
      edited_skipped_upfront: all.filter((p) => p.edited).length,
      candidates: candidates.length,
    }),
  );

  const flips: Flip[] = [];
  const mealKeep: Array<{ name: string; l3: string }> = [];
  let apiCalls = 0;
  let kakaoFail = 0;
  let notBar = 0;

  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i]!;
    if (!p.name.trim()) {
      kakaoFail++;
      continue;
    }
    let path: string | null;
    try {
      apiCalls++;
      path = await fetchKakaoPath(kakaoKey, p, throttle);
    } catch (e) {
      console.error("[ABORT kakao]", e);
      process.exit(1);
    }
    if (!path) {
      kakaoFail++;
      continue;
    }
    if (!path.includes("> 술집 >")) {
      notBar++;
      continue;
    }
    const l3 = parseL3(path);
    if (l3 === "호프,요리주점" && MEAL_RE.test(p.name)) {
      mealKeep.push({ name: p.name, l3 });
      continue;
    }
    flips.push({
      id: p.id,
      name: p.name,
      poi_id: p.poi_id,
      source: p.source,
      old_category: p.category,
      old_subcategory: p.subcategory,
      new_category: "술집",
      new_subcategory: subFromL3(l3),
      l3,
    });
    if ((i + 1) % 400 === 0) {
      console.log(
        `scan ${i + 1}/${candidates.length} flip=${flips.length} mealKeep=${mealKeep.length}`,
      );
    }
  }

  const uniqueKeys = new Set(
    flips.map((f) =>
      f.poi_id
        ? `poi:${f.poi_id}`
        : `id:${f.id}`,
    ),
  );

  // Backup places only: id + previous category/subcategory (no name, no user_id)
  const outDir = resolve(ROOT, "scripts/localdata/out");
  fs.mkdirSync(outDir, { recursive: true });
  const backupPath = resolve(outDir, `bar_reclass_backup_${todayStamp()}.json`);

  // Load feed for backup + update (all rows — realign categories to tags)
  console.log("loading feed_posts…");
  let feedFrom = 0;
  type FeedRow = {
    id: string;
    archived: boolean | null;
    categories: string[] | null;
    photo_place_tags: unknown;
  };
  const feedRows: FeedRow[] = [];
  while (true) {
    const { data, error } = await sb
      .from("feed_posts")
      .select("id, archived, categories, photo_place_tags")
      .range(feedFrom, feedFrom + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) {
      feedRows.push({
        id: String(r.id),
        archived: (r.archived as boolean | null) ?? null,
        categories: (r.categories as string[] | null) ?? null,
        photo_place_tags: r.photo_place_tags,
      });
    }
    if (data.length < 1000) break;
    feedFrom += 1000;
  }

  const chipsBefore = chipCountsFromPosts(
    feedRows.filter((r) => r.archived !== true),
  );
  const flipPoiIds = new Set(
    flips
      .filter((f) => f.source === "kakao" && f.poi_id)
      .map((f) => String(f.poi_id)),
  );

  type FeedBackup = {
    id: string;
    categories: string[] | null;
    photo_place_tags: unknown;
  };
  const feedBackups: FeedBackup[] = [];
  const feedUpdates: Array<{
    id: string;
    categories: string[];
    photo_place_tags: unknown[];
  }> = [];

  for (const post of feedRows) {
    const tags = Array.isArray(post.photo_place_tags)
      ? (post.photo_place_tags as Array<Record<string, unknown>>)
      : [];
    let tagsChanged = false;
    const nextTags = tags.map((t) => {
      const placeId =
        t.placeId != null ? String(t.placeId) : t.place_id != null
          ? String(t.place_id)
          : null;
      if (placeId && flipPoiIds.has(placeId) && t.category === "맛집") {
        tagsChanged = true;
        return { ...t, category: "술집" };
      }
      return { ...t };
    });

    // Recompute categories from tags (also fixes 술집-in-tags / missing-in-categories)
    const fromTags = new Set<string>();
    for (const t of nextTags) {
      const c = typeof t.category === "string" ? t.category.trim() : "";
      if (c) fromTags.add(c);
    }
    const oldCats = new Set(post.categories || []);
    const catsChanged =
      [...fromTags].sort().join("|") !== [...oldCats].sort().join("|");

    // Always realign categories to tag union when tags exist; also when categories stale
    if (tagsChanged || (fromTags.size > 0 && catsChanged)) {
      feedBackups.push({
        id: post.id,
        categories: post.categories,
        photo_place_tags: post.photo_place_tags,
      });
      feedUpdates.push({
        id: post.id,
        categories: [...fromTags],
        photo_place_tags: nextTags,
      });
    }
  }

  const backup = {
    created_at: new Date().toISOString(),
    note: "places: id + previous category/subcategory only. feed_posts for rollback.",
    places: flips.map((f) => ({
      id: f.id,
      category: f.old_category,
      subcategory: f.old_subcategory,
    })),
    feed_posts: feedBackups.map((f) => ({
      id: f.id,
      categories: f.categories,
      photo_place_tags: f.photo_place_tags,
    })),
  };
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
  console.log("backup →", backupPath, {
    places: backup.places.length,
    feed_posts: backup.feed_posts.length,
  });

  // Apply places in batches
  let placesApplied = 0;
  for (let i = 0; i < flips.length; i += BATCH) {
    const batch = flips.slice(i, i + BATCH);
    for (const f of batch) {
      const { error } = await sb
        .from("places")
        .update({
          category: f.new_category,
          subcategory: f.new_subcategory,
        })
        .eq("id", f.id)
        .eq("category", "맛집");
      if (error) {
        console.error("[ABORT places batch]", {
          at: i,
          id: f.id,
          error,
          applied_before_fail: placesApplied,
        });
        process.exit(1);
      }
      placesApplied++;
    }
    console.log(`places applied ${placesApplied}/${flips.length}`);
  }

  // Apply feed in batches
  let feedApplied = 0;
  for (let i = 0; i < feedUpdates.length; i += BATCH) {
    const batch = feedUpdates.slice(i, i + BATCH);
    for (const u of batch) {
      const { error } = await sb
        .from("feed_posts")
        .update({
          categories: u.categories,
          photo_place_tags: u.photo_place_tags,
        })
        .eq("id", u.id);
      if (error) {
        console.error("[ABORT feed batch]", {
          at: i,
          id: u.id,
          error,
          places_applied: placesApplied,
          feed_applied_before_fail: feedApplied,
        });
        process.exit(1);
      }
      feedApplied++;
    }
    console.log(`feed applied ${feedApplied}/${feedUpdates.length}`);
  }

  // Reload chips after (non-archived)
  const feedAfter: Array<{ categories: string[] | null }> = [];
  feedFrom = 0;
  while (true) {
    const { data, error } = await sb
      .from("feed_posts")
      .select("id, categories, archived")
      .range(feedFrom, feedFrom + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) {
      if (r.archived === true) continue;
      feedAfter.push({
        categories: (r.categories as string[] | null) ?? null,
      });
    }
    if (data.length < 1000) break;
    feedFrom += 1000;
  }
  const chipsAfter = chipCountsFromPosts(feedAfter);

  const subDist: Record<string, number> = {
    호프: 0,
    이자카야: 0,
    와인바: 0,
    칵테일바: 0,
    포차: 0,
    null: 0,
  };
  for (const f of flips) {
    const k = f.new_subcategory ?? "null";
    subDist[k] = (subDist[k] || 0) + 1;
  }

  const mealNames = [...new Set(mealKeep.map((m) => m.name))];

  console.log("\n=== APPLY REPORT ===");
  console.log(
    JSON.stringify(
      {
        places_changed_rows: placesApplied,
        unique_places: uniqueKeys.size,
        meal_keep_rows: mealKeep.length,
        meal_keep_unique_names: mealNames.length,
        meal_keep_names_10: mealNames.slice(0, 10),
        chips_before: chipsBefore,
        chips_after: chipsAfter,
        subcategory_dist: subDist,
        feed_posts_updated: feedApplied,
        scan: { apiCalls, kakaoFail, notBar },
        backup: backupPath,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
