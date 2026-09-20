#!/usr/bin/env node
/**
 * photo_place_tags[].category 재계산 (일회성).
 *
 * 우선순위:
 *   1) places: 장소명 정확 일치 + 좌표 100m 이내 → places.category
 *      (category_edited_by_user=true 우선) → 적용
 *   2) poi: search_poi → category / raw_category 매핑
 *      ★ 기존 category가 있으면 적용하지 않음 (poi는 기존 값을 이기지 못함)
 *   3) unresolved + placeId 있음 → 카카오 keyword 검색으로 id 매칭 후
 *      category_group_code / category_name 으로 판정 (resolvePlaceCategorySignals 카카오 경로)
 *      ★ 카카오 응답 전체는 저장하지 않음. 판정된 category 문자열만 태그에 기록
 *   4) 그 외 건드리지 않음
 *
 * ★ feed_posts.categories 는 절대 수정하지 않음.
 *
 * Usage:
 *   node --env-file=.env.local scripts/reclassify-photo-place-tag-categories.mjs --dryRun
 *   node --env-file=.env.local scripts/reclassify-photo-place-tag-categories.mjs --apply
 *
 * 기본은 dryRun. --apply 는 승인 후에만.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PLACE_MATCH_RADIUS_M = 100;
const APP_CATS = ["맛집", "술집", "카페", "쇼핑", "숙소", "놀거리", "여행지"];
const APP_SET = new Set(APP_CATS);

function loadEnvLocal() {
  const p = resolve(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const mapJson = JSON.parse(
  readFileSync(resolve(ROOT, "lib/localdataCategoryMap.json"), "utf8"),
);
const CAFE_RAWS = new Set(mapJson.cafe);
const BAR_RAWS = new Set(mapJson.bar);
const PLAY_RAWS = new Set(mapJson.play);
const SHOP_RAWS = new Set(mapJson.shop);
const STAY_RAWS = new Set(mapJson.stay);
const UNINFO = new Set(mapJson.uninformative);
const EXCLUDE = new Set(mapJson.exclude);

function parseArgs(argv) {
  let dryRun = true;
  let apply = false;
  for (const a of argv) {
    if (a === "--dryRun" || a === "--dry-run") {
      dryRun = true;
      apply = false;
      continue;
    }
    if (a === "--apply") {
      apply = true;
      dryRun = false;
      continue;
    }
    throw new Error(`unknown arg: ${a}`);
  }
  return { dryRun, apply };
}

function haversineM(lat1, lng1, lat2, lng2) {
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

function compactName(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isAppCategory(v) {
  return typeof v === "string" && APP_SET.has(v.trim());
}

function mapLocaldataRawCategory(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t || UNINFO.has(t) || EXCLUDE.has(t)) return null;
  if (CAFE_RAWS.has(t)) return "카페";
  if (BAR_RAWS.has(t)) return "술집";
  if (PLAY_RAWS.has(t)) return "놀거리";
  if (SHOP_RAWS.has(t)) return "쇼핑";
  if (STAY_RAWS.has(t)) return "숙소";
  return null;
}

/** lib/kakaoCategory.ts resolvePlaceCategorySignals — 카카오 경로만 (claude/poi 없음) */
function isKakaoBarCategoryName(categoryName) {
  return String(categoryName ?? "").includes("> 술집 >");
}

function mapKakaoCategoryGroupCode(code) {
  const c = String(code ?? "").trim();
  if (!c) return null;
  if (c === "CE7") return "카페";
  if (c === "FD6") return "맛집";
  if (c === "MT1" || c === "CS2") return "쇼핑";
  if (c === "AD5") return "숙소";
  if (c === "AT4" || c === "CT1") return "여행지";
  if (c === "PK6" || c === "LN3") return "놀거리";
  return null;
}

function tryMapKakaoCategoryName(categoryName) {
  const n = String(categoryName ?? "");
  if (!n) return null;
  if (isKakaoBarCategoryName(n)) return "술집";
  if (n.includes("제과,베이커리") || n.includes("떡,한과")) return "카페";
  if (n.includes("카페")) return "카페";
  if (n.includes("음식점") || n.includes("음식")) return "맛집";
  if (n.includes("쇼핑") || n.includes("마트")) return "쇼핑";
  if (
    n.includes("카메라") ||
    n.includes("의류") ||
    n.includes("패션") ||
    n.includes("잡화") ||
    n.includes("문구") ||
    n.includes("서점") ||
    n.includes("안경") ||
    n.includes("화장품") ||
    n.includes("가전") ||
    n.includes("꽃집") ||
    n.includes("생활용품점") ||
    n.includes("반려동물") ||
    (n.includes("판매") && !n.includes("음식"))
  ) {
    return "쇼핑";
  }
  if (n.includes("숙박")) return "숙소";
  if (n.includes("관광") || n.includes("명소")) return "여행지";
  if (n.includes("스포츠") || n.includes("여가")) return "놀거리";
  return null;
}

/**
 * resolveExtractPlaceCategory 카카오 경로 (FD6 포함).
 * claude/poi/최종맛집폴백 없음 — FD6만 맛집.
 */
function resolveKakaoPlaceCategory(groupCode, categoryName) {
  if (isKakaoBarCategoryName(categoryName)) {
    return { category: "술집", source: "kakao_name" };
  }
  const code = String(groupCode ?? "").trim();
  if (code === "FD6") {
    return { category: "맛집", source: "kakao_code" };
  }
  const byCode = mapKakaoCategoryGroupCode(code);
  if (byCode) return { category: byCode, source: "kakao_code" };
  const byName = tryMapKakaoCategoryName(categoryName);
  if (byName) return { category: byName, source: "kakao_name" };
  return null;
}

/**
 * placeId로 keyword 검색 결과 중 id 매칭 → group_code/name만 추출.
 * 응답 전체는 저장·로깅하지 않음.
 */
async function fetchKakaoSignalsByPlaceId(
  restKey,
  placeId,
  placeName,
  lat,
  lng,
  counters,
) {
  counters.apiCalls += 1;
  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", placeName.trim());
  url.searchParams.set("size", "15");
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    url.searchParams.set("x", String(lng));
    url.searchParams.set("y", String(lat));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${restKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    counters.apiErrors += 1;
    return null;
  }
  const data = await res.json();
  const docs = Array.isArray(data?.documents) ? data.documents : [];
  let groupCode = null;
  let categoryName = null;
  let matched = false;
  for (const d of docs) {
    if (String(d?.id) === String(placeId)) {
      matched = true;
      groupCode =
        typeof d.category_group_code === "string" ? d.category_group_code : "";
      categoryName =
        typeof d.category_name === "string" ? d.category_name : "";
      break;
    }
  }
  // data/docs discarded here — only signals leave this function
  if (!matched) {
    counters.idMiss += 1;
    return null;
  }
  return { groupCode, categoryName };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

async function fetchAllFeedPosts(admin) {
  const out = [];
  let from = 0;
  const page = 500;
  for (;;) {
    const { data, error } = await admin
      .from("feed_posts")
      .select("id, photo_place_tags, archived")
      .range(from, from + page - 1);
    if (error) throw error;
    const rows = data || [];
    if (rows.length === 0) break;
    out.push(...rows);
    from += rows.length;
    if (rows.length < page) break;
  }
  return out;
}

async function fetchPlacesByNames(admin, names) {
  /** @type {Map<string, Array<{name:string,category:string,lat:number,lng:number,edited:boolean}>>} */
  const byName = new Map();
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const chunk = 80;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const { data, error } = await admin
      .from("places")
      .select("name, category, lat, lng, category_edited_by_user")
      .in("name", slice);
    if (error) throw error;
    for (const r of data || []) {
      const name = (r.name || "").trim();
      if (!name) continue;
      const cat = typeof r.category === "string" ? r.category.trim() : "";
      if (!isAppCategory(cat)) continue;
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const list = byName.get(name) || [];
      list.push({
        name,
        category: cat,
        lat,
        lng,
        edited: r.category_edited_by_user === true,
      });
      byName.set(name, list);
    }
  }
  return byName;
}

function lookupPlacesCategory(byName, placeName, lat, lng) {
  const list = byName.get(placeName.trim());
  if (!list?.length) return null;
  const near = [];
  for (const r of list) {
    const dist = haversineM(lat, lng, r.lat, r.lng);
    if (dist > PLACE_MATCH_RADIUS_M) continue;
    near.push({ ...r, dist });
  }
  if (near.length === 0) return null;
  near.sort((a, b) => {
    if (a.edited !== b.edited) return a.edited ? -1 : 1;
    return a.dist - b.dist;
  });
  return { category: near[0].category, source: near[0].edited ? "places_edited" : "places" };
}

async function lookupPoiCategory(admin, placeName, lat, lng) {
  const { data, error } = await admin.rpc("search_poi", {
    q: placeName.trim(),
    hint_region: null,
    origin_lat: lat,
    origin_lng: lng,
    max_results: 5,
  });
  if (error) {
    console.error("[poi] search_poi failed", placeName, error.message);
    return null;
  }
  const target = compactName(placeName);
  for (const hit of data || []) {
    const hitLat = hit.lat != null ? Number(hit.lat) : NaN;
    const hitLng = hit.lng != null ? Number(hit.lng) : NaN;
    if (!Number.isFinite(hitLat) || !Number.isFinite(hitLng)) continue;
    if (haversineM(lat, lng, hitLat, hitLng) > PLACE_MATCH_RADIUS_M) continue;
    const hitNorm = compactName(hit.name);
    const nameNorm = hit.name_norm ? compactName(hit.name_norm) : "";
    const nameOk =
      hitNorm === target ||
      nameNorm === target ||
      hitNorm.includes(target) ||
      target.includes(hitNorm);
    if (!nameOk) continue;
    if (isAppCategory(hit.category)) {
      return { category: hit.category.trim(), source: "poi_category" };
    }
    const fromRaw = mapLocaldataRawCategory(hit.raw_category);
    if (fromRaw) return { category: fromRaw, source: "poi_raw" };
  }
  return null;
}

async function main() {
  const { dryRun, apply } = parseArgs(process.argv.slice(2));
  if (!dryRun && !apply) {
    console.error("use --dryRun or --apply");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  console.log(`mode=${dryRun ? "dryRun" : "APPLY"}`);

  const posts = await fetchAllFeedPosts(admin);
  /** @type {Array<{postId:string, tagIndex:number, placeName:string, placeId:string|null, lat:number, lng:number, oldCat:string, tag:any}>} */
  const tagRows = [];
  for (const post of posts) {
    if (post.archived) continue;
    const tags = Array.isArray(post.photo_place_tags) ? post.photo_place_tags : [];
    tags.forEach((tag, tagIndex) => {
      if (!tag || typeof tag !== "object") return;
      const placeName = typeof tag.placeName === "string" ? tag.placeName.trim() : "";
      const lat = Number(tag.lat);
      const lng = Number(tag.lng);
      const oldCat = typeof tag.category === "string" ? tag.category.trim() : "";
      if (!placeName || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const rawId = tag.placeId;
      const placeId =
        rawId === null || rawId === undefined
          ? null
          : String(rawId).trim() || null;
      tagRows.push({
        postId: post.id,
        tagIndex,
        placeName,
        placeId,
        lat,
        lng,
        oldCat,
        tag,
      });
    });
  }

  const totalTags = tagRows.length;
  console.log(`posts=${posts.length} tags_with_coords=${totalTags}`);

  const placesByName = await fetchPlacesByNames(
    admin,
    tagRows.map((t) => t.placeName),
  );
  console.log(`places_name_buckets=${placesByName.size}`);

  const restKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!restKey) {
    console.warn("WARN: KAKAO_REST_API_KEY missing — placeId Kakao pass will skip");
  }

  /** @type {Array<{postId:string, tagIndex:number, placeName:string, from:string, to:string, source:string}>} */
  const changes = [];
  /** poi가 다른 값을 제안했지만 기존 category가 있어 스킵한 건 */
  const poiSkipped = [];
  /** @type {typeof tagRows} */
  const unresolvedRows = [];
  let same = 0;
  const poiCache = new Map();
  /** unresolved 중 poi hit(이름+100m)은 있었으나 category 매핑 실패 */
  let unresolvedPoiHitUnmapped = 0;
  let unresolvedPoiNoHit = 0;

  function isPoiSource(src) {
    return src === "poi_category" || src === "poi_raw" || src === "poi";
  }

  function reportSourceBucket(src) {
    if (src === "kakao_code" || src === "kakao_group") return "kakao_code";
    if (src === "kakao_name") return "kakao_name";
    if (src === "places" || src === "places_edited") return "places";
    if (isPoiSource(src)) return "poi";
    return src;
  }

  async function probePoiHit(placeName, lat, lng) {
    const cacheKey = `probe|${placeName}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
    if (poiCache.has(cacheKey)) return poiCache.get(cacheKey);
    const { data, error } = await admin.rpc("search_poi", {
      q: placeName.trim(),
      hint_region: null,
      origin_lat: lat,
      origin_lng: lng,
      max_results: 5,
    });
    if (error) {
      poiCache.set(cacheKey, false);
      return false;
    }
    const target = compactName(placeName);
    let hit = false;
    for (const row of data || []) {
      const hitLat = row.lat != null ? Number(row.lat) : NaN;
      const hitLng = row.lng != null ? Number(row.lng) : NaN;
      if (!Number.isFinite(hitLat) || !Number.isFinite(hitLng)) continue;
      if (haversineM(lat, lng, hitLat, hitLng) > PLACE_MATCH_RADIUS_M) continue;
      const hitNorm = compactName(row.name);
      const nameNorm = row.name_norm ? compactName(row.name_norm) : "";
      const nameOk =
        hitNorm === target ||
        nameNorm === target ||
        hitNorm.includes(target) ||
        target.includes(hitNorm);
      if (!nameOk) continue;
      hit = true;
      break;
    }
    poiCache.set(cacheKey, hit);
    return hit;
  }

  for (let i = 0; i < tagRows.length; i++) {
    const row = tagRows[i];
    let resolved = lookupPlacesCategory(
      placesByName,
      row.placeName,
      row.lat,
      row.lng,
    );
    if (!resolved) {
      const cacheKey = `${row.placeName}|${row.lat.toFixed(5)}|${row.lng.toFixed(5)}`;
      if (poiCache.has(cacheKey)) {
        resolved = poiCache.get(cacheKey);
      } else {
        resolved = await lookupPoiCategory(admin, row.placeName, row.lat, row.lng);
        poiCache.set(cacheKey, resolved);
      }
    }
    if (!resolved) {
      unresolvedRows.push(row);
      if (await probePoiHit(row.placeName, row.lat, row.lng)) {
        unresolvedPoiHitUnmapped += 1;
      } else {
        unresolvedPoiNoHit += 1;
      }
      continue;
    }

    // poi 단독: 기존 category가 있으면 덮지 않음
    if (isPoiSource(resolved.source) && row.oldCat) {
      if (resolved.category !== row.oldCat) {
        poiSkipped.push({
          postId: row.postId,
          tagIndex: row.tagIndex,
          placeName: row.placeName,
          from: row.oldCat,
          to: resolved.category,
          source: resolved.source,
        });
      } else {
        same += 1;
      }
      continue;
    }

    if (resolved.category === row.oldCat) {
      same += 1;
      continue;
    }
    changes.push({
      postId: row.postId,
      tagIndex: row.tagIndex,
      placeName: row.placeName,
      from: row.oldCat || "(empty)",
      to: resolved.category,
      source: resolved.source,
    });
  }

  // --- Pass: unresolved + placeId → Kakao ---
  const unresolved = unresolvedRows.length;
  const unresolvedWithPlaceId = unresolvedRows.filter((r) => r.placeId);
  const unresolvedWithoutPlaceId = unresolved - unresolvedWithPlaceId.length;
  const kakaoCounters = { apiCalls: 0, apiErrors: 0, idMiss: 0 };
  /** @type {Map<string, {groupCode:string, categoryName:string}|null>} */
  const kakaoSignalCache = new Map();
  /** @type {typeof changes} */
  const kakaoChanges = [];
  let kakaoSame = 0;
  let kakaoUnresolvedStill = 0;

  for (const row of unresolvedWithPlaceId) {
    if (!restKey) {
      kakaoUnresolvedStill += 1;
      continue;
    }
    let signals = kakaoSignalCache.get(row.placeId);
    if (signals === undefined) {
      signals = await fetchKakaoSignalsByPlaceId(
        restKey,
        row.placeId,
        row.placeName,
        row.lat,
        row.lng,
        kakaoCounters,
      );
      kakaoSignalCache.set(row.placeId, signals);
      // small pacing
      await new Promise((r) => setTimeout(r, 40));
    }
    if (!signals) {
      kakaoUnresolvedStill += 1;
      continue;
    }
    const resolved = resolveKakaoPlaceCategory(
      signals.groupCode,
      signals.categoryName,
    );
    if (!resolved) {
      kakaoUnresolvedStill += 1;
      continue;
    }
    if (resolved.category === row.oldCat) {
      kakaoSame += 1;
      same += 1;
      continue;
    }
    const change = {
      postId: row.postId,
      tagIndex: row.tagIndex,
      placeName: row.placeName,
      from: row.oldCat || "(empty)",
      to: resolved.category,
      source: resolved.source,
    };
    kakaoChanges.push(change);
    changes.push(change);
  }

  // Transition distribution (applied only)
  const transitions = new Map();
  for (const c of changes) {
    const key = `${c.from}→${c.to}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
  }
  const kakaoTransitions = new Map();
  for (const c of kakaoChanges) {
    const key = `${c.from}→${c.to}`;
    kakaoTransitions.set(key, (kakaoTransitions.get(key) || 0) + 1);
  }

  const sourceApplied = {
    kakao_code: 0,
    kakao_name: 0,
    places: 0,
    poi: 0,
  };
  for (const c of changes) {
    const b = reportSourceBucket(c.source);
    if (b in sourceApplied) sourceApplied[b] += 1;
  }

  // Expected chip counts after recompute (applied only)
  const chipAfter = Object.fromEntries(APP_CATS.map((c) => [c, 0]));
  const chipBefore = Object.fromEntries(APP_CATS.map((c) => [c, 0]));
  const changeMap = new Map(
    changes.map((c) => [`${c.postId}:${c.tagIndex}`, c.to]),
  );
  for (const row of tagRows) {
    const before = row.oldCat;
    if (APP_SET.has(before)) chipBefore[before] += 1;
    const key = `${row.postId}:${row.tagIndex}`;
    const after = changeMap.has(key) ? changeMap.get(key) : before;
    if (APP_SET.has(after)) chipAfter[after] += 1;
  }

  console.log("\n=== SUMMARY ===");
  console.log(`total_tags=${totalTags}`);
  console.log(`changing_applied=${changes.length}`);
  console.log(`  places=${sourceApplied.places}`);
  console.log(`  kakao_code=${sourceApplied.kakao_code}`);
  console.log(`  kakao_name=${sourceApplied.kakao_name}`);
  console.log(`  poi=${sourceApplied.poi}`);
  console.log(`poi_skipped_keep_existing=${poiSkipped.length}`);
  console.log(`unchanged_same_category=${same}`);
  console.log(`unresolved_before_kakao=${unresolved}`);

  console.log("\n=== UNRESOLVED → KAKAO placeId PASS ===");
  console.log(`unresolved_total=${unresolved}`);
  console.log(`unresolved_with_placeId=${unresolvedWithPlaceId.length}`);
  console.log(`unresolved_without_placeId=${unresolvedWithoutPlaceId}`);
  console.log(`kakao_changing=${kakaoChanges.length}`);
  console.log(`kakao_same_category=${kakaoSame}`);
  console.log(`kakao_still_unresolved=${kakaoUnresolvedStill + unresolvedWithoutPlaceId}`);
  console.log(`kakao_api_calls=${kakaoCounters.apiCalls}`);
  console.log(`kakao_api_errors=${kakaoCounters.apiErrors}`);
  console.log(`kakao_id_miss_in_results=${kakaoCounters.idMiss}`);
  console.log(`unique_placeIds_queried=${kakaoSignalCache.size}`);

  console.log("\n=== POI among unresolved (separate check) ===");
  console.log(`poi_hit_but_unmapped_category=${unresolvedPoiHitUnmapped}`);
  console.log(`poi_no_nearby_name_hit=${unresolvedPoiNoHit}`);

  console.log("\n=== KAKAO PASS TRANSITIONS ===");
  for (const [k, n] of [...kakaoTransitions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }

  console.log("\n=== 언포모 ===");
  const unpomoChanges = kakaoChanges.filter((c) => c.placeName.includes("언포모"));
  const unpomoRows = unresolvedWithPlaceId.filter((r) =>
    r.placeName.includes("언포모"),
  );
  if (unpomoChanges.length) {
    for (const c of unpomoChanges) {
      console.log(`  ${c.placeName} | ${c.from} → ${c.to} | src=${c.source}`);
    }
  } else if (unpomoRows.length) {
    for (const r of unpomoRows) {
      const sig = r.placeId ? kakaoSignalCache.get(r.placeId) : null;
      const mapped = sig
        ? resolveKakaoPlaceCategory(sig.groupCode, sig.categoryName)
        : null;
      console.log(
        `  ${r.placeName} | placeId=${r.placeId} | old=${r.oldCat} | group=${sig?.groupCode ?? "(none)"} | mapped=${mapped?.category ?? "(null)"}`,
      );
    }
  } else {
    console.log("  (not in unresolved-with-placeId set — may already be places-resolved)");
    const any = tagRows.filter((r) => r.placeName.includes("언포모"));
    for (const r of any) {
      const key = `${r.postId}:${r.tagIndex}`;
      const after = changeMap.get(key);
      console.log(
        `  ${r.placeName} | old=${r.oldCat} | after=${after ?? r.oldCat} | placeId=${r.placeId}`,
      );
    }
  }

  console.log("\n=== SAMPLE 20 (random among kakao placeId changes) ===");
  const sample = [...kakaoChanges];
  shuffleInPlace(sample);
  for (const s of sample.slice(0, 20)) {
    console.log(
      `  ${s.placeName} | ${s.from} → ${s.to} | src=${s.source} | post=${s.postId.slice(0, 8)}`,
    );
  }

  console.log("\n=== ALL APPLIED TRANSITIONS ===");
  for (const [k, n] of [...transitions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }

  console.log("\n=== CHIP COUNTS (tag category) ===");
  console.log("before:", chipBefore);
  console.log("after: ", chipAfter);

  if (dryRun) {
    console.log("\n[dryRun] no writes. Re-run with --apply after approval.");
    return;
  }

  // APPLY: group by postId, rewrite photo_place_tags only
  const byPost = new Map();
  for (const c of changes) {
    const list = byPost.get(c.postId) || [];
    list.push(c);
    byPost.set(c.postId, list);
  }

  let updatedPosts = 0;
  for (const post of posts) {
    const postChanges = byPost.get(post.id);
    if (!postChanges?.length) continue;
    const tags = Array.isArray(post.photo_place_tags)
      ? post.photo_place_tags.map((t) => ({ ...t }))
      : [];
    for (const c of postChanges) {
      if (!tags[c.tagIndex]) continue;
      tags[c.tagIndex] = { ...tags[c.tagIndex], category: c.to };
    }
    const { error } = await admin
      .from("feed_posts")
      .update({ photo_place_tags: tags })
      .eq("id", post.id);
    if (error) {
      console.error("update failed", post.id, error.message);
      continue;
    }
    updatedPosts += 1;
  }
  console.log(`\n[apply] updated_posts=${updatedPosts} changed_tags=${changes.length}`);
  console.log("(feed_posts.categories untouched)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
