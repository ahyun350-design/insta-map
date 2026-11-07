/**
 * D-2 tune: first-result accuracy before → after, without a second server.
 *
 *   npx tsx scripts/measure-d2-tune.mts [baseRef=main]
 *
 * Same pipeline as POST /api/admin/map-search: search_map_admin RPC (+ chain-alias RPC),
 * unionPlaceHits → rerankPlaceHits → collapseSamePlaces, 도로명주소 rows first. The RPC
 * rows are fetched once per query string and fed to both lib versions:
 *   before = lib/adminMapSearch.ts at baseRef, after = working tree.
 * Keys come from .env.local and are never printed. Output: e2e/artifacts/d2/measure-tune.json
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "../e2e/helpers/env";
import { CENTER, QUERIES, judge } from "./d2-search-cases.mjs";

type Lib = typeof import("../lib/adminMapSearch");
type Hit = import("../lib/adminMapSearch").OurPlaceHit;
type RpcRow = {
  id: string;
  name: string;
  branch: string | null;
  category: string | null;
  address: string | null;
  floor: string | null;
  lat: number;
  lng: number;
  dist_m: number | null;
  score: number;
  source: string;
};

const ROOT = process.cwd();
const BASE_REF = process.argv[2] || "main";
const OUT = path.join(ROOT, "e2e/artifacts/d2/measure-tune.json");
const SOURCES = ["sangga", "tour", "landmark", "station", "dong", "gu", "si"];

loadEnvLocal();
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Inside the repo so "@/..." imports resolve; removed right after import (tsconfig globs **/*.ts).
const beforeRoot = path.join(ROOT, "e2e/artifacts/d2/before-lib");
fs.mkdirSync(path.join(beforeRoot, "lib"), { recursive: true });
const beforeFile = path.join(beforeRoot, "lib/adminMapSearch.ts");
fs.writeFileSync(beforeFile, execFileSync("git", ["show", `${BASE_REF}:lib/adminMapSearch.ts`], { encoding: "utf8" }));
const before: Lib = await import(pathToFileURL(beforeFile).href);
fs.rmSync(beforeRoot, { recursive: true, force: true });
const after: Lib = await import(pathToFileURL(path.join(ROOT, "lib/adminMapSearch.ts")).href);

const rpcCache = new Map<string, Promise<Hit[]>>();
function rpc(q: string): Promise<Hit[]> {
  if (!rpcCache.has(q)) {
    rpcCache.set(
      q,
      Promise.resolve(
        admin.rpc("search_map_admin", { p_q: q, p_lat: CENTER.lat, p_lng: CENTER.lng, p_limit: after.RPC_CANDIDATES }),
      ).then(({ data, error }) => {
        if (error) throw new Error(`rpc_failed for a query (${error.code ?? "?"})`);
        return ((data ?? []) as RpcRow[])
          .filter((r) => SOURCES.includes(r.source) && Number.isFinite(r.lat) && Number.isFinite(r.lng))
          .map((r) => ({
            kind: "place" as const,
            id: r.id,
            source: r.source as Hit["source"],
            name: r.name,
            branch: r.branch || null,
            category: r.category || null,
            address: r.address || null,
            floor: r.floor || null,
            lat: r.lat,
            lng: r.lng,
            distM: Number.isFinite(r.dist_m) ? Math.round(r.dist_m as number) : null,
            score: Math.round(r.score * 10) / 10,
          }));
      }),
    );
  }
  return rpcCache.get(q)!;
}

async function jusoFirst(q: string): Promise<string | null> {
  const key = process.env.JUSO_API_KEY?.trim();
  if (!key) return null;
  const url = new URL("https://business.juso.go.kr/addrlink/addrLinkApi.do");
  url.searchParams.set("confmKey", key);
  url.searchParams.set("currentPage", "1");
  url.searchParams.set("countPerPage", "5");
  url.searchParams.set("keyword", q);
  url.searchParams.set("resultType", "json");
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const data = (await res.json()) as { results?: { juso?: Array<{ roadAddrPart1?: string }> | null } };
  return data.results?.juso?.find((j) => j.roadAddrPart1)?.roadAddrPart1 ?? null;
}

async function top(lib: Lib, q: string) {
  if (lib.looksLikeRoadAddress(q)) {
    const addr = await jusoFirst(q);
    if (addr) return { name: addr, addr };
  }
  const aliasQ = lib.chainAliasQuery(q);
  const lists = [await rpc(q), ...(aliasQ ? [await rpc(aliasQ)] : [])];
  const h = lib.collapseSamePlaces(lib.rerankPlaceHits(lib.unionPlaceHits(...lists), q))[0];
  return h ? { name: lib.placeDisplayName(h), addr: h.address, lat: h.lat, lng: h.lng, source: h.source } : null;
}

const rows = [];
for (const t of QUERIES) {
  const b = await top(before, t.q);
  const a = await top(after, t.q);
  rows.push({
    q: t.q,
    type: t.type,
    beforeOk: judge(t, b),
    beforeTop: b?.name ?? null,
    afterOk: judge(t, a),
    afterTop: a?.name ?? null,
  });
}
const summary = {
  n: rows.length,
  beforeCorrect: rows.filter((r) => r.beforeOk).length,
  afterCorrect: rows.filter((r) => r.afterOk).length,
  baseRef: BASE_REF,
  center: CENTER,
};
fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary));
for (const r of rows) {
  console.log([r.type, r.q, r.beforeOk ? "O" : "X", r.beforeTop ?? "-", r.afterOk ? "O" : "X", r.afterTop ?? "-"].join("\t"));
}
