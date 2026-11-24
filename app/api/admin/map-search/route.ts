/**
 * Admin expanded MapLibre search (D-2): our data only.
 * - search_map_admin RPC (sangga_places + map_search_catalog; service role only)
 * - 도로명·지번 주소: juso first; if empty, Kakao address search (live display only — never stored).
 *   No coordinates from juso — the client geocodes a tapped address via /api/admin/map-geocode.
 * Kakao keyword results are merged on the client, never here. Nothing is stored.
 */
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminRouteGate";
import {
  QUERY_MAX_LEN,
  RPC_CANDIDATES,
  chainAliasQuery,
  collapseSamePlaces,
  kakaoAddressDocToHit,
  looksLikeAddressQuery,
  rerankPlaceHits,
  unionPlaceHits,
  type MapSearchApiResponse,
  type OurAddressHit,
  type OurPlaceHit,
  type OurSource,
} from "@/lib/adminMapSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JUSO_TIMEOUT_MS = 2500;
const JUSO_COUNT = 5;
const KAKAO_ADDR_TIMEOUT_MS = 2500;
const KAKAO_ADDR_COUNT = 5;
const SOURCES: readonly OurSource[] = ["sangga", "tour", "landmark", "station", "dong", "gu", "si"];

type Body = { q?: unknown; lat?: unknown; lng?: unknown; limit?: unknown };

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

type StationLines = { lines: string[]; colour: string | null };
let stationLinesCache: Map<number, StationLines> | null = null;

/** catalog id "station:<i>" = feature index in public/map/korea-station-labels.geojson */
function stationLines(): Map<number, StationLines> {
  if (stationLinesCache) return stationLinesCache;
  const out = new Map<number, StationLines>();
  try {
    const file = path.join(process.cwd(), "public", "map", "korea-station-labels.geojson");
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
      features?: Array<{ properties?: { refs?: unknown; colour?: unknown } }>;
    };
    (data.features ?? []).forEach((f, i) => {
      const refs = Array.isArray(f.properties?.refs) ? f.properties!.refs.map(String) : [];
      const colour = typeof f.properties?.colour === "string" ? f.properties.colour : null;
      out.set(i, { lines: refs, colour });
    });
  } catch {
    /* lines are cosmetic */
  }
  stationLinesCache = out;
  return out;
}

function toPlaceHit(r: RpcRow): OurPlaceHit | null {
  const source = SOURCES.find((s) => s === r.source);
  if (!source || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return null;
  const hit: OurPlaceHit = {
    kind: "place",
    id: r.id,
    source,
    name: r.name,
    branch: r.branch || null,
    category: r.category || null,
    address: r.address || null,
    floor: r.floor || null,
    lat: r.lat,
    lng: r.lng,
    distM: Number.isFinite(r.dist_m) ? Math.round(r.dist_m as number) : null,
    score: Math.round(r.score * 10) / 10,
  };
  if (source === "station") {
    const idx = Number(r.id.split(":")[1]);
    const line = stationLines().get(idx);
    if (line) {
      hit.lines = line.lines;
      hit.lineColour = line.colour;
    }
  }
  return hit;
}

/** juso rejects these characters / words in keyword. */
function jusoKeyword(q: string): string {
  return q
    .replace(/[%=><[\]]/g, " ")
    .replace(/\b(OR|SELECT|INSERT|DELETE|UPDATE|CREATE|DROP|EXEC|UNION|FETCH|DECLARE|TRUNCATE)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function jusoSearch(q: string): Promise<{ hits: OurAddressHit[]; error: string | null }> {
  const key = process.env.JUSO_API_KEY?.trim();
  if (!key) return { hits: [], error: "no_key" };
  const keyword = jusoKeyword(q);
  if (keyword.length < 2) return { hits: [], error: null };
  const url = new URL("https://business.juso.go.kr/addrlink/addrLinkApi.do");
  url.searchParams.set("confmKey", key);
  url.searchParams.set("currentPage", "1");
  url.searchParams.set("countPerPage", String(JUSO_COUNT));
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("resultType", "json");
  try {
    const res = await fetch(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(JUSO_TIMEOUT_MS) });
    if (!res.ok) return { hits: [], error: `http_${res.status}` };
    const data = (await res.json()) as {
      results?: {
        common?: { errorCode?: string };
        juso?: Array<{ roadAddrPart1?: string; jibunAddr?: string; bdNm?: string; bdMgtSn?: string }> | null;
      };
    };
    const code = data.results?.common?.errorCode ?? "";
    if (code !== "0") return { hits: [], error: `juso_${code || "unknown"}` };
    const hits = (data.results?.juso ?? [])
      .filter((j) => j.roadAddrPart1)
      .map((j, i) => ({
        kind: "address" as const,
        id: `juso:${j.bdMgtSn || i}`,
        roadAddr: j.roadAddrPart1!,
        jibunAddr: j.jibunAddr || null,
        buildingName: j.bdNm || null,
      }));
    return { hits, error: null };
  } catch {
    return { hits: [], error: "fetch_failed" };
  }
}

/** Live Kakao address search — display only, never stored / cached. */
async function kakaoAddressSearch(q: string): Promise<{ hits: OurAddressHit[]; error: string | null }> {
  const restKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!restKey) return { hits: [], error: "no_key" };
  const keyword = q.trim();
  if (keyword.length < 2) return { hits: [], error: null };
  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  url.searchParams.set("query", keyword);
  url.searchParams.set("size", String(KAKAO_ADDR_COUNT));
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${restKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(KAKAO_ADDR_TIMEOUT_MS),
    });
    if (!res.ok) return { hits: [], error: `http_${res.status}` };
    const data = (await res.json()) as {
      documents?: Array<{
        address_name?: string;
        address?: { address_name?: string } | null;
        road_address?: { address_name?: string; building_name?: string } | null;
        x?: string;
        y?: string;
      }>;
    };
    const hits = (data.documents ?? [])
      .map((d, i) => kakaoAddressDocToHit(d, i))
      .filter((h): h is OurAddressHit => h != null);
    return { hits, error: null };
  } catch {
    return { hits: [], error: "fetch_failed" };
  }
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const q = typeof body.q === "string" ? body.q.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX_LEN) : "";
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const limit = Math.max(1, Math.min(20, Number(body.limit) || 8));
  if (q.length < 2) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  const hasCenter = Number.isFinite(lat) && Number.isFinite(lng);

  const t0 = Date.now();
  const admin = getSupabaseAdmin();
  const rpc = (p_q: string) => {
    const start = Date.now();
    return admin
      .rpc("search_map_admin", {
        p_q,
        p_lat: hasCenter ? lat : null,
        p_lng: hasCenter ? lng : null,
        p_limit: RPC_CANDIDATES,
      })
      .then((r) => ({ ...r, ms: Date.now() - start }));
  };
  // Chain alias ("메가커피" → registered "메가엠지씨커피"): at most one extra RPC.
  const aliasQ = chainAliasQuery(q);
  const wantAddress = looksLikeAddressQuery(q);
  const jusoStart = Date.now();
  const jusoPromise = wantAddress
    ? jusoSearch(q).then((r) => ({ ...r, ms: Date.now() - jusoStart }))
    : Promise.resolve(null);

  const [db, dbAlias, juso, anchor] = await Promise.all([
    rpc(q),
    aliasQ ? rpc(aliasQ) : Promise.resolve(null),
    jusoPromise,
    areaAnchor(admin, q, hasCenter ? { lat, lng } : null),
  ]);
  const toHits = (r: { data: unknown; error: unknown } | null) =>
    !r || r.error
      ? []
      : ((r.data ?? []) as RpcRow[]).map(toPlaceHit).filter((h): h is OurPlaceHit => h != null);
  const places = collapseSamePlaces(rerankPlaceHits(unionPlaceHits(toHits(db), toHits(dbAlias)), q));
  let addresses = juso?.hits ?? [];
  let jusoError = juso?.error ?? null;
  let jusoMs = juso ? juso.ms : null;
  // juso empty/unavailable → Kakao address (live only). Same gate as juso (road + jibun).
  if (wantAddress && addresses.length === 0) {
    const kakaoStart = Date.now();
    const kakao = await kakaoAddressSearch(q);
    addresses = kakao.hits;
    jusoMs = (jusoMs ?? 0) + (Date.now() - kakaoStart);
    if (kakao.error) jusoError = jusoError ? `${jusoError}|kakao_${kakao.error}` : `kakao_${kakao.error}`;
  }
  // Address-looking queries: the address rows lead; place rows follow.
  const hits = [...addresses, ...places].slice(0, Math.max(limit, addresses.length));

  const payload: MapSearchApiResponse = {
    hits,
    diag: {
      ms: Date.now() - t0,
      dbMs: Math.max(db.ms, dbAlias?.ms ?? 0),
      jusoMs,
      dbError: db.error ? "rpc_failed" : null,
      jusoError,
      anchor,
    },
  };
  return NextResponse.json(payload);
}

/**
 * "이디야 강남": the 역·동·구·시 the last word names — same pick as search_map_admin's area token
 * (exact name, then "…동", then nearest). Small catalog table, name_norm prefix only.
 */
async function areaAnchor(
  admin: ReturnType<typeof getSupabaseAdmin>,
  q: string,
  center: { lat: number; lng: number } | null,
): Promise<{ lat: number; lng: number } | null> {
  const words = q.split(" ");
  if (words.length < 2) return null;
  let tok = words[words.length - 1]!.toLowerCase().replace(/[\s·.,'"\-_/()]+/g, "");
  if (/역$/.test(tok) && tok.length > 2) tok = tok.slice(0, -1);
  if (tok.length < 2 || /[%_\\]/.test(tok)) return null;
  const { data, error } = await admin
    .from("map_search_catalog")
    .select("name_norm, lat, lng")
    .in("source", ["station", "dong", "gu", "si"])
    .like("name_norm", `${tok}%`)
    .limit(20);
  if (error || !data?.length) return null;
  const rows = (data as Array<{ name_norm: string; lat: number; lng: number }>).filter(
    (r) => r.name_norm.length <= tok.length + 2,
  );
  const near = (r: { lat: number; lng: number }) =>
    center ? Math.abs(r.lat - center.lat) + Math.abs(r.lng - center.lng) : 0;
  rows.sort(
    (a, b) =>
      Number(b.name_norm === tok) - Number(a.name_norm === tok) ||
      Number(b.name_norm === `${tok}동`) - Number(a.name_norm === `${tok}동`) ||
      near(a) - near(b),
  );
  const top = rows[0];
  return top && Number.isFinite(top.lat) && Number.isFinite(top.lng) ? { lat: top.lat, lng: top.lng } : null;
}
