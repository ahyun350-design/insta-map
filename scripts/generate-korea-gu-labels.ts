/**
 * Read-only: median lat/lng per 구·군 from poi addresses → lib/koreaGuLabels.ts
 *
 *   npx tsx scripts/generate-korea-gu-labels.ts
 *
 * Uses scripts/localdata/.venv + psycopg2 (same as other localdata scripts).
 * Never prints connection strings or secrets.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { SEOUL_GU_LABELS } from "../lib/seoulGuLabels";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "lib/koreaGuLabels.ts");
const PY = path.join(ROOT, "scripts/localdata/.venv/bin/python");

const SHORT_CITY: Record<string, string> = {
  서울특별시: "서울",
  부산광역시: "부산",
  대구광역시: "대구",
  인천광역시: "인천",
  광주광역시: "광주",
  대전광역시: "대전",
  울산광역시: "울산",
  세종특별자치시: "세종",
  "경기도 수원시": "수원",
  "경기도 성남시": "성남",
  "경기도 용인시": "용인",
  "경기도 고양시": "고양",
  "경기도 안양시": "안양",
  "경기도 안산시": "안산",
  "경기도 부천시": "부천",
  "충청북도 청주시": "청주",
  "충청남도 천안시": "천안",
  "전북특별자치도 전주시": "전주",
  "전라북도 전주시": "전주",
  "경상북도 포항시": "포항",
  "경상남도 창원시": "창원",
};

type Row = { city_key: string; gu: string; lng: number; lat: number; n: number };

function loadRows(): Row[] {
  const dbUrl = fs.readFileSync(path.join(ROOT, "scripts/localdata/.db_url"), "utf8").trim();
  const code = `
import json, psycopg2
conn = psycopg2.connect(${JSON.stringify(dbUrl)})
cur = conn.cursor()
cur.execute("""
WITH addr AS (
  SELECT
    lat::float8 AS lat,
    lng::float8 AS lng,
    COALESCE(NULLIF(TRIM(road_address), ''), NULLIF(TRIM(jibun_address), '')) AS address
  FROM poi
  WHERE lat IS NOT NULL
    AND lng IS NOT NULL
    AND lat BETWEEN 33 AND 39.5
    AND lng BETWEEN 124 AND 132
),
tagged AS (
  SELECT
    lat,
    lng,
    address,
    CASE
      WHEN address LIKE '서울특별시%' THEN '서울특별시'
      WHEN address LIKE '부산광역시%' THEN '부산광역시'
      WHEN address LIKE '대구광역시%' THEN '대구광역시'
      WHEN address LIKE '인천광역시%' THEN '인천광역시'
      WHEN address LIKE '광주광역시%' THEN '광주광역시'
      WHEN address LIKE '대전광역시%' THEN '대전광역시'
      WHEN address LIKE '울산광역시%' THEN '울산광역시'
      WHEN address LIKE '세종특별자치시%' THEN '세종특별자치시'
      WHEN address LIKE '경기도 수원시%' THEN '경기도 수원시'
      WHEN address LIKE '경기도 성남시%' THEN '경기도 성남시'
      WHEN address LIKE '경기도 용인시%' THEN '경기도 용인시'
      WHEN address LIKE '경기도 고양시%' THEN '경기도 고양시'
      WHEN address LIKE '경기도 안양시%' THEN '경기도 안양시'
      WHEN address LIKE '경기도 안산시%' THEN '경기도 안산시'
      WHEN address LIKE '경기도 부천시%' THEN '경기도 부천시'
      WHEN address LIKE '충청북도 청주시%' THEN '충청북도 청주시'
      WHEN address LIKE '충청남도 천안시%' THEN '충청남도 천안시'
      WHEN address LIKE '전북특별자치도 전주시%' THEN '전북특별자치도 전주시'
      WHEN address LIKE '전라북도 전주시%' THEN '전라북도 전주시'
      WHEN address LIKE '경상북도 포항시%' THEN '경상북도 포항시'
      WHEN address LIKE '경상남도 창원시%' THEN '경상남도 창원시'
      ELSE NULL
    END AS city_key,
    (regexp_match(
      address,
      '(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도 수원시|경기도 성남시|경기도 용인시|경기도 고양시|경기도 안양시|경기도 안산시|경기도 부천시|충청북도 청주시|충청남도 천안시|전북특별자치도 전주시|전라북도 전주시|경상북도 포항시|경상남도 창원시)\\\\s+([가-힣]+[구군])'
    ))[2] AS gu
  FROM addr
  WHERE address IS NOT NULL
)
SELECT
  city_key,
  gu,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY lng) AS lng,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY lat) AS lat,
  COUNT(*)::int AS n
FROM tagged
WHERE city_key IS NOT NULL
  AND gu IS NOT NULL
  AND (
    city_key IN (
      '서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시'
    )
    OR (
      city_key IN (
        '경기도 수원시','경기도 성남시','경기도 용인시','경기도 고양시','경기도 안양시','경기도 안산시','경기도 부천시',
        '충청북도 청주시','충청남도 천안시','전북특별자치도 전주시','전라북도 전주시','경상북도 포항시','경상남도 창원시'
      )
      AND gu LIKE '%구'
    )
  )
GROUP BY city_key, gu
HAVING COUNT(*) >= 20
ORDER BY city_key, gu
""");
out=[]
for r in cur.fetchall():
  out.append({
    "city_key": r[0],
    "gu": r[1],
    "lng": float(r[2]),
    "lat": float(r[3]),
    "n": int(r[4]),
  })
print(json.dumps(out, ensure_ascii=False))
conn.close()
`;
  const r = spawnSync(PY, ["-c", code], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    cwd: ROOT,
  });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "python fail").slice(0, 500));
  }
  return JSON.parse(r.stdout.trim()) as Row[];
}

function main() {
  const rows = loadRows();
  console.log(`[korea-gu] query rows=${rows.length}`);

  const byGu = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byGu.get(row.gu) ?? [];
    list.push(row);
    byGu.set(row.gu, list);
  }

  const seoulByName = new Map(SEOUL_GU_LABELS.map((g) => [g.name, g]));
  const out: { name: string; lng: number; lat: number; city: string }[] = [];

  for (const row of rows) {
    const short = SHORT_CITY[row.city_key] ?? row.city_key;
    const ambiguous = (byGu.get(row.gu)?.length ?? 0) > 1;

    if (row.city_key === "서울특별시") {
      const fixed = seoulByName.get(row.gu);
      if (fixed) {
        out.push({ name: row.gu, lng: fixed.lng, lat: fixed.lat, city: "서울" });
        continue;
      }
    }

    out.push({
      name: ambiguous ? `${short} ${row.gu}` : row.gu,
      lng: Number(row.lng.toFixed(4)),
      lat: Number(row.lat.toFixed(4)),
      city: short,
    });
  }

  for (const g of SEOUL_GU_LABELS) {
    if (!out.some((x) => x.city === "서울" && x.name === g.name)) {
      out.push({ name: g.name, lng: g.lng, lat: g.lat, city: "서울" });
    }
  }

  out.sort(
    (a, b) => a.city.localeCompare(b.city, "ko") || a.name.localeCompare(b.name, "ko"),
  );

  const body = `/**
 * Nationwide 구·군 label anchors for MapLibre z9–13 overlay.
 * Generated by scripts/generate-korea-gu-labels.ts (poi median coords).
 * Seoul 25: preserved from lib/seoulGuLabels.ts.
 * Do not edit by hand — re-run the script instead.
 */

export type KoreaGuLabel = {
  name: string;
  lng: number;
  lat: number;
  city: string;
};

export const KOREA_GU_LABELS: readonly KoreaGuLabel[] = ${JSON.stringify(out, null, 2)} as const;

export function koreaGuLabelsGeoJson() {
  return {
    type: "FeatureCollection" as const,
    features: KOREA_GU_LABELS.map((g) => ({
      type: "Feature" as const,
      properties: { name: g.name, city: g.city },
      geometry: {
        type: "Point" as const,
        coordinates: [g.lng, g.lat],
      },
    })),
  };
}
`;

  fs.writeFileSync(OUT, body, "utf8");
  console.log(`[korea-gu] wrote ${out.length} labels → lib/koreaGuLabels.ts`);
}

main();
