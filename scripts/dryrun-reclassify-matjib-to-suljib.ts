/**
 * Dry-run: places.category 맛집 → 술집 when Kakao category_name has "> 술집 >".
 *
 * ★ Never writes DB
 * ★ Never persists Kakao responses (judgment counts/samples only)
 * ★ Skips category_edited_by_user=true from the "would change" set
 *
 *   npx tsx scripts/dryrun-reclassify-matjib-to-suljib.ts
 *   QPS=8 LIMIT=0 npx tsx scripts/dryrun-reclassify-matjib-to-suljib.ts
 */
import fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

type PlaceRow = {
  id: string;
  name: string;
  address: string | null;
  category: string;
  lat: number | null;
  lng: number | null;
  source: string | null;
  poi_id: string | null;
  subcategory: string | null;
  edited: boolean;
  user_id: string | null;
};

type Hit = {
  id: string;
  name: string;
  category: string;
  path: string;
  l3: string;
  l3Bucket: string;
  next: string;
  edited: boolean;
  address: string | null;
  match: string;
  user_id: string | null;
  poi_id: string | null;
  lat: number | null;
  lng: number | null;
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

function parsePath(categoryName: string): { l2: string; l3: string } {
  const parts = String(categoryName ?? "")
    .split(/\s*>\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { l2: parts[1] ?? "", l3: parts[2] ?? "" };
}

function l3Bucket(l3: string): string {
  if (l3 === "호프,요리주점" || l3.includes("호프") || l3.includes("요리주점")) {
    return "호프·요리주점";
  }
  if (l3 === "일본식주점" || l3.includes("일본식주점")) return "일본식주점";
  if (l3 === "와인바" || l3.includes("와인바")) return "와인바";
  if (l3 === "칵테일바" || l3.includes("칵테일바")) return "칵테일바";
  return "기타";
}

function isBarPath(categoryName: string): boolean {
  return categoryName.includes("> 술집 >");
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

function loadPlaces(): PlaceRow[] {
  const dbUrl = fs.readFileSync(resolve(ROOT, "scripts/localdata/.db_url"), "utf8").trim();
  const py = resolve(ROOT, "scripts/localdata/.venv/bin/python");
  const code = `
import json, psycopg2
conn = psycopg2.connect(${JSON.stringify(dbUrl)})
cur = conn.cursor()
cur.execute("""
  SELECT id::text, name, address, category, lat, lng, source,
         poi_id::text, subcategory, COALESCE(category_edited_by_user,false), user_id::text
  FROM public.places
  WHERE category = '맛집'
  ORDER BY id
""")
out=[]
for r in cur.fetchall():
  out.append({
    "id": r[0], "name": r[1] or "", "address": r[2], "category": r[3],
    "lat": float(r[4]) if r[4] is not None else None,
    "lng": float(r[5]) if r[5] is not None else None,
    "source": r[6], "poi_id": r[7], "subcategory": r[8],
    "edited": bool(r[9]), "user_id": r[10],
  })
print(json.dumps(out, ensure_ascii=False))
conn.close()
`;
  const r = spawnSync(py, ["-c", code], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    cwd: ROOT,
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "python fail");
  return JSON.parse(r.stdout.trim()) as PlaceRow[];
}

type FeedSnap = {
  tagCategoryCounts: Record<string, number>;
  postCategoryChipCounts: Record<string, number>;
  tags: Array<{
    postId: string;
    placeId: string | null;
    placeName: string;
    category: string;
    lat: number | null;
    lng: number | null;
  }>;
  posts: Array<{ id: string; categories: string[] }>;
};

function loadFeed(): FeedSnap {
  const dbUrl = fs.readFileSync(resolve(ROOT, "scripts/localdata/.db_url"), "utf8").trim();
  const py = resolve(ROOT, "scripts/localdata/.venv/bin/python");
  const code = `
import json, psycopg2
from collections import Counter
conn = psycopg2.connect(${JSON.stringify(dbUrl)})
cur = conn.cursor()
cur.execute("""
  SELECT id::text, categories, photo_place_tags
  FROM public.feed_posts
  WHERE COALESCE(archived, false) = false
""")
tag_counts = Counter()
chip_counts = Counter()
tags=[]
posts=[]
for pid, cats, ptags in cur.fetchall():
  cl = list(cats or [])
  posts.append({"id": pid, "categories": cl})
  for c in cl:
    if isinstance(c, str) and c:
      chip_counts[c]+=1
  if not ptags: continue
  arr = ptags if isinstance(ptags, list) else []
  for t in arr:
    if not isinstance(t, dict): continue
    cat = t.get("category")
    if isinstance(cat, str) and cat:
      tag_counts[cat]+=1
    lat=t.get("lat"); lng=t.get("lng")
    tags.append({
      "postId": pid,
      "placeId": str(t["placeId"]) if t.get("placeId") is not None else None,
      "placeName": str(t.get("placeName") or t.get("name") or ""),
      "category": str(cat or ""),
      "lat": float(lat) if lat is not None else None,
      "lng": float(lng) if lng is not None else None,
    })
print(json.dumps({
  "tagCategoryCounts": dict(tag_counts),
  "postCategoryChipCounts": dict(chip_counts),
  "tags": tags,
  "posts": posts,
}, ensure_ascii=False))
conn.close()
`;
  const r = spawnSync(py, ["-c", code], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    cwd: ROOT,
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "feed python fail");
  return JSON.parse(r.stdout.trim()) as FeedSnap;
}

async function fetchKakaoPath(
  kakaoKey: string,
  place: PlaceRow,
  throttle: () => Promise<void>,
): Promise<{ path: string; match: string } | null> {
  await throttle();
  const u = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  u.searchParams.set("query", place.name || ".");
  u.searchParams.set("size", "7");
  if (
    place.lat != null &&
    place.lng != null &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng)
  ) {
    u.searchParams.set("x", String(place.lng));
    u.searchParams.set("y", String(place.lat));
    u.searchParams.set("radius", "20000");
  }
  const res = await fetch(u, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });
  const text = await res.text();
  if (res.status === 429 || /limit has been exceeded/i.test(text)) {
    throw new Error(`Kakao quota/429: ${text.slice(0, 200)}`);
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

  // Prefer kakao id match when source=kakao (poi_id = kakao id)
  if (place.source === "kakao" && place.poi_id) {
    const byId = docs.find((d) => String(d.id) === String(place.poi_id));
    if (byId) {
      return { path: String(byId.category_name ?? ""), match: "kakao_id" };
    }
  }

  // Prefer nearest within 100m
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
    if (best && bestD <= 100) {
      return { path: String(best.category_name ?? ""), match: "within_100m" };
    }
  }

  // Exact name match (no docs[0] fallback — that false-positives bar paths)
  const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const want = compact(place.name);
  const byName = docs.find((d) => compact(String(d.place_name ?? "")) === want);
  if (byName) {
    return { path: String(byName.category_name ?? ""), match: "exact_name" };
  }

  return null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function main() {
  const env = loadEnv();
  const kakaoKey = env.KAKAO_REST_API_KEY;
  if (!kakaoKey) throw new Error("KAKAO_REST_API_KEY missing");

  const qps = Math.max(1, Math.min(10, Number(process.env.QPS || 8)));
  const limit = Math.max(0, Number(process.env.LIMIT || 0)) || 0;
  const throttle = makeRateLimiter(qps);

  console.log("loading places…");
  const allMatjib = loadPlaces();
  const editedAll = allMatjib.filter((p) => p.edited);
  // Skip already-resolved food subcategories — bar path yields null subcategory.
  const candidates = allMatjib.filter((p) => !p.subcategory);
  const skipFilledSub = allMatjib.length - candidates.length;

  console.log(
    JSON.stringify(
      {
        matjib_total: allMatjib.length,
        edited_matjib: editedAll.length,
        candidates_null_subcategory: candidates.length,
        skipped_filled_subcategory: skipFilledSub,
        qps,
        limit: limit || null,
        note: "Kakao only for subcategory=null; filled food subs cannot be bar path",
      },
      null,
      2,
    ),
  );

  const targets = limit ? candidates.slice(0, limit) : candidates;
  const wouldFlip: Hit[] = [];
  const editedWouldMatch: Hit[] = [];
  const l3Dist: Record<string, number> = {
    "호프·요리주점": 0,
    일본식주점: 0,
    와인바: 0,
    칵테일바: 0,
    기타: 0,
  };
  const l3Raw: Record<string, number> = {};

  let apiCalls = 0;
  let kakaoFail = 0;
  let notBar = 0;
  let aborted: string | null = null;

  for (let i = 0; i < targets.length; i++) {
    const p = targets[i]!;
    if (!p.name.trim()) {
      kakaoFail++;
      continue;
    }
    let got: { path: string; match: string } | null;
    try {
      apiCalls++;
      got = await fetchKakaoPath(kakaoKey, p, throttle);
    } catch (e) {
      aborted = e instanceof Error ? e.message : String(e);
      console.error("[ABORT]", aborted, `at ${i}/${targets.length}`);
      break;
    }
    if (!got) {
      kakaoFail++;
      continue;
    }
    if (!isBarPath(got.path)) {
      notBar++;
      continue;
    }
    const { l3 } = parsePath(got.path);
    const bucket = l3Bucket(l3);
    l3Dist[bucket] = (l3Dist[bucket] || 0) + 1;
    l3Raw[l3 || "(empty)"] = (l3Raw[l3 || "(empty)"] || 0) + 1;
    const hit: Hit = {
      id: p.id,
      name: p.name,
      category: p.category,
      path: got.path,
      l3,
      l3Bucket: bucket,
      next: "술집",
      edited: p.edited,
      address: p.address,
      match: got.match,
      user_id: p.user_id,
      poi_id: p.poi_id,
      lat: p.lat,
      lng: p.lng,
    };
    if (p.edited) editedWouldMatch.push(hit);
    else wouldFlip.push(hit);

    if ((i + 1) % 200 === 0) {
      console.log(
        `progress ${i + 1}/${targets.length} flip=${wouldFlip.length} edited_skip=${editedWouldMatch.length} fail=${kakaoFail}`,
      );
    }
  }

  const sample = shuffle(wouldFlip).slice(0, 30);
  const uniqueKeys = new Set(
    wouldFlip.map((h) => {
      if (h.poi_id) return `poi:${h.poi_id}`;
      const lat = h.lat != null ? h.lat.toFixed(5) : "?";
      const lng = h.lng != null ? h.lng.toFixed(5) : "?";
      return `n:${h.name.replace(/\s+/g, "")}@${lat},${lng}`;
    }),
  );

  console.log("\n=== DRYRUN RESULT (no writes) ===");
  console.log(
    JSON.stringify(
      {
        matjib_total: allMatjib.length,
        edited_matjib_total: editedAll.length,
        scanned: targets.length,
        apiCalls,
        kakaoFail,
        notBar,
        aborted,
        would_change_맛집_to_술집_rows: wouldFlip.length,
        would_change_unique_places: uniqueKeys.size,
        edited_matched_bar_path_SKIPPED: editedWouldMatch.length,
        l3_buckets: l3Dist,
        l3_raw_top: Object.fromEntries(
          Object.entries(l3Raw)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20),
        ),
      },
      null,
      2,
    ),
  );

  console.log("\n=== SAMPLE 30 (would change) ===");
  for (const s of sample) {
    console.log(
      [
        s.name,
        `now=${s.category}`,
        `path=${s.path}`,
        `→${s.next}`,
        `l3=${s.l3Bucket}`,
      ].join(" | "),
    );
  }

  // 요리주점 / 이자카야 name heuristics among wouldFlip
  const hop = wouldFlip.filter((h) => h.l3Bucket === "호프·요리주점");
  const izakaya = wouldFlip.filter((h) => h.l3Bucket === "일본식주점");
  const nameLooksMeal = (n: string) =>
    /치킨|곱창|막창|삼겹|고기|갈비|국밥|찌개|백반|분식|돈까스|초밥|스시|라멘|우동|파스타|피자|버거|족발|보쌈|닭발|전골|샤브|회$|횟집|식당|밥집/.test(
      n,
    );
  console.log("\n=== AMBIGUOUS NAME HEURISTICS (among would-flip) ===");
  console.log(
    JSON.stringify(
      {
        hop_요리주점_count: hop.length,
        hop_name_looks_meal: hop.filter((h) => nameLooksMeal(h.name)).length,
        hop_meal_name_samples: shuffle(hop.filter((h) => nameLooksMeal(h.name)))
          .slice(0, 15)
          .map((h) => h.name),
        izakaya_count: izakaya.length,
        izakaya_name_looks_meal: izakaya.filter((h) => nameLooksMeal(h.name))
          .length,
        izakaya_meal_name_samples: shuffle(
          izakaya.filter((h) => nameLooksMeal(h.name)),
        )
          .slice(0, 15)
          .map((h) => h.name),
      },
      null,
      2,
    ),
  );

  console.log("\nloading feed_posts…");
  const feed = loadFeed();

  // Match tags to wouldFlip by placeId(=poi_id for kakao) or name+100m
  const flipByPoi = new Map<string, Hit>();
  const flipList = wouldFlip;
  for (const h of wouldFlip) {
    // find place row for poi
  }
  const placeById = new Map(allMatjib.map((p) => [p.id, p]));
  for (const h of wouldFlip) {
    const p = placeById.get(h.id);
    if (p?.poi_id) flipByPoi.set(String(p.poi_id), h);
  }

  let tagWouldFlip = 0;
  let tagAlreadySuljib = 0;
  let tagOther = 0;
  const tagFlipPostIds = new Set<string>();
  for (const t of feed.tags) {
    let hit: Hit | undefined;
    if (t.placeId && flipByPoi.has(t.placeId)) hit = flipByPoi.get(t.placeId);
    if (!hit && t.placeName && t.lat != null && t.lng != null) {
      for (const h of flipList) {
        const p = placeById.get(h.id);
        if (!p || p.lat == null || p.lng == null) continue;
        if (p.name.replace(/\s+/g, "") !== t.placeName.replace(/\s+/g, ""))
          continue;
        if (haversineM(p.lat, p.lng, t.lat, t.lng) <= 100) {
          hit = h;
          break;
        }
      }
    }
    if (!hit) continue;
    if (t.category === "맛집") {
      tagWouldFlip++;
      tagFlipPostIds.add(t.postId);
    } else if (t.category === "술집") tagAlreadySuljib++;
    else tagOther++;
  }

  // Simulate chip counts on feed_posts.categories
  const chipBefore = { ...feed.postCategoryChipCounts };
  const chipAfter = { ...chipBefore };
  let postsChipChange = 0;
  for (const post of feed.posts) {
    if (!tagFlipPostIds.has(post.id)) continue;
    // Rebuild categories from tags after flipping matched 맛집→술집 tags
    const tags = feed.tags.filter((t) => t.postId === post.id);
    const nextCats = new Set<string>();
    for (const t of tags) {
      let cat = t.category;
      let matched = false;
      if (t.placeId && flipByPoi.has(t.placeId)) matched = true;
      if (
        !matched &&
        t.placeName &&
        t.lat != null &&
        t.lng != null
      ) {
        for (const h of flipList) {
          const p = placeById.get(h.id);
          if (!p || p.lat == null || p.lng == null) continue;
          if (p.name.replace(/\s+/g, "") !== t.placeName.replace(/\s+/g, ""))
            continue;
          if (haversineM(p.lat, p.lng, t.lat, t.lng) <= 100) {
            matched = true;
            break;
          }
        }
      }
      if (matched && cat === "맛집") cat = "술집";
      if (cat) nextCats.add(cat);
    }
    const before = new Set(post.categories);
    if (
      before.has("맛집") !== nextCats.has("맛집") ||
      before.has("술집") !== nextCats.has("술집")
    ) {
      postsChipChange++;
    }
    for (const c of before) {
      chipAfter[c] = (chipAfter[c] || 0) - 1;
    }
    for (const c of nextCats) {
      chipAfter[c] = (chipAfter[c] || 0) + 1;
    }
  }

  console.log("\n=== FEED IMPACT (simulated) ===");
  console.log(
    JSON.stringify(
      {
        tag_category_counts_now: feed.tagCategoryCounts,
        photo_place_tags_맛집_would_become_술집: tagWouldFlip,
        photo_place_tags_already_술집_on_flip_place: tagAlreadySuljib,
        photo_place_tags_other_on_flip_place: tagOther,
        posts_with_tag_flip: tagFlipPostIds.size,
        posts_categories_chip_set_would_change: postsChipChange,
        chip_counts_before: chipBefore,
        chip_counts_after_if_tags_and_categories_updated: chipAfter,
        chip_delta: Object.fromEntries(
          [...new Set([...Object.keys(chipBefore), ...Object.keys(chipAfter)])]
            .sort()
            .map((k) => [k, (chipAfter[k] || 0) - (chipBefore[k] || 0)]),
        ),
      },
      null,
      2,
    ),
  );

  console.log("\n=== 1.7 NOTE ===");
  console.log(
    "DB has no app_version / device version. Cannot compute 1.7 vs 1.8 user ratio from DB.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
