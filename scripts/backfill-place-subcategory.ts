#!/usr/bin/env node
/**
 * Backfill places.subcategory from Kakao category_name path.
 *
 * ★ Never writes places.category
 * ★ Never persists Kakao API responses — judgment only
 * ★ Resume-safe: skips rows that already have subcategory
 * ★ Aborts immediately on 429 / Kakao quota exceeded (no retry loop)
 *
 * Usage:
 *   npx tsx scripts/backfill-place-subcategory.ts --dryRun
 *   npx tsx scripts/backfill-place-subcategory.ts --apply
 *
 * Args:
 *   --dryRun | --dry-run   classify only; no DB writes (default)
 *   --apply                UPDATE subcategory only (never category)
 *   --qps N                max Kakao calls per second (default 4)
 *   --limit N              max places to process (optional)
 */
import fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  FEED_POST_CATEGORIES,
  type FeedPostCategory,
} from "../lib/feedPost";
import { resolveKakaoSubcategory } from "../lib/kakaoSubcategory";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

class KakaoQuotaError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Kakao quota/rate limit hit status=${status} body=${body.slice(0, 200)}`);
    this.name = "KakaoQuotaError";
    this.status = status;
    this.body = body;
  }
}

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
  let qps = 4;
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
    if (a === "--qps") {
      qps = Math.max(1, Math.min(10, Number(argv[++i]) || 4));
    }
    if (a === "--limit") {
      limit = Math.max(1, Number(argv[++i]) || 0) || null;
    }
  }
  return { dryRun, apply, qps, limit };
}

function isAppCategory(v: string): v is FeedPostCategory {
  return (FEED_POST_CATEGORIES as readonly string[]).includes(v);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Serial rate limiter — at most `qps` Kakao calls per second. */
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

async function fetchKakaoDoc(
  kakaoKey: string,
  id: string,
  name: string,
  throttle: () => Promise<void>,
): Promise<{ category_name: string } | null> {
  // Transient network blips: retry up to 2 times. Never retry 429 / quota (-10).
  let lastNetErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    try {
      const u = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
      u.searchParams.set("query", name || id);
      u.searchParams.set("size", "7");
      const res = await fetch(u, {
        headers: { Authorization: `KakaoAK ${kakaoKey}` },
      });
      const text = await res.text();
      if (res.status === 429) {
        throw new KakaoQuotaError(429, text);
      }
      let data: {
        code?: number;
        msg?: string;
        documents?: Array<{ id?: string; category_name?: string }>;
      } = {};
      try {
        data = JSON.parse(text) as typeof data;
      } catch {
        return null;
      }
      // Official: code -10 = API limit exceeded — abort, never retry
      if (
        data.code === -10 ||
        /limit has been exceeded/i.test(String(data.msg ?? ""))
      ) {
        throw new KakaoQuotaError(res.status || 400, text);
      }
      if (!res.ok) return null;
      const docs = data.documents || [];
      const hit =
        docs.find((d) => String(d.id) === String(id)) || docs[0] || null;
      if (!hit) return null;
      return { category_name: String(hit.category_name ?? "") };
    } catch (e) {
      if (e instanceof KakaoQuotaError) throw e;
      lastNetErr = e;
      if (attempt < 2) await sleep(500 * (attempt + 1));
    }
  }
  throw lastNetErr instanceof Error
    ? lastNetErr
    : new Error(String(lastNetErr));
}

async function chipCounts(sb: SupabaseClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const c of FEED_POST_CATEGORIES) out[c] = 0;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("places")
      .select("category")
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) {
      const cat = String(r.category ?? "");
      if (isAppCategory(cat)) out[cat]!++;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function countsEqual(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  for (const c of FEED_POST_CATEGORIES) {
    if ((a[c] ?? 0) !== (b[c] ?? 0)) return false;
  }
  return true;
}

async function main() {
  const { dryRun, apply, qps, limit } = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const kakaoKey = env.KAKAO_REST_API_KEY;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!kakaoKey || !url || !key) {
    console.error("KAKAO_REST_API_KEY / SUPABASE env required");
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const throttle = makeRateLimiter(qps);
  const t0 = Date.now();

  type Row = {
    id: string;
    name: string;
    category: string;
    poi_id: string;
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
      const sub =
        typeof r.subcategory === "string" && r.subcategory.trim()
          ? r.subcategory.trim()
          : null;
      rows.push({
        id: String(r.id),
        name: String(r.name ?? "").trim(),
        category: String(r.category),
        poi_id: poi,
        subcategory: sub,
      });
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  // Resume: only rows without subcategory need Kakao
  const pending = rows.filter((r) => !r.subcategory);
  const alreadyFilled = rows.length - pending.length;
  const targets = limit ? pending.slice(0, limit) : pending;

  const chipsBefore = await chipCounts(sb);
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dryRun",
        qps,
        totalWithPoi: rows.length,
        alreadyFilled,
        pending: targets.length,
        note: "UPDATE subcategory only — never category; abort on 429/-10",
        chipsBefore,
      },
      null,
      2,
    ),
  );

  const byCatDist: Record<string, Record<string, number>> = {};
  for (const c of FEED_POST_CATEGORIES) byCatDist[c] = {};

  let apiCalls = 0;
  let filled = 0;
  let stayNull = 0;
  let kakaoFail = 0;
  let noName = 0;
  let aborted: string | null = null;
  const samplePool: Array<{
    name: string;
    category: string;
    subcategory: string;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i]!;
    if (!row.name) {
      noName++;
      stayNull++;
      continue;
    }
    let doc: { category_name: string } | null;
    try {
      apiCalls++;
      doc = await fetchKakaoDoc(kakaoKey, row.poi_id, row.name, throttle);
    } catch (e) {
      if (e instanceof KakaoQuotaError) {
        aborted = e.message;
        console.error("[ABORT]", aborted);
        break;
      }
      throw e;
    }
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

    if (apply) {
      // ★ subcategory only — category must never appear in this payload
      const payload = { subcategory: sub };
      if ("category" in payload) {
        throw new Error("REFUSING: category key present in update payload");
      }
      const { error } = await sb
        .from("places")
        .update(payload)
        .eq("id", row.id);
      if (error) throw error;
    }

    filled++;
    samplePool.push({ name: row.name, category: cat, subcategory: sub });

    if ((i + 1) % 200 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stderr.write(
        `p ${i + 1}/${targets.length} filled=${filled} null=${stayNull} api=${apiCalls} ${elapsed}s\n`,
      );
    }
  }

  const distribution: Record<string, Array<[string, number]>> = {};
  for (const c of FEED_POST_CATEGORIES) {
    distribution[c] = Object.entries(byCatDist[c]!).sort((a, b) => b[1] - a[1]);
  }

  const chipsAfter = await chipCounts(sb);
  const chipsUnchanged = countsEqual(chipsBefore, chipsAfter);

  // Random 20 from filled this run (or fewer)
  const shuffled = [...samplePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const sample20 = shuffled.slice(0, 20);

  const elapsedMs = Date.now() - t0;
  console.log(
    JSON.stringify(
      {
        aborted,
        filled,
        stayNull,
        kakaoFail,
        noName,
        apiCalls,
        alreadyFilledSkipped: alreadyFilled,
        distribution,
        chipsBefore,
        chipsAfter,
        chipsUnchanged,
        categoryUpdates: 0,
        elapsedMs,
        elapsedSec: Math.round(elapsedMs / 1000),
        sample20,
      },
      null,
      2,
    ),
  );

  if (!chipsUnchanged) {
    console.error("[FAIL] chip counts changed — investigate immediately");
    process.exit(2);
  }
  if (aborted) {
    process.exit(3);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
