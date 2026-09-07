import type { SupabaseClient } from "@supabase/supabase-js";

export type PoiSearchHit = {
  id: number;
  name: string;
  name_norm: string | null;
  road_address: string | null;
  jibun_address: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
  score: number;
};

export type SearchPoiParams = {
  q: string;
  hint_region?: string | null;
  origin_lat?: number | null;
  origin_lng?: number | null;
  max_results?: number;
};

function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function addressIncludesRegion(
  hit: PoiSearchHit,
  hintRegion: string,
): boolean {
  const road = (hit.road_address ?? "").trim();
  const jibun = (hit.jibun_address ?? "").trim();
  return road.includes(hintRegion) || jibun.includes(hintRegion);
}

/** 클라이언트/서버 공용 표시용 슬라이스 */
export function toPoiSearchResult(hit: PoiSearchHit) {
  return {
    id: hit.id,
    name: hit.name,
    road_address: hit.road_address,
    jibun_address: hit.jibun_address,
    lat: hit.lat,
    lng: hit.lng,
    category: hit.category,
    score: hit.score,
  };
}

export async function searchPoi(
  supabase: SupabaseClient,
  params: SearchPoiParams,
): Promise<PoiSearchHit[]> {
  const q = params.q.trim();
  if (!q) return [];

  const { data, error } = await supabase.rpc("search_poi", {
    q,
    hint_region: params.hint_region?.trim() || null,
    origin_lat: params.origin_lat ?? null,
    origin_lng: params.origin_lng ?? null,
    max_results: params.max_results ?? 5,
  });

  if (error) {
    console.error("[poiSearch] search_poi rpc failed", {
      code: error.code,
      message: error.message,
    });
    return [];
  }

  const rows = Array.isArray(data) ? data : [];
  const out: PoiSearchHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "number" ? r.id : Number(r.id);
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const score = typeof r.score === "number" ? r.score : Number(r.score);
    if (!Number.isFinite(id) || !name || !Number.isFinite(score)) continue;
    out.push({
      id,
      name,
      name_norm: typeof r.name_norm === "string" ? r.name_norm : null,
      road_address: typeof r.road_address === "string" ? r.road_address : null,
      jibun_address: typeof r.jibun_address === "string" ? r.jibun_address : null,
      lat: typeof r.lat === "number" && Number.isFinite(r.lat) ? r.lat : null,
      lng: typeof r.lng === "number" && Number.isFinite(r.lng) ? r.lng : null,
      category: typeof r.category === "string" ? r.category : null,
      score,
    });
  }
  return out;
}

export type PoiAdoptRule = "a" | "b";
export type PoiRejectReason = "c" | "d" | "e";

export type PoiDecideResult =
  | { kind: "adopt"; hit: PoiSearchHit; rule: PoiAdoptRule }
  | { kind: "needs_confirm"; reason: "c" | "d"; top: PoiSearchHit | null; hits: PoiSearchHit[] }
  | { kind: "reject"; reason: "e"; top: PoiSearchHit | null };

/**
 * 채택 규칙 (순서대로):
 * a) hint_region != null AND score>=90 AND 주소에 hint 포함 → 자동
 * b) hint_region == null AND origin 있음 AND score>=90 AND 30km 이내 high 후보 정확히 1개 → 자동
 * c) score>=90 이지만 a·b 아님 → needs_confirm
 * d) 70<=score<90 → needs_confirm
 * e) score<70 또는 결과 없음 → 버림
 *
 * hint도 origin도 없으면 score와 무관하게 자동 채택 불가.
 */
export function decidePoiAdoption(
  hits: PoiSearchHit[],
  opts: {
    hintRegion?: string | null;
    originLat?: number | null;
    originLng?: number | null;
  } = {},
): PoiDecideResult {
  const hintRaw = opts.hintRegion;
  const hint =
    hintRaw != null && String(hintRaw).trim() !== ""
      ? String(hintRaw).trim()
      : null;
  const originLat = opts.originLat;
  const originLng = opts.originLng;
  const hasOrigin =
    originLat != null &&
    originLng != null &&
    Number.isFinite(originLat) &&
    Number.isFinite(originLng);

  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const top = sorted[0] ?? null;
  if (!top) return { kind: "reject", reason: "e", top: null };

  const high = sorted.filter((h) => h.score >= 90);

  // a) hint_region 필수 + 주소 포함
  if (hint != null) {
    const matched = high.find((h) => addressIncludesRegion(h, hint));
    if (matched) return { kind: "adopt", hit: matched, rule: "a" };
  }

  // b) hint 없을 때만 — origin + 30km 이내 high 정확히 1개
  if (hint == null && hasOrigin) {
    const nearby = high.filter((h) => {
      if (h.lat == null || h.lng == null) return false;
      return haversineM(originLat!, originLng!, h.lat, h.lng) <= 30_000;
    });
    if (nearby.length === 1) {
      return { kind: "adopt", hit: nearby[0]!, rule: "b" };
    }
  }

  // c) score>=90 이지만 a·b 아님
  if (high.length > 0) {
    return {
      kind: "needs_confirm",
      reason: "c",
      top: high[0]!,
      hits: sorted.slice(0, 5),
    };
  }

  // d) 70 <= score < 90
  if (top.score >= 70) {
    return { kind: "needs_confirm", reason: "d", top, hits: sorted.slice(0, 5) };
  }

  // e) score < 70
  return { kind: "reject", reason: "e", top };
}

/** 진단 로그 한 줄 (장소명·점수만, 캡션 금지) */
export function formatPoiResolvedLog(
  name: string,
  score: number,
  rule: PoiAdoptRule,
): string {
  return `poi_resolved|${name.trim()}|score=${Math.round(score * 10) / 10}|rule=${rule}`;
}

export function formatPoiLowconfLog(
  name: string,
  topScore: number | null,
  reason: PoiRejectReason,
): string {
  const s = topScore == null ? "" : String(Math.round(topScore * 10) / 10);
  return `poi_lowconf|${name.trim()}|top_score=${s}|reason=${reason}`;
}
