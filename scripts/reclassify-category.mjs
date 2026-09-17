#!/usr/bin/env node
/**
 * Reclassify places.category via Claude Haiku (no Kakao).
 *
 * Target:
 *   source='poi' AND category='맛집'
 *   AND poi.raw_category IN (기타, 기타 휴게음식점, 일반조리판매, 경양식) OR NULL
 *
 * Usage:
 *   node --env-file=.env.local scripts/reclassify-category.mjs --dryRun
 *   node --env-file=.env.local scripts/reclassify-category.mjs --apply
 *
 * Env:
 *   ANTHROPIC_API_KEY
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   (or scripts/localdata/.db_url for candidate fetch)
 *
 * Args:
 *   --dryRun | --dry-run   classify only; no DB writes (default if neither flag)
 *   --apply                create backup + UPDATE category only
 *   --batchSize N          default 50
 *   --maxBatches N         default unlimited (ceil)
 *   --cursor ID            resume after this place id
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

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

const MODEL = "claude-haiku-4-5-20251001";
const API = "https://api.anthropic.com/v1/messages";
const CATEGORIES = new Set(["맛집", "카페", "쇼핑", "숙소", "놀거리", "여행지"]);
const TARGET_RAWS = new Set(["기타", "기타 휴게음식점", "일반조리판매", "경양식"]);
const DEFAULT_BATCH = 50;
const MAX_ATTEMPTS = 3;
const RETRY_WAIT_MS = 30_000;
const BACKUP_TABLE = "places_category_reclassify_backup";

/** Haiku 4.5 list prices (USD / MTok) — estimate only */
const PRICE_IN_PER_M = 1.0;
const PRICE_OUT_PER_M = 5.0;

const REPORT_NAMES = [
  "미루아",
  "누에그",
  "ffs",
  "언덕과 물결",
  "아뜰리에 보네",
  "녹녹",
  "브라운칩",
  "무화",
  "이치서울",
];

const SYSTEM = [
  "You classify Korean places into exactly one category.",
  "Return ONLY a pure JSON array. No markdown, no code fences, no explanation.",
  'Format: [{"id":"<uuid>","category":"<label>"}]',
  'category must be one of: 맛집, 카페, 쇼핑, 숙소, 놀거리, 여행지, unknown',
  "Rules:",
  "- LOCALDATA 업태(raw_category) is a licensing label and may be wrong; prefer the place name.",
  "- Cafe, dessert, bakery, roastery, brunch → 카페",
  "- Meal-focused restaurants, bars, pubs → 맛집",
  "- If unsure, return unknown. Do not force a label.",
].join("\n");

function parseArgs(argv) {
  let dryRun = true;
  let apply = false;
  let batchSize = DEFAULT_BATCH;
  let maxBatches = Number.POSITIVE_INFINITY;
  let cursor = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
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
    if (a === "--batchSize" || a === "--batch-size") {
      batchSize = Math.floor(Number(argv[++i]));
      continue;
    }
    if (a.startsWith("--batchSize=")) {
      batchSize = Math.floor(Number(a.slice("--batchSize=".length)));
      continue;
    }
    if (a === "--maxBatches" || a === "--max-batches") {
      maxBatches = Math.floor(Number(argv[++i]));
      continue;
    }
    if (a.startsWith("--maxBatches=")) {
      maxBatches = Math.floor(Number(a.slice("--maxBatches=".length)));
      continue;
    }
    if (a === "--cursor") {
      cursor = String(argv[++i] || "").trim() || null;
      continue;
    }
    if (a.startsWith("--cursor=")) {
      cursor = a.slice("--cursor=".length).trim() || null;
      continue;
    }
    throw new Error(`unknown arg: ${a}`);
  }
  if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("batchSize must be 1..100");
  }
  return { dryRun, apply, batchSize, maxBatches, cursor };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

/** Fetch candidates via psycopg2 (join + raw filter). Ordered by id. */
function fetchCandidates() {
  const py = resolve(ROOT, "scripts/localdata/.venv/bin/python");
  const dbUrlPath = resolve(ROOT, "scripts/localdata/.db_url");
  const code = `
import json
from pathlib import Path
import psycopg2

db = Path(${JSON.stringify(dbUrlPath)}).read_text().strip()
conn = psycopg2.connect(db)
cur = conn.cursor()
cur.execute("""
  SELECT p.id::text, p.name, COALESCE(p.address, ''), p.category, poi.raw_category
  FROM public.places p
  INNER JOIN public.poi ON poi.id = p.poi_id
  WHERE p.source = 'poi'
    AND p.category = '맛집'
    AND (
      poi.raw_category IS NULL
      OR poi.raw_category IN ('기타', '기타 휴게음식점', '일반조리판매', '경양식')
    )
  ORDER BY p.id
""")
rows = [
  {
    "id": r[0],
    "name": r[1] or "",
    "address": r[2] or "",
    "category": r[3] or "",
    "raw_category": r[4],
  }
  for r in cur.fetchall()
]
conn.close()
print(json.dumps(rows, ensure_ascii=False))
`;
  const r = spawnSync(py, ["-c", code], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    cwd: ROOT,
  });
  if (r.status !== 0) {
    throw new Error(`fetchCandidates failed: ${r.stderr || r.stdout}`);
  }
  const rows = JSON.parse(r.stdout.trim());
  if (!Array.isArray(rows)) throw new Error("bad candidate list");
  return rows;
}

function parseClaudeJson(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  const arr = JSON.parse(t);
  if (!Array.isArray(arr)) throw new Error("response not array");
  return arr;
}

async function callClaudeBatch(apiKey, items) {
  const payload = items.map((it) => ({
    id: it.id,
    name: it.name,
    address: it.address,
    raw_category: it.raw_category,
  }));
  const user = [
    "Classify each place. Return one object per input id.",
    JSON.stringify(payload, null, 0),
  ].join("\n");

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(JSON.stringify(data).slice(0, 400));
    err.status = res.status;
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  const text = data.content?.find((c) => c.type === "text")?.text?.trim() || "";
  const usage = {
    input_tokens: Number(data.usage?.input_tokens || 0),
    output_tokens: Number(data.usage?.output_tokens || 0),
  };
  const parsed = parseClaudeJson(text);
  return { parsed, usage };
}

function normalizeLabel(raw) {
  const t = String(raw || "").trim();
  if (t === "unknown" || t === "Unknown" || t === "UNKNOWN") return "unknown";
  if (CATEGORIES.has(t)) return t;
  return null;
}

async function ensureBackup(admin, ids) {
  // Create backup table (id, category only) then insert current values for targets.
  const { error: createErr } = await admin.rpc("exec_sql", {}).maybeSingle?.();
  void createErr;
  // Use raw SQL via postgres through python — supabase JS has no arbitrary DDL reliably.
  const py = resolve(ROOT, "scripts/localdata/.venv/bin/python");
  const dbUrlPath = resolve(ROOT, "scripts/localdata/.db_url");
  const code = `
import json
from pathlib import Path
import psycopg2
db = Path(${JSON.stringify(dbUrlPath)}).read_text().strip()
conn = psycopg2.connect(db)
conn.autocommit = True
cur = conn.cursor()
cur.execute("""
CREATE TABLE IF NOT EXISTS public.${BACKUP_TABLE} (
  id text PRIMARY KEY,
  category text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
)
""")
ids = json.loads(${JSON.stringify(JSON.stringify(ids))})
# insert only missing
cur.execute("SELECT id FROM public.${BACKUP_TABLE}")
have = {r[0] for r in cur.fetchall()}
missing = [i for i in ids if i not in have]
if missing:
  cur.execute(
    """
    INSERT INTO public.${BACKUP_TABLE} (id, category)
    SELECT p.id::text, p.category
    FROM public.places p
    WHERE p.id::text = ANY(%s)
    ON CONFLICT (id) DO NOTHING
    """,
    (missing,),
  )
print(json.dumps({"backed_up": len(missing), "already": len(ids) - len(missing)}))
conn.close()
`;
  const r = spawnSync(py, ["-c", code], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    cwd: ROOT,
  });
  if (r.status !== 0) throw new Error(`backup failed: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim());
}

async function updateCategories(admin, updates) {
  // updates: [{id, category}] — category only
  for (const u of updates) {
    const { error } = await admin
      .from("places")
      .update({ category: u.category })
      .eq("id", u.id)
      .eq("category", "맛집"); // safety: only flip current 맛집
    if (error) throw error;
  }
}

async function main() {
  const { dryRun, apply, batchSize, maxBatches, cursor: startCursor } = parseArgs(
    process.argv.slice(2),
  );
  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY missing");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (apply && (!url || !key)) {
    console.error("supabase env required for --apply");
    process.exit(1);
  }
  const admin =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  console.log(
    `=== reclassify-category start dryRun=${dryRun} apply=${apply} batchSize=${batchSize} model=${MODEL} ===`,
  );

  let all = fetchCandidates();
  console.log(`candidates=${all.length}`);

  if (startCursor) {
    const idx = all.findIndex((r) => r.id === startCursor);
    if (idx >= 0) all = all.slice(idx + 1);
    console.log(`after cursor=${startCursor} remaining=${all.length}`);
  }

  if (apply) {
    const backup = await ensureBackup(
      admin,
      all.map((r) => r.id),
    );
    console.log(`backup_table=${BACKUP_TABLE}`, backup);
  }

  const transition = new Map(); // "맛집→카페" -> count
  const unknownCount = { n: 0 };
  const keep맛집 = { n: 0 };
  const byId = new Map(); // id -> {name, from, to, raw}
  let inputTokens = 0;
  let outputTokens = 0;
  let lastCursor = startCursor;

  const totalBatches = Math.ceil(all.length / batchSize);
  const limit = Math.min(totalBatches, maxBatches);

  for (let n = 1; n <= limit; n++) {
    const slice = all.slice((n - 1) * batchSize, n * batchSize);
    if (slice.length === 0) break;

    let parsed = null;
    let usage = { input_tokens: 0, output_tokens: 0 };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await callClaudeBatch(apiKey, slice);
        parsed = r.parsed;
        usage = r.usage;
        break;
      } catch (e) {
        const retryable = e.retryable === true;
        console.error(
          `batch ${n} attempt ${attempt}/${MAX_ATTEMPTS}: ${e.message || e}`,
        );
        if (!retryable || attempt === MAX_ATTEMPTS) {
          process.exit(1);
        }
        await sleep(RETRY_WAIT_MS);
      }
    }

    inputTokens += usage.input_tokens;
    outputTokens += usage.output_tokens;

    const byResp = new Map();
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const id = String(row.id || "").trim();
      const label = normalizeLabel(row.category);
      if (!id || !label) continue;
      byResp.set(id, label);
    }

    const toUpdate = [];
    for (const it of slice) {
      const label = byResp.get(it.id) || "unknown";
      byId.set(it.id, {
        name: it.name,
        from: "맛집",
        to: label,
        raw: it.raw_category,
      });
      if (label === "unknown") {
        unknownCount.n += 1;
        continue;
      }
      if (label === "맛집") {
        keep맛집.n += 1;
        continue;
      }
      const key = `맛집→${label}`;
      transition.set(key, (transition.get(key) || 0) + 1);
      toUpdate.push({ id: it.id, category: label });
    }

    if (apply && toUpdate.length > 0) {
      await updateCategories(admin, toUpdate);
    }

    lastCursor = slice[slice.length - 1].id;
    console.log(
      `batch ${n}/${limit} | size=${slice.length} | changes=${toUpdate.length} | ` +
        `in=${usage.input_tokens} out=${usage.output_tokens} | cursor=${lastCursor}`,
    );
  }

  // --- report ---
  const cost =
    (inputTokens / 1e6) * PRICE_IN_PER_M + (outputTokens / 1e6) * PRICE_OUT_PER_M;

  console.log("=== TRANSITION ===");
  const sorted = [...transition.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) console.log(`${k}\t${v}`);
  console.log(`맛집→맛집(keep)\t${keep맛집.n}`);
  console.log(`unknown(keep)\t${unknownCount.n}`);

  console.log("=== REPORT_NAMES ===");
  for (const name of REPORT_NAMES) {
    const hits = [...byId.entries()].filter(([, v]) => v.name === name);
    if (hits.length === 0) {
      // also try includes for slight name variance — only exact for report clarity
      const loose = [...byId.entries()].filter(([, v]) =>
        v.name.replace(/\s+/g, "").includes(name.replace(/\s+/g, "")),
      );
      if (loose.length === 0) {
        console.log(`${name}\t(not in target set)`);
      } else {
        for (const [id, v] of loose) {
          console.log(`${name}\t${v.to}\traw=${v.raw}\tid=${id}\tname=${v.name}`);
        }
      }
    } else {
      for (const [id, v] of hits) {
        console.log(`${name}\t${v.to}\traw=${v.raw}\tid=${id}`);
      }
    }
  }

  const cafeNames = [...byId.values()]
    .filter((v) => v.to === "카페")
    .map((v) => v.name);
  shuffleInPlace(cafeNames);
  console.log("=== SAMPLE 맛집→카페 (30) ===");
  for (const n of cafeNames.slice(0, 30)) console.log(n);

  console.log("=== USAGE ===");
  console.log(
    JSON.stringify(
      {
        model: MODEL,
        candidates: all.length,
        batches_run: limit,
        dryRun,
        apply,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        est_usd: Number(cost.toFixed(4)),
        price_assumption: {
          input_per_MTok_usd: PRICE_IN_PER_M,
          output_per_MTok_usd: PRICE_OUT_PER_M,
        },
        last_cursor: lastCursor,
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
