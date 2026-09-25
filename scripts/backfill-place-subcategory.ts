#!/usr/bin/env node
/**
 * Backfill places.subcategory from Kakao category_name path.
 *
 * ★ Never writes places.category
 * ★ Never persists Kakao API responses — judgment only
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/backfill-place-subcategory.ts --dryRun
 *   node --env-file=.env.local --import tsx scripts/backfill-place-subcategory.ts --apply
 *
 * Args:
 *   --dryRun | --dry-run   classify only; no DB writes (default)
 *   --apply                UPDATE subcategory only (never category)
 *   --concurrency N        default 12
 *   --limit N              max places to process (optional)
 */
import fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import {
  FEED_POST_CATEGORIES,
  type FeedPostCategory,
} from "../lib/feedPost";
import { resolveKakaoSubcategory } from "../lib/kakaoSubcategory";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

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

function parseArgs(argv: string[]) {
  let dryRun = true;
  let apply = false;
  let concurrency = 12;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dryRun" || a === "--dry-run") {
      dryRun = true;
      apply = false;
    }
    if (a === "--apply") {
      apply = true;
      dryRun = false;
    }
    if (a === "--concurrency") {
      concurrency = Math.max(1, Number(argv[++i]) || 12);
    }
    if (a === "--limit") {
      limit = Math.max(1, Number(argv[++i]) || 0) || null;
    }
  }
  return { dryRun, apply, concurrency, limit };
}

function isAppCategory(v: string): v is FeedPostCategory {
  return (FEED_POST_CATEGORIES as readonly string[]).includes(v);
}

async function fetchKakaoDoc(
  kakaoKey: string,
  id: string,
  name: string,
): Promise<{ category_name: string } | null> {
  const u = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  u.searchParams.set("query", name || id);
  u.searchParams.set("size", "7");
  const res = await fetch(u, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    documents?: Array<{ id?: string; category_name?: string }>;
  };
  const docs = data.documents || [];
  const hit =
    docs.find((d) => String(d.id) === String(id)) || docs[0] || null;
  if (!hit) return null;
  return { category_name: String(hit.category_name ?? "") };
}

async function main() {
  const { dryRun, apply, concurrency, limit } = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const kakaoKey = env.KAKAO_REST_API_KEY;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!kakaoKey || !url || !key) {
    console.error("KAKAO_REST_API_KEY / SUPABASE env required");
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  type Row = {
    id: string;
    name: string;
    category: string;
    poi_id: string | null;
    subcategory: string | null;
  };

  const rows: Row[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("places")
      .select("id, name, category, poi_id, subcategory")
      .not("poi_id", "is", null)
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) {
      const poi = r.poi_id == null ? "" : String(r.poi_id).trim();
      if (!poi || poi.startsWith("manual-")) continue;
      if (!isAppCategory(String(r.category ?? ""))) continue;
      rows.push({
        id: String(r.id),
        name: String(r.name ?? "").trim(),
        category: String(r.category),
        poi_id: poi,
        subcategory:
          typeof r.subcategory === "string" && r.subcategory.trim()
            ? r.subcategory.trim()
            : null,
      });
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  const targets = limit ? rows.slice(0, limit) : rows;
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dryRun",
        candidates: targets.length,
        note: "UPDATE subcategory only — never category",
      },
      null,
      2,
    ),
  );

  const byCatDist: Record<string, Record<string, number>> = {};
  for (const c of FEED_POST_CATEGORIES) byCatDist[c] = {};

  let apiCalls = 0;
  let wouldFill = 0;
  let alreadySet = 0;
  let stayNull = 0;
  let kakaoFail = 0;
  let noName = 0;
  let skippedUnchanged = 0;
  const updates: Array<{ id: string; subcategory: string }> = [];

  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const i = idx++;
      const row = targets[i]!;
      if (!row.name) {
        noName++;
        stayNull++;
        continue;
      }
      apiCalls++;
      const doc = await fetchKakaoDoc(kakaoKey!, row.poi_id!, row.name);
      if (!doc) {
        kakaoFail++;
        stayNull++;
        continue;
      }
      const cat = row.category as FeedPostCategory;
      const sub = resolveKakaoSubcategory(cat, doc.category_name);
      if (!sub) {
        stayNull++;
        continue;
      }
      byCatDist[cat]![sub] = (byCatDist[cat]![sub] || 0) + 1;
      if (row.subcategory === sub) {
        alreadySet++;
        skippedUnchanged++;
        continue;
      }
      wouldFill++;
      updates.push({ id: row.id, subcategory: sub });
      if ((i + 1) % 500 === 0) {
        process.stderr.write(
          `p ${i + 1}/${targets.length} fill=${wouldFill} null=${stayNull}\n`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, () => worker()),
  );

  // Sort distributions
  const distribution: Record<string, Array<[string, number]>> = {};
  for (const c of FEED_POST_CATEGORIES) {
    distribution[c] = Object.entries(byCatDist[c]!)
      .sort((a, b) => b[1] - a[1]);
  }

  console.log(
    JSON.stringify(
      {
        apiCalls,
        wouldFill,
        alreadySet,
        stayNull,
        kakaoFail,
        noName,
        skippedUnchanged,
        distribution,
        categoryUpdates: 0, // hard guarantee
      },
      null,
      2,
    ),
  );

  if (dryRun || !apply) {
    console.log("[dryRun] no DB writes");
    return;
  }

  // Apply: UPDATE subcategory only — never touch category column
  let updated = 0;
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await Promise.all(
      chunk.map(async (u) => {
        const { error } = await sb
          .from("places")
          .update({ subcategory: u.subcategory })
          .eq("id", u.id)
          .select("id");
        // Explicit: do not pass category in update payload
        if (error) throw error;
        updated++;
      }),
    );
  }
  console.log(JSON.stringify({ applied: updated, categoryUntouched: true }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
