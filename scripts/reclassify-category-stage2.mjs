#!/usr/bin/env node
/**
 * Stage 2: restore places.category from extract_jobs.claude_places (no Claude API, no Kakao).
 *
 * After stage1 Haiku pass, remaining source=poi + category=맛집 + ambiguous raw_category
 * may still be wrong because poi overwrote Claude's extract category.
 *
 * Usage:
 *   node --env-file=.env.local scripts/reclassify-category-stage2.mjs --dryRun
 *   node --env-file=.env.local scripts/reclassify-category-stage2.mjs --apply
 *
 * Matching:
 *   1) places.user_id = extract_jobs.user_id
 *   2) places.name equals claude_places[].name
 *   3) Prefer jobs with |created_at diff| <= 10 minutes when any exist
 *   4) Mode of Claude categories; tie → most recent job's category
 *   5) Only UPDATE when Claude category is one of 6 and !== 맛집
 *
 * Safety:
 *   --dryRun first. Backup table places_category_reclassify_backup_stage2 (id, category).
 *   category only. Never log caption / instagram_url.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BACKUP_TABLE = "places_category_reclassify_backup_stage2";
const CATEGORIES = new Set(["맛집", "카페", "쇼핑", "숙소", "놀거리", "여행지"]);
const WINDOW_SEC = 10 * 60;

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

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

function runPython(code) {
  const py = resolve(ROOT, "scripts/localdata/.venv/bin/python");
  const r = spawnSync(py, ["-c", code], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    cwd: ROOT,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || `python exit ${r.status}`);
  }
  return r.stdout.trim();
}

/**
 * Returns decisions for remaining stage1-universe 맛집 rows.
 * Each: { id, name, user_id, raw_category, matched, claude_category, action }
 * action: 'update' | 'keep_맛집' | 'no_match'
 */
function computeDecisions() {
  const dbUrlPath = resolve(ROOT, "scripts/localdata/.db_url");
  const code = `
import json
from pathlib import Path
from collections import Counter, defaultdict
import psycopg2

db = Path(${JSON.stringify(dbUrlPath)}).read_text().strip()
conn = psycopg2.connect(db)
cur = conn.cursor()
WINDOW = ${WINDOW_SEC}
CATS = {"맛집", "카페", "쇼핑", "숙소", "놀거리", "여행지"}

cur.execute("""
  SELECT p.id::text, p.name, p.user_id::text, p.created_at, poi.raw_category
  FROM public.places p
  INNER JOIN public.poi ON poi.id = p.poi_id
  WHERE p.source = 'poi'
    AND p.category = '맛집'
    AND COALESCE(p.category_edited_by_user, false) = false
    AND (
      poi.raw_category IS NULL
      OR poi.raw_category IN ('기타', '기타 휴게음식점', '일반조리판매', '경양식')
    )
  ORDER BY p.id
""")
places = cur.fetchall()

# Load jobs that share user_ids with targets (avoid full table scan of captions)
user_ids = list({r[2] for r in places if r[2]})
jobs_by_user = defaultdict(list)
if user_ids:
  cur.execute("""
    SELECT id::text, user_id::text, created_at, claude_places
    FROM public.extract_jobs
    WHERE user_id::text = ANY(%s)
      AND claude_places IS NOT NULL
      AND jsonb_typeof(claude_places) = 'array'
      AND jsonb_array_length(claude_places) > 0
  """, (user_ids,))
  for jid, uid, jat, places_json in cur.fetchall():
    # places_json already list/dict from psycopg2 jsonb
    items = places_json if isinstance(places_json, list) else []
    # keep only name+category — never carry caption/url
    slim = []
    for el in items:
      if not isinstance(el, dict):
        continue
      name = el.get("name")
      cat = el.get("category")
      if isinstance(name, str) and name.strip() and isinstance(cat, str):
        slim.append({"name": name.strip(), "category": cat.strip()})
    if slim:
      jobs_by_user[uid].append({"id": jid, "created_at": jat, "places": slim})

def pick_category(entries):
    """entries: list of (category, job_created_at). Mode; tie → most recent job's cat."""
    if not entries:
        return None
    # mode
    counts = Counter(c for c, _ in entries)
    best_n = max(counts.values())
    tied = {c for c, n in counts.items() if n == best_n}
    if len(tied) == 1:
        return next(iter(tied))
    # among tied, take category from most recent job that has a tied cat
    best = None
    best_at = None
    for c, at in entries:
        if c not in tied:
            continue
        if best_at is None or at > best_at:
            best_at = at
            best = c
    return best

out = []
matched_n = 0
for pid, name, uid, pat, raw in places:
    jobs = jobs_by_user.get(uid or "", [])
    # collect (cat, job_at) where name matches
    hits = []
    for j in jobs:
        for el in j["places"]:
            if el["name"] == name and el["category"] in CATS:
                hits.append((el["category"], j["created_at"], j["id"]))
    used_window = False
    if hits and pat is not None:
        near = []
        for c, jat, jid in hits:
            if jat is None:
                continue
            dt = abs((jat - pat).total_seconds())
            if dt <= WINDOW:
                near.append((c, jat, jid))
        if near:
            hits = near
            used_window = True

    if not hits:
        out.append({
            "id": pid,
            "name": name,
            "raw_category": raw,
            "matched": False,
            "used_window": False,
            "claude_category": None,
            "action": "no_match",
        })
        continue

    matched_n += 1
    entries = [(c, at) for c, at, _ in hits]
    cat = pick_category(entries)
    if cat and cat != "맛집":
        action = "update"
    else:
        action = "keep_맛집"
    out.append({
        "id": pid,
        "name": name,
        "raw_category": raw,
        "matched": True,
        "used_window": used_window,
        "claude_category": cat,
        "action": action,
    })

conn.close()
print(json.dumps({
    "total": len(places),
    "matched": matched_n,
    "decisions": out,
}, ensure_ascii=False, default=str))
`;
  return JSON.parse(runPython(code));
}

function ensureBackup(ids) {
  const dbUrlPath = resolve(ROOT, "scripts/localdata/.db_url");
  const code = `
import json
from pathlib import Path
import psycopg2
db = Path(${JSON.stringify(dbUrlPath)}).read_text().strip()
ids = json.loads(${JSON.stringify(JSON.stringify(ids))})
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
  return JSON.parse(runPython(code));
}

async function applyUpdates(admin, updates) {
  for (const u of updates) {
    const { error } = await admin
      .from("places")
      .update({ category: u.category })
      .eq("id", u.id)
      .eq("category", "맛집");
    if (error) throw error;
  }
}

async function main() {
  const { dryRun, apply } = parseArgs(process.argv.slice(2));
  console.log(
    `=== reclassify-category-stage2 start dryRun=${dryRun} apply=${apply} ===`,
  );

  const result = computeDecisions();
  const { total, matched, decisions } = result;
  const matchRate = total ? ((100 * matched) / total).toFixed(1) : "0.0";
  console.log(`targets_remaining=${total} matched=${matched} match_rate=${matchRate}%`);

  const transition = new Map();
  const updates = [];
  const reportHits = new Map(); // name -> list

  for (const d of decisions) {
    if (REPORT_NAMES.includes(d.name)) {
      if (!reportHits.has(d.name)) reportHits.set(d.name, []);
      reportHits.get(d.name).push(d);
    }
    if (d.action === "update" && d.claude_category) {
      const key = `맛집→${d.claude_category}`;
      transition.set(key, (transition.get(key) || 0) + 1);
      updates.push({ id: d.id, category: d.claude_category, name: d.name });
    }
  }

  const keep = decisions.filter((d) => d.action === "keep_맛집").length;
  const noMatch = decisions.filter((d) => d.action === "no_match").length;
  const windowed = decisions.filter((d) => d.matched && d.used_window).length;

  console.log("=== TRANSITION ===");
  for (const [k, v] of [...transition.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${k}\t${v}`);
  }
  console.log(`맛집 keep (claude=맛집 or only 맛집)\t${keep}`);
  console.log(`no_match (keep)\t${noMatch}`);
  console.log(`matched_with_10m_window\t${windowed}`);
  console.log(`update_total\t${updates.length}`);

  console.log("=== REPORT_NAMES ===");
  for (const name of REPORT_NAMES) {
    const hits = reportHits.get(name) || [];
    if (hits.length === 0) {
      console.log(`${name}\t(not in remaining target set)`);
      continue;
    }
    for (const d of hits) {
      const next =
        d.action === "update" ? d.claude_category : d.action === "keep_맛집" ? "맛집(keep)" : "no_match(keep)";
      console.log(
        `${name}\t${next}\tclaude=${d.claude_category ?? "-"}\tmatched=${d.matched}\twindow=${d.used_window}\tid=${d.id}`,
      );
    }
  }

  const cafeNames = updates.filter((u) => u.category === "카페").map((u) => u.name);
  shuffleInPlace(cafeNames);
  console.log("=== SAMPLE 맛집→카페 (30) ===");
  for (const n of cafeNames.slice(0, 30)) console.log(n);

  if (apply) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
      console.error("supabase env required for --apply");
      process.exit(1);
    }
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const backup = ensureBackup(updates.map((u) => u.id));
    console.log(`backup_table=${BACKUP_TABLE}`, backup);
    await applyUpdates(admin, updates);
    console.log(`applied=${updates.length}`);
  }

  console.log(
    "=== SUMMARY ===\n" +
      JSON.stringify(
        {
          dryRun,
          apply,
          targets_remaining: total,
          matched,
          match_rate_pct: matchRate,
          update_total: updates.length,
          transitions: Object.fromEntries(transition),
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
