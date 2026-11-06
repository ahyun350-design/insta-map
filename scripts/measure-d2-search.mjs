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

const CENTER = { lat: 37.5563, lng: 126.9236 };
const near = (lat, lng, r) => ({ lat, lng, r });
const HONGDAE_STN = near(37.5572, 126.9245, 800);
const QUERIES = [
  { q: "스타벅스", name: /스타벅스/, at: near(CENTER.lat, CENTER.lng, 1000), type: "가게(체인)" },
  { q: "스타벅스 홍대", name: /스타벅스/, at: HONGDAE_STN, type: "체인+지역" },
  { q: "이디야 강남", name: /이디야/, at: near(37.4979, 127.0276, 1000), type: "체인+지역" },
  { q: "메가커피 성수", name: /메가/, at: near(37.5446, 127.056, 1000), type: "체인+지역" },
  { q: "투썸 플레이스", name: /투썸/, at: near(CENTER.lat, CENTER.lng, 1000), type: "가게(띄어쓰기)" },
  { q: "홍대입구역", name: /홍대입구/, at: near(37.5572, 126.9245, 400), type: "역" },
  { q: "망원역", name: /망원/, at: near(37.556, 126.9101, 400), type: "역" },
  { q: "강남역", name: /강남/, at: near(37.4979, 127.0276, 400), type: "역" },
  { q: "한강진", name: /한강진/, at: near(37.5398, 127.0017, 400), type: "역" },
  { q: "경복궁", name: /경복궁/, at: near(37.5796, 126.977, 600), type: "관광지" },
  { q: "남산서울타워", name: /서울타워|남산타워/, at: near(37.5512, 126.9882, 400), type: "관광지" },
  { q: "북촌한옥마을", name: /북촌/, at: near(37.5826, 126.9836, 800), type: "관광지" },
  { q: "코엑스", name: /코엑스/, at: near(37.5118, 127.0592, 600), type: "랜드마크" },
  { q: "가로수길", name: /가로수길/, at: near(37.5205, 127.023, 800), type: "관광지" },
  { q: "연남동", name: /연남/, at: near(37.566, 126.9255, 1200), type: "동" },
  { q: "마포구", name: /마포구/, at: near(37.5638, 126.9084, 3000), type: "구" },
  { q: "망원로4길 3", addr: "망원로4길 3", type: "도로명주소" },
  { q: "세종대로 175", addr: "세종대로 175", type: "도로명주소" },
  { q: "스타벅수", name: /스타벅스/, at: near(CENTER.lat, CENTER.lng, 1000), type: "오타 1글자" },
  { q: "경복구", name: /경복궁/, at: near(37.5796, 126.977, 600), type: "오타 1글자" },
];

function distM(a, b) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const squash = (s) => String(s || "").replace(/\s+/g, "");

function judge(t, top) {
  if (!top) return false;
  if (t.addr) return squash(top.addr).includes(squash(t.addr));
  if (!t.name.test(top.name || "")) return false;
  if (!Number.isFinite(top.lat) || !Number.isFinite(top.lng)) return false;
  return distM(t.at, top) <= t.at.r;
}

async function ours(t) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/admin/map-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pindmap-e2e": E2E },
    body: JSON.stringify({ q: t.q, lat: CENTER.lat, lng: CENTER.lng, limit: 8 }),
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
