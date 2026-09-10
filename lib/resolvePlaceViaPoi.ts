/**
 * 카카오 origin(또는 힌트 좌표) 기준 인근 poi 재해결.
 * 매칭 규칙은 lib/poiMatch.ts (배치와 동일).
 * 시설 키워드 → facilityRouting source 후보만, 넓은 거리 상한.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  POI_MATCH_BBOX_DEG,
  POI_MATCH_RADIUS_M,
  POI_ROUTING_BBOX_DEG,
  POI_ROUTING_RADIUS_M,
  detectFacilityRoute,
  evaluateCandidate,
  haversineM,
  normalizePoiName,
  pickBestPoiMatch,
  roughNameSimilarity,
  type ExcludeReason,
  type PlacePoiMatch,
  type PoiRow,
} from "@/lib/poiMatch";

export type ResolveViaPoiInput = {
  placeName: string;
  originLat: number;
  originLng: number;
};

export type ResolveViaPoiFailReason =
  | "empty_name"
  | "bad_origin"
  | "norm_too_short"
  | "no_nearby"
  | "no_score"
  | "all_excluded"
  | "no_address";

export type ResolveViaPoiResult =
  | {
      ok: true;
      match: PlacePoiMatch;
      address: string;
      lat: number;
      lng: number;
      poiId: number;
    }
  | {
      ok: false;
      reason: ResolveViaPoiFailReason;
      nearbyCount: number;
      excluded?: Partial<Record<ExcludeReason, number>>;
    };

async function fetchNearbyPois(
  supabase: SupabaseClient,
  originLat: number,
  originLng: number,
  opts?: { bboxDeg: number; source?: string | null },
): Promise<PoiRow[]> {
  const d = opts?.bboxDeg ?? POI_MATCH_BBOX_DEG;
  let q = supabase
    .from("poi")
    .select(
      "id, name, name_norm, lat, lng, road_address, jibun_address, category, source",
    )
    .not("lat", "is", null)
    .not("lng", "is", null)
    .gte("lat", originLat - d)
    .lte("lat", originLat + d)
    .gte("lng", originLng - d)
    .lte("lng", originLng + d)
    .limit(250);

  if (opts?.source) {
    q = q.eq("source", opts.source);
  }

  const { data, error } = await q;

  if (error) {
    console.error("[resolvePlaceViaPoi] nearby query failed", {
      code: error.code,
      message: error.message,
      source: opts?.source ?? null,
    });
    return [];
  }

  const out: PoiRow[] = [];
  for (const row of data ?? []) {
    const id = typeof row.id === "number" ? row.id : Number(row.id);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const lat = typeof row.lat === "number" ? row.lat : Number(row.lat);
    const lng = typeof row.lng === "number" ? row.lng : Number(row.lng);
    if (!Number.isFinite(id) || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    out.push({
      id,
      name,
      name_norm: typeof row.name_norm === "string" ? row.name_norm : null,
      lat,
      lng,
      road_address: typeof row.road_address === "string" ? row.road_address : null,
      jibun_address: typeof row.jibun_address === "string" ? row.jibun_address : null,
      category: typeof row.category === "string" ? row.category : null,
      source: typeof row.source === "string" ? row.source : null,
    });
  }
  return out;
}

/**
 * placeName(Claude 이름) + origin(카카오 좌표) → poi 매칭.
 * 성공 시 poi 좌표·주소. 실패 시 ok:false (호출측에서 kakao 유지).
 */
export async function resolvePlaceViaPoi(
  supabase: SupabaseClient,
  input: ResolveViaPoiInput,
): Promise<ResolveViaPoiResult> {
  const placeName = (input.placeName || "").trim();
  if (!placeName) {
    return { ok: false, reason: "empty_name", nearbyCount: 0 };
  }
  if (!Number.isFinite(input.originLat) || !Number.isFinite(input.originLng)) {
    return { ok: false, reason: "bad_origin", nearbyCount: 0 };
  }

  const placeNorm = normalizePoiName(placeName);
  if (placeNorm.length < 2) {
    return { ok: false, reason: "norm_too_short", nearbyCount: 0 };
  }

  const routeSource = detectFacilityRoute(placeName);
  const routing = Boolean(routeSource);
  const bboxDeg = routing ? POI_ROUTING_BBOX_DEG : POI_MATCH_BBOX_DEG;
  const radiusM = routing ? POI_ROUTING_RADIUS_M : POI_MATCH_RADIUS_M;

  const nearby = await fetchNearbyPois(
    supabase,
    input.originLat,
    input.originLng,
    { bboxDeg, source: routeSource },
  );
  const candidates = [];
  for (const p of nearby) {
    const distM = haversineM(
      input.originLat,
      input.originLng,
      p.lat,
      p.lng,
    );
    if (distM > radiusM) continue;
    const poiNorm = p.name_norm || normalizePoiName(p.name);
    candidates.push({
      ...p,
      distM,
      simRaw: roughNameSimilarity(placeNorm, poiNorm),
    });
  }

  if (candidates.length === 0) {
    return { ok: false, reason: "no_nearby", nearbyCount: 0 };
  }

  const excluded: Partial<Record<ExcludeReason, number>> = {};
  let scoredN = 0;
  for (const c of candidates) {
    const pick = evaluateCandidate(
      {
        placeName,
        placeNorm,
        poiName: c.name,
        poiNorm: c.name_norm || normalizePoiName(c.name),
        simRaw: c.simRaw,
        distM: c.distM,
      },
      { routing },
    );
    if (!pick) continue;
    scoredN += 1;
    if (pick.excluded) {
      excluded[pick.excluded] = (excluded[pick.excluded] || 0) + 1;
    }
  }

  const best = pickBestPoiMatch(placeName, placeNorm, candidates, { routing });
  if (!best) {
    if (scoredN === 0) {
      return {
        ok: false,
        reason: "no_score",
        nearbyCount: candidates.length,
        excluded,
      };
    }
    return {
      ok: false,
      reason: "all_excluded",
      nearbyCount: candidates.length,
      excluded,
    };
  }

  const address = (
    best.poi.road_address ||
    best.poi.jibun_address ||
    ""
  ).trim();
  if (!address) {
    return {
      ok: false,
      reason: "no_address",
      nearbyCount: candidates.length,
      excluded,
    };
  }

  return {
    ok: true,
    match: best,
    address,
    lat: best.poi.lat,
    lng: best.poi.lng,
    poiId: best.poi.id,
  };
}

/** B 경로: 카카오 성공 후 poi 재해결 실패 */
export function formatPoiReresolveMissLog(
  placeName: string,
  reason: ResolveViaPoiFailReason,
  excluded?: Partial<Record<ExcludeReason, number>>,
): string {
  const safe = (placeName || "").replace(/\|/g, "/").trim();
  const excl =
    excluded && Object.keys(excluded).length > 0
      ? `|excluded=${Object.entries(excluded)
          .map(([k, v]) => `${k}:${v}`)
          .join(",")}`
      : "";
  return `poi_reresolve_miss|${safe}|reason=${reason}${excl}`;
}

/** D 경로: 카카오 실패 + Phase3 폴백도 실패 → pending */
export function formatPlacePendingLog(
  placeName: string,
  pendingReason: "poi_confirm" | "poi_miss",
): string {
  const safe = (placeName || "").replace(/\|/g, "/").trim();
  return `place_source|pending|${safe}|${pendingReason}`;
}
