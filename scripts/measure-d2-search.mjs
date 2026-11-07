/**
 * D-2: first-result accuracy + response time, our admin search vs Kakao.
 *
 *   BASE_URL=http://127.0.0.1:3000 node scripts/measure-d2-search.mjs
 *
 * Ours  = POST {BASE_URL}/api/admin/map-search (e2e token header), first hit.
 * Kakao = the current admin expanded-map Kakao path: address search first, then
 *         keyword (destination ranking), first row.
 * Generic example queries only. Kakao rows are judged in memory and never written
 * (only correct yes/no + ms). Keys are read from .env.local and never printed.
 * Output: e2e/artifacts/d2/measure.json
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { preferAccuracySort, rankKakaoPlaceSearchResults } from "../lib/mapSearchRank.ts";
import { CENTER, QUERIES, judge } from "./d2-search-cases.mjs";

const ROOT = process.cwd();
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT = path.join(ROOT, "e2e/artifacts/d2/measure.json");

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
const KAKAO = env.KAKAO_REST_API_KEY;
const raw = (env.EXTRACT_INTERNAL_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const E2E = createHash("sha256").update(`pindmap-map-preview-e2e:v1:${raw}`).digest("hex").slice(0, 32);

async function ours(t) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/admin/map-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pindmap-e2e": E2E },
    body: JSON.stringify({ q: t.q, lat: CENTER.lat, lng: CENTER.lng, limit: 8 }),
    // limit only trims the response; the route always ranks RPC_CANDIDATES (20) rows.
  });
  const ms = performance.now() - t0;
  if (!res.ok) return { ms, top: null, n: 0, diag: { status: res.status } };
  const data = await res.json();
  const h = data.hits?.[0];
  const top = !h
    ? null
    : h.kind === "address"
      ? { addr: h.roadAddr, name: h.roadAddr }
      : { name: h.branch ? `${h.name} ${h.branch}` : h.name, addr: h.address, lat: h.lat, lng: h.lng };
  return { ms, top, n: data.hits?.length ?? 0, diag: data.diag };
}

async function kakaoGet(url) {
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO}` } });
  if (!res.ok) return [];
  return (await res.json()).documents ?? [];
}

async function kakao(t) {
  const t0 = performance.now();
  const a = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  a.searchParams.set("query", t.q);
  const addrDocs = await kakaoGet(a);
  let top = null;
  if (addrDocs[0]) {
    const d = addrDocs[0];
    top = {
      name: d.address_name,
      addr: d.road_address?.address_name || d.address_name,
      lat: parseFloat(d.y),
      lng: parseFloat(d.x),
    };
  } else {
    const k = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    k.searchParams.set("query", t.q);
    k.searchParams.set("size", "15");
    if (preferAccuracySort(t.q)) {
      k.searchParams.set("sort", "accuracy");
    } else {
      k.searchParams.set("x", String(CENTER.lng));
      k.searchParams.set("y", String(CENTER.lat));
      k.searchParams.set("sort", "distance");
    }
    const ranked = rankKakaoPlaceSearchResults(t.q, await kakaoGet(k));
    const d = ranked[0];
    if (d) {
      top = {
        name: d.place_name,
        addr: d.road_address_name || d.address_name,
        lat: parseFloat(d.y),
        lng: parseFloat(d.x),
      };
    }
  }
  return { ms: performance.now() - t0, top };
}

const rows = [];
for (const t of QUERIES) {
  const o = await ours(t);
  const k = await kakao(t);
  rows.push({
    q: t.q,
    type: t.type,
    oursOk: judge(t, o.top),
    oursTop: o.top?.name ?? null,
    oursMs: Math.round(o.ms),
    oursDbMs: o.diag?.dbMs ?? null,
    oursJusoMs: o.diag?.jusoMs ?? null,
    kakaoOk: judge(t, k.top),
    kakaoMs: Math.round(k.ms),
  });
}
const n = rows.length;
const avg = (k) => Math.round(rows.reduce((s, r) => s + (r[k] ?? 0), 0) / n);
const summary = {
  n,
  oursCorrect: rows.filter((r) => r.oursOk).length,
  kakaoCorrect: rows.filter((r) => r.kakaoOk).length,
  oursAvgMs: avg("oursMs"),
  oursAvgDbMs: Math.round(
    rows.filter((r) => r.oursDbMs != null).reduce((s, r) => s + r.oursDbMs, 0) /
      Math.max(1, rows.filter((r) => r.oursDbMs != null).length),
  ),
  kakaoAvgMs: avg("kakaoMs"),
  center: CENTER,
  base: BASE,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary));
for (const r of rows) {
  console.log(
    [r.type, r.q, r.oursOk ? "O" : "X", r.oursMs, r.kakaoOk ? "O" : "X", r.kakaoMs, r.oursTop ?? "-"].join("\t"),
  );
}
