/**
 * Name search: first-result accuracy + response time, before (ours; Kakao fill only when ours
 * < 5) → after (ours + Kakao keyword in parallel, Kakao capped at 800ms, ranked together).
 *
 *   BASE_URL=http://127.0.0.1:3000 npx tsx scripts/measure-search-merge.mts
 *
 * Cases: the 23 D-2 queries + e2e/artifacts/search-merge/local-shops.json (gitignored; shop
 * names only). Kakao rows are judged in memory and never written (counts / ms only).
 * Output: e2e/artifacts/search-merge/measure.json
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  KAKAO_FILL_BELOW,
  KAKAO_KEYWORD_TIMEOUT_MS,
  mergeOursWithKakao,
  rankMergedHits,
  toSearchRow,
  type MapKakaoSearchApiResponse,
  type MapSearchApiResponse,
  type OurHit,
} from "../lib/adminMapSearch";
import { CENTER, QUERIES, judge } from "./d2-search-cases.mjs";

const ROOT = process.cwd();
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT = path.join(ROOT, "e2e/artifacts/search-merge/measure.json");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
}
const raw = (env.EXTRACT_INTERNAL_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const E2E = createHash("sha256").update(`pindmap-map-preview-e2e:v1:${raw}`).digest("hex").slice(0, 32);

type Case = { q: string; type: string; center: { lat: number; lng: number }; judgeTop: (top: Top | null) => boolean };
type Top = { name: string; addr?: string | null; lat?: number; lng?: number };

const norm = (s: string) => s.toLowerCase().replace(/[\s()[\]·.,'"\-_/]/g, "");
const distM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  111320 * Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180));

const cases: Case[] = QUERIES.map((t: { q: string; type: string }) => ({
  q: t.q,
  type: t.type,
  center: CENTER,
  judgeTop: (top: Top | null) => judge(t, top),
}));
const localFile = path.join(ROOT, "e2e/artifacts/search-merge/local-shops.json");
if (fs.existsSync(localFile)) {
  for (const s of JSON.parse(fs.readFileSync(localFile, "utf8")) as Array<{ q: string; type: string; center: [number, number] }>) {
    const center = { lat: s.center[0], lng: s.center[1] };
    cases.push({
      q: s.q,
      type: s.type,
      center,
      judgeTop: (top) =>
        !!top &&
        Number.isFinite(top.lat) &&
        [top.name, top.name.split(/\s+/)[0] ?? ""].some((n) => norm(n) === norm(s.q)) &&
        distM(center, { lat: top.lat!, lng: top.lng! }) <= 1500,
    });
  }
}

const post = async <T,>(route: string, body: unknown): Promise<{ data: T | null; ms: number }> => {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pindmap-e2e": E2E },
      body: JSON.stringify(body),
    });
    return { data: res.ok ? ((await res.json()) as T) : null, ms: performance.now() - t0 };
  } catch {
    return { data: null, ms: performance.now() - t0 };
  }
};

const topOf = (row: ReturnType<typeof toSearchRow> | undefined): Top | null =>
  row
    ? { name: row.place_name, addr: row.road_address_name || row.address_name, lat: parseFloat(String(row.y)), lng: parseFloat(String(row.x)) }
    : null;

const rows: Array<Record<string, unknown>> = [];
for (const c of cases) {
  const body = { q: c.q, lat: c.center.lat, lng: c.center.lng, limit: 15 };
  // before: ours, then a Kakao fill only when ours < 5 (sequential)
  const oursB = await post<MapSearchApiResponse>("/api/admin/map-search", body);
  let beforeMs = oursB.ms;
  let beforeRows = (oursB.data?.hits ?? []).map(toSearchRow);
  if (beforeRows.length < KAKAO_FILL_BELOW) {
    const k = await post<MapKakaoSearchApiResponse>("/api/admin/map-kakao-search", body);
    beforeMs += k.ms;
    beforeRows = mergeOursWithKakao(beforeRows, (k.data?.hits ?? []).map(toSearchRow)) as typeof beforeRows;
  }
  // after: both in parallel; Kakao used only when back within 800ms
  const t0 = performance.now();
  const [oursA, kA] = await Promise.all([
    post<MapSearchApiResponse>("/api/admin/map-search", body),
    post<MapKakaoSearchApiResponse>("/api/admin/map-kakao-search", body),
  ]);
  const kakaoInTime = kA.ms <= KAKAO_KEYWORD_TIMEOUT_MS;
  const afterMs = Math.min(performance.now() - t0, Math.max(oursA.ms, KAKAO_KEYWORD_TIMEOUT_MS));
  const origin = oursA.data?.diag.anchor ?? c.center;
  const ranked = rankMergedHits((oursA.data?.hits ?? []) as OurHit[], kakaoInTime ? kA.data?.hits ?? [] : [], c.q, origin, 15);
  const afterTop = topOf(ranked.map(toSearchRow)[0]);
  const beforeTop = topOf(beforeRows[0]);
  rows.push({
    q: c.q,
    type: c.type,
    beforeOk: c.judgeTop(beforeTop),
    beforeTop: beforeTop?.name ?? null,
    beforeMs: Math.round(beforeMs),
    afterOk: c.judgeTop(afterTop),
    afterTop: afterTop?.name ?? null,
    afterMs: Math.round(afterMs),
    oursMs: Math.round(oursA.ms),
    dbMs: oursA.data?.diag.dbMs ?? null,
    kakaoMs: Math.round(kA.ms),
    kakaoServerMs: kA.data?.diag.ms ?? null,
    kakaoInTime,
  });
}
const avg = (k: string, list = rows) => Math.round(list.reduce((s, r) => s + Number(r[k] ?? 0), 0) / Math.max(1, list.length));
const groups = { all: rows, d2: rows.slice(0, QUERIES.length), local: rows.slice(QUERIES.length) };
const summary = Object.fromEntries(
  Object.entries(groups).map(([g, list]) => [
    g,
    {
      n: list.length,
      beforeCorrect: list.filter((r) => r.beforeOk).length,
      afterCorrect: list.filter((r) => r.afterOk).length,
      beforeAvgMs: avg("beforeMs", list),
      afterAvgMs: avg("afterMs", list),
      oursAvgMs: avg("oursMs", list),
      dbAvgMs: avg("dbMs", list),
      kakaoAvgMs: avg("kakaoMs", list),
      kakaoLate: list.filter((r) => !r.kakaoInTime).length,
    },
  ]),
);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, summary, rows }, null, 2));
console.log(JSON.stringify(summary));
for (const r of rows) {
  console.log([r.type, r.q, r.beforeOk ? "O" : "X", r.beforeTop ?? "-", `${r.beforeMs}ms`, r.afterOk ? "O" : "X", r.afterTop ?? "-", `${r.afterMs}ms`, `db ${r.dbMs}`, `kakao ${r.kakaoMs}`].join("\t"));
}
