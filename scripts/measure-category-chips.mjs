/**
 * Category chips: result count + response time through POST /api/admin/map-category
 * (live Kakao call per request). Counts / ms only — Kakao rows are never written.
 *
 *   BASE_URL=http://127.0.0.1:3000 node scripts/measure-category-chips.mjs
 *
 * Output: e2e/artifacts/category/measure.json
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT = path.join(ROOT, "e2e/artifacts/category/measure.json");

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const raw = (env.EXTRACT_INTERNAL_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const E2E = createHash("sha256").update(`pindmap-map-preview-e2e:v1:${raw}`).digest("hex").slice(0, 32);

const AREAS = {
  홍대: { lat: 37.5563, lng: 126.9236 },
  강남: { lat: 37.4979, lng: 127.0276 },
  망원: { lat: 37.556, lng: 126.9101 },
  "강릉 중앙시장": { lat: 37.7546, lng: 128.8962 },
};
const CHIPS = { cafe: "카페", convenience: "편의점", pharmacy: "약국" };
// Phone viewport at z16 (~370m × 800m): small enough for the visible-map rect.
const HALF = { lat: 0.0036, lng: 0.0021 };

const rows = [];
for (const [area, c] of Object.entries(AREAS)) {
  for (const [chip, label] of Object.entries(CHIPS)) for (const view of ["z16", "wide"]) {
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/admin/map-category`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pindmap-e2e": E2E },
      body: JSON.stringify({
        chip,
        lat: c.lat,
        lng: c.lng,
        ...(view === "z16"
          ? {
              sw: { lat: c.lat - HALF.lat, lng: c.lng - HALF.lng },
              ne: { lat: c.lat + HALF.lat, lng: c.lng + HALF.lng },
            }
          : {}),
        sort: "distance",
      }),
    });
    const ms = Math.round(performance.now() - t0);
    const data = res.ok ? await res.json() : { docs: [], diag: { error: `http_${res.status}` } };
    const docs = data.docs ?? [];
    const far = docs.reduce((m, d) => Math.max(m, Number(d.distance) || 0), 0);
    rows.push({ area, chip: label, view, n: docs.length, ms, kakaoMs: data.diag?.ms ?? null, area_mode: data.diag?.area ?? null, farthest_m: far, error: data.diag?.error ?? null });
  }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, rows }, null, 2));
for (const r of rows) console.log([r.area, r.chip, r.view, `${r.n}개`, `${r.ms}ms`, `kakao ${r.kakaoMs}ms`, r.area_mode, `≤${r.farthest_m}m`, r.error ?? ""].join("\t"));
