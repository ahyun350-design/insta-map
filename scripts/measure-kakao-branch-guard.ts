/**
 * Dry-run regression measure for kakaoBranchTagAcceptable.
 * Does NOT write DB. Does NOT persist Kakao responses (memory → counts only).
 *
 *   npx tsx scripts/measure-kakao-branch-guard.ts
 *   SAMPLE=500 DELAY_MS=200 npx tsx scripts/measure-kakao-branch-guard.ts
 *   SAMPLE=0  → all branch-like rows (~2520)
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  extractBranchTags,
  kakaoBranchTagAcceptable,
  kakaoPlaceNameMatchesBranch,
} from "../lib/extractPlaceFilters";
import { buildKakaoQueryFallbacks } from "../app/api/extract/_shared";

function findRoot(): string {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    process.cwd(),
  ];
  for (const c of candidates) {
    try {
      readFileSync(resolve(c, ".env.local"), "utf8");
      return c;
    } catch {
      /* next */
    }
  }
  return process.cwd();
}

const root = findRoot();

function loadEnvLocal() {
  const p = resolve(root, ".env.local");
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2]!;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]!]) process.env[m[1]!] = v;
  }
}

loadEnvLocal();

const SAMPLE = Number(process.env.SAMPLE ?? "500");
const DELAY_MS = Number(process.env.DELAY_MS ?? "200");

type Bucket =
  | "accept_same_branch"
  | "reject_other_branch"
  | "reject_no_branch"
  | "no_result";

const INDUSTRY_TOKEN =
  "음식점|휴게음식점|제과점|판매점|대리점|가맹점|영업점|매점|상점|할인점|편의점|백화점|전문점|출장점|지점|본점|양과점|주점|호프점|분식점|중식점|일식점|한식점|횟집점";

/** Same population as prior SQL (~2,520): branch-like last token. */
function fetchBranchLikeNames(): string[] {
  const py = resolve(root, "scripts/localdata/.venv/bin/python");
  const dbUrlPath = resolve(root, "scripts/localdata/.db_url");
  const code = `
import json, psycopg2
from pathlib import Path
db = Path(${JSON.stringify(dbUrlPath)}).read_text().strip()
conn = psycopg2.connect(db)
cur = conn.cursor()
INDUSTRY = ${JSON.stringify(INDUSTRY_TOKEN)}
cur.execute(f"""
WITH parsed AS (
  SELECT
    name,
    (regexp_split_to_array(btrim(name), '[[:space:]]+'))[
      array_length(regexp_split_to_array(btrim(name), '[[:space:]]+'), 1)
    ] AS last_token
  FROM public.places
  WHERE name IS NOT NULL AND btrim(name) <> ''
),
branch AS (
  SELECT name, last_token,
    CASE
      WHEN last_token ~ '본점$'
           AND length(regexp_replace(last_token, '본점$', '')) >= 2
           AND last_token !~ '^{INDUSTRY}$'
        THEN true
      WHEN last_token ~ '점$'
           AND length(regexp_replace(last_token, '점$', '')) >= 2
           AND last_token !~ '^{INDUSTRY}$'
        THEN true
      ELSE false
    END AS ok
  FROM parsed
)
SELECT name FROM branch WHERE ok ORDER BY name
""")
rows = [r[0] for r in cur.fetchall()]
conn.close()
print(json.dumps(rows, ensure_ascii=False))
`;
  const r = spawnSync(py, ["-c", code], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    cwd: root,
  });
  if (r.status !== 0) {
    throw new Error(`fetch names failed: ${r.stderr || r.stdout}`);
  }
  const names = JSON.parse(r.stdout.trim()) as string[];
  if (!Array.isArray(names)) throw new Error("bad name list");
  return names;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type QuietDoc = { placeName: string; address: string };

type QuietLookup = { docs: QuietDoc[] } | null;

let httpCalls = 0;

const BRANCH_SCAN_LIMIT = 5;

async function searchKakaoQuiet(name: string): Promise<QuietLookup> {
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) throw new Error("missing KAKAO_REST_API_KEY");

  const trimmed = name.trim();
  if (!trimmed) return null;

  type Doc = {
    place_name?: string;
    address_name?: string;
    road_address_name?: string;
  };

  const fetchDocuments = async (query: string): Promise<Doc[] | null> => {
    httpCalls += 1;
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=15`,
      { headers: { Authorization: `KakaoAK ${kakaoKey}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { documents?: Doc[] };
    return data.documents ?? [];
  };

  const queries = buildKakaoQueryFallbacks(trimmed);
  for (const item of queries) {
    const raw = await fetchDocuments(item.query);
    if (raw == null) continue;
    if (raw.length === 0) continue;
    // Memory only — map top docs then discard raw response.
    const docs: QuietDoc[] = raw.slice(0, BRANCH_SCAN_LIMIT).map((d) => ({
      placeName: (d.place_name || "").trim(),
      address: (d.road_address_name || d.address_name || "").trim(),
    }));
    if (!docs[0]?.placeName) return null;
    return { docs };
  }
  return null;
}

function classify(
  extracted: string,
  kakaoPlaceName: string | null,
  kakaoAddress: string,
): Bucket {
  if (!kakaoPlaceName) return "no_result";
  if (kakaoBranchTagAcceptable(extracted, kakaoPlaceName, kakaoAddress)) {
    return "accept_same_branch";
  }
  const kakaoTags = extractBranchTags(kakaoPlaceName);
  if (kakaoTags.length > 0) return "reject_other_branch";
  return "reject_no_branch";
}

function pickDocFirst(docs: QuietDoc[]): QuietDoc | null {
  return docs[0] ?? null;
}

function pickDocBranch(extracted: string, docs: QuietDoc[]): QuietDoc | null {
  const hit = docs.find((d) =>
    kakaoPlaceNameMatchesBranch(extracted, d.placeName),
  );
  return hit ?? docs[0] ?? null;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = arr.slice();
  shuffleInPlace(copy);
  return copy.slice(0, Math.min(n, copy.length));
}

function emptyCounts(): Record<Bucket, number> {
  return {
    accept_same_branch: 0,
    reject_other_branch: 0,
    reject_no_branch: 0,
    no_result: 0,
  };
}

async function main() {
  console.log("measure-kakao-branch-guard|start|fetching branch-like names…");
  const all = fetchBranchLikeNames();
  console.log(`measure-kakao-branch-guard|population=${all.length}`);

  const work =
    SAMPLE > 0 && SAMPLE < all.length
      ? (() => {
          const copy = all.slice();
          shuffleInPlace(copy);
          return copy.slice(0, SAMPLE);
        })()
      : all.slice();

  const isSample = work.length < all.length;
  console.log(
    `measure-kakao-branch-guard|work=${work.length}|sample=${isSample}|delayMs=${DELAY_MS}`,
  );

  /** docs[0] only — 보강1 (접미어 제외) 효과 */
  const countsFirst = emptyCounts();
  /** top-5 branch pick — 보강1+2 */
  const countsBranch = emptyCounts();
  const rejectNoBranchNames: string[] = [];
  let branchPickLifted = 0;

  for (let i = 0; i < work.length; i++) {
    const name = work[i]!;
    const lookup = await searchKakaoQuiet(name);
    const docs = lookup?.docs ?? [];

    const first = pickDocFirst(docs);
    const branched = pickDocBranch(name, docs);

    const b0 = classify(name, first?.placeName ?? null, first?.address ?? "");
    const b1 = classify(
      name,
      branched?.placeName ?? null,
      branched?.address ?? "",
    );
    countsFirst[b0] += 1;
    countsBranch[b1] += 1;
    if (
      b0 !== "accept_same_branch" &&
      b1 === "accept_same_branch" &&
      first &&
      branched &&
      first.placeName !== branched.placeName
    ) {
      branchPickLifted += 1;
    }
    if (b1 === "reject_no_branch") rejectNoBranchNames.push(name);

    if ((i + 1) % 50 === 0 || i + 1 === work.length) {
      console.log(
        `measure-kakao-branch-guard|progress=${i + 1}/${work.length}|http=${httpCalls}|` +
          `first_accept=${countsFirst.accept_same_branch}|first_other=${countsFirst.reject_other_branch}|` +
          `branch_accept=${countsBranch.accept_same_branch}|branch_other=${countsBranch.reject_other_branch}`,
      );
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  const n = work.length || 1;
  const pct = (c: number) => ((100 * c) / n).toFixed(1);
  const pack = (counts: Record<Bucket, number>) => ({
    counts,
    ratios_pct: {
      accept_same_branch: pct(counts.accept_same_branch),
      reject_other_branch: pct(counts.reject_other_branch),
      reject_no_branch: pct(counts.reject_no_branch),
      no_result: pct(counts.no_result),
    },
  });

  const acceptFirst = countsFirst.accept_same_branch / n;
  const acceptBranch = countsBranch.accept_same_branch / n;
  const acceptLiftPp = (acceptBranch - acceptFirst) * 100;

  console.log("=== RESULT (보강1 only: docs[0]) ===");
  console.log(JSON.stringify({ population: all.length, measured: work.length, sample: isSample, ...pack(countsFirst) }, null, 2));
  console.log("=== RESULT (보강1+2: top-5 branch pick) ===");
  console.log(
    JSON.stringify(
      {
        population: all.length,
        measured: work.length,
        sample: isSample,
        http_calls: httpCalls,
        branch_pick_lifted_rows: branchPickLifted,
        accept_lift_pp: Number(acceptLiftPp.toFixed(2)),
        ...pack(countsBranch),
      },
      null,
      2,
    ),
  );

  const samples = pickRandom(rejectNoBranchNames, 10);
  console.log("=== reject_no_branch sample names (max 10, branch-pick path) ===");
  for (const s of samples) console.log(s);

  const rnb = countsBranch.reject_no_branch / n;
  let decision: string;
  if (rnb < 0.05) decision = "KEEP_CURRENT_GUARD";
  else if (rnb <= 0.2) decision = "SOFTEN_GUARD";
  else decision = "REVERT_GUARD_OVERSEAS_ONLY";
  console.log(`=== DECISION ===\n${decision}|reject_no_branch_ratio=${(rnb * 100).toFixed(2)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
