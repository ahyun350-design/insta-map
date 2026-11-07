/**
 * Admin expanded MapLibre name search — Kakao keyword half (runs beside /api/admin/map-search).
 * Live call per request, capped at 800ms; results pass through for display only: no server or
 * memory cache, nothing stored or logged (Kakao terms).
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminRouteGate";
import {
  KAKAO_KEYWORD_TIMEOUT_MS,
  QUERY_MAX_LEN,
  kakaoDocToHit,
  type KakaoKeywordHit,
  type MapKakaoSearchApiResponse,
} from "@/lib/adminMapSearch";
import { preferAccuracySort } from "@/lib/mapSearchRank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KAKAO_SIZE = 15;

type Body = { q?: unknown; lat?: unknown; lng?: unknown };

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
  if (q.length < 2) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  const key = process.env.KAKAO_REST_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", q);
  url.searchParams.set("size", String(KAKAO_SIZE));
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url.searchParams.set("x", String(lng));
    url.searchParams.set("y", String(lat));
    // "가게 + 지역" / landmarks rank by relevance; plain names by distance (same as the old fill).
    url.searchParams.set("sort", preferAccuracySort(q) ? "accuracy" : "distance");
  }

  const t0 = Date.now();
  let hits: KakaoKeywordHit[] = [];
  let error: string | null = null;
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(KAKAO_KEYWORD_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as { documents?: Parameters<typeof kakaoDocToHit>[0][] };
      hits = (data.documents ?? []).map(kakaoDocToHit).filter((h): h is KakaoKeywordHit => h != null);
    } else {
      error = `http_${res.status}`;
    }
  } catch (e) {
    error = e instanceof Error && e.name === "TimeoutError" ? "timeout" : "fetch_failed";
  }
  const payload: MapKakaoSearchApiResponse = { hits, diag: { ms: Date.now() - t0, error } };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
