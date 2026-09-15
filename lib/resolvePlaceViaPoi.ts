/**
 * 카카오 origin(또는 힌트 좌표) 기준 인근 poi 재해결.
 * 매칭 규칙은 lib/poiMatch.ts (배치와 동일).
 * 시설 키워드 → facilityRouting source 후보만, 실패 시 일반 경로 폴백.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  POI_MATCH_RADIUS_M,
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

export type ResolveViaPoiTiming = {
  /** nearby_poi RPC wall time (includes network RTT to Supabase). */
  rpcMs: number;
  /** In-process poiMatch scoring / pickBest. */
  matchMs: number;
};

export type ResolveViaPoiResult =
  | {
      ok: true;
      match: PlacePoiMatch;
      address: string;
      lat: number;
      lng: number;
      poiId: number;
      timing: ResolveViaPoiTiming;
    }
  | {
      ok: false;
      reason: ResolveViaPoiFailReason;
      nearbyCount: number;
      excluded?: Partial<Record<ExcludeReason, number>>;
      timing?: ResolveViaPoiTiming;
    };

async function fetchNearbyPois(
  supabase: SupabaseClient,
  originLat: number,
  originLng: number,
  opts?: { radiusM: number; source?: string | null; maxResults?: number },
): Promise<PoiRow[]> {
  const radiusM = opts?.radiusM ?? POI_MATCH_RADIUS_M;
  const maxResults = opts?.maxResults ?? 100;
  const { data, error } = await supabase.rpc("nearby_poi", {
    origin_lat: originLat,
    origin_lng: originLng,
    radius_m: radiusM,
    max_results: maxResults,
    filter_source: opts?.source ?? null,
  });

  if (error) {
    console.error("[resolvePlaceViaPoi] nearby_poi rpc failed", {
      code: error.code,
      message: error.message,
      source: opts?.source ?? null,
    });
    return [];
  }

  return parseNearbyRows(data);
}

function parseNearbyRows(data: unknown): PoiRow[] {
  const out: PoiRow[] = [];
  for (const row of (data as unknown[]) ?? []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "number" ? r.id : Number(r.id);
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const lat = typeof r.lat === "number" ? r.lat : Number(r.lat);
    const lng = typeof r.lng === "number" ? r.lng : Number(r.lng);
    if (!Number.isFinite(id) || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    out.push({
      id,
      name,
      name_norm: typeof r.name_norm === "string" ? r.name_norm : null,
      lat,
      lng,
      road_address: typeof r.road_address === "string" ? r.road_address : null,
      jibun_address: typeof r.jibun_address === "string" ? r.jibun_address : null,
      category: typeof r.category === "string" ? r.category : null,
      source: typeof r.source === "string" ? r.source : null,
    });
  }
  return out;
}

const BATCH_RPC_CHUNK = 50;

type BatchOrigin = {
  id: string;
  lat: number;
  lng: number;
  radius_m: number;
  filter_source: string | null;
};

/**
 * Rematch-only: one RPC per ≤50 origins.
 * RPC returns one row per origin with pois jsonb (avoids PostgREST max-rows
 * truncating a flat 50×100 result set). Matching rules unchanged.
 */
async function fetchNearbyPoisBatch(
  supabase: SupabaseClient,
  origins: BatchOrigin[],
  maxResultsPer = 100,
): Promise<Map<string, PoiRow[]>> {
  const byOrigin = new Map<string, PoiRow[]>();
  for (const o of origins) byOrigin.set(o.id, []);
  if (origins.length === 0) return byOrigin;

  const payload = origins.map((o) => ({
    id: o.id,
    lat: o.lat,
    lng: o.lng,
    radius_m: o.radius_m,
    filter_source: o.filter_source,
  }));

  const { data, error } = await supabase.rpc("nearby_poi_batch", {
    origins: payload,
    max_results_per: maxResultsPer,
  });

  if (error) {
    console.error("[resolvePlaceViaPoi] nearby_poi_batch rpc failed", {
      code: error.code,
      message: error.message,
      n: origins.length,
    });
    return byOrigin;
  }

  for (const row of data ?? []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const originId =
      typeof r.origin_id === "string" ? r.origin_id : String(r.origin_id ?? "");
    if (!originId || !byOrigin.has(originId)) continue;
    byOrigin.set(originId, parseNearbyRows(r.pois));
  }
  return byOrigin;
}

export type ResolveBatchInput = ResolveViaPoiInput & { id: string };

/**
 * Rematch batch path: chunk origins into nearby_poi_batch RPCs (50 each),
 * then run the same poiMatch scoring as resolvePlaceViaPoi (incl. facility fallback).
 */
export async function resolvePlacesViaPoiBatch(
  supabase: SupabaseClient,
  inputs: ResolveBatchInput[],
): Promise<Map<string, ResolveViaPoiResult>> {
  const out = new Map<string, ResolveViaPoiResult>();
  if (inputs.length === 0) return out;

  // Precompute norms / routing; skip invalid early
  type Prep = {
    id: string;
    placeName: string;
    placeNorm: string;
    originLat: number;
    originLng: number;
    routeSource: string | null;
  };
  const preps: Prep[] = [];
  for (const input of inputs) {
    const placeName = (input.placeName || "").trim();
    if (!placeName) {
      out.set(input.id, { ok: false, reason: "empty_name", nearbyCount: 0 });
      continue;
    }
    if (!Number.isFinite(input.originLat) || !Number.isFinite(input.originLng)) {
      out.set(input.id, { ok: false, reason: "bad_origin", nearbyCount: 0 });
      continue;
    }
    const placeNorm = normalizePoiName(placeName);
    if (placeNorm.length < 2) {
      out.set(input.id, { ok: false, reason: "norm_too_short", nearbyCount: 0 });
      continue;
    }
    preps.push({
      id: input.id,
      placeName,
      placeNorm,
      originLat: input.originLat,
      originLng: input.originLng,
      routeSource: detectFacilityRoute(placeName),
    });
  }

  for (let i = 0; i < preps.length; i += BATCH_RPC_CHUNK) {
    const chunk = preps.slice(i, i + BATCH_RPC_CHUNK);
    const needGeneral: Prep[] = [];

    // Pass 1: facility-routed origins (if any)
    const routed = chunk.filter((p) => p.routeSource);
    if (routed.length) {
      const tRpc = Date.now();
      const nearbyMap = await fetchNearbyPoisBatch(
        supabase,
        routed.map((p) => ({
          id: p.id,
          lat: p.originLat,
          lng: p.originLng,
          radius_m: POI_ROUTING_RADIUS_M,
          filter_source: p.routeSource,
        })),
      );
      const rpcMs = Date.now() - tRpc;
      for (const p of routed) {
        const tMatch = Date.now();
        const nearby = nearbyMap.get(p.id) ?? [];
        const cands = buildCandidates(
          nearby,
          p.originLat,
          p.originLng,
          POI_ROUTING_RADIUS_M,
          p.placeNorm,
        );
        const result = finishMatch(
          p.placeName,
          p.placeNorm,
          cands,
          true,
          rpcMs / routed.length,
          tMatch,
        );
        if (result.ok) {
          out.set(p.id, result);
        } else {
          needGeneral.push(p);
        }
      }
    }

    // Pass 2: non-routed + facility misses → general nearby
    for (const p of chunk) {
      if (!p.routeSource) needGeneral.push(p);
    }

    if (needGeneral.length) {
      const tRpc = Date.now();
      const nearbyMap = await fetchNearbyPoisBatch(
        supabase,
        needGeneral.map((p) => ({
          id: p.id,
          lat: p.originLat,
          lng: p.originLng,
          radius_m: POI_MATCH_RADIUS_M,
          filter_source: null,
        })),
      );
      const rpcMs = Date.now() - tRpc;
      for (const p of needGeneral) {
        if (out.has(p.id)) continue;
        const tMatch = Date.now();
        const nearby = nearbyMap.get(p.id) ?? [];
        const cands = buildCandidates(
          nearby,
          p.originLat,
          p.originLng,
          POI_MATCH_RADIUS_M,
          p.placeNorm,
        );
        out.set(
          p.id,
          finishMatch(
            p.placeName,
            p.placeNorm,
            cands,
            false,
            rpcMs / needGeneral.length,
            tMatch,
          ),
        );
      }
    }
  }

  return out;
}

function buildCandidates(
  nearby: PoiRow[],
  originLat: number,
  originLng: number,
  radiusM: number,
  placeNorm: string,
): Array<PoiRow & { distM: number; simRaw: number }> {
  const candidates: Array<PoiRow & { distM: number; simRaw: number }> = [];
  for (const p of nearby) {
    const distM = haversineM(originLat, originLng, p.lat, p.lng);
    if (distM > radiusM) continue;
    const poiNorm = p.name_norm || normalizePoiName(p.name);
    candidates.push({
      ...p,
      distM,
      simRaw: roughNameSimilarity(placeNorm, poiNorm),
    });
  }
  return candidates;
}

function finishMatch(
  placeName: string,
  placeNorm: string,
  candidates: Array<PoiRow & { distM: number; simRaw: number }>,
  routing: boolean,
  rpcMs: number,
  matchStarted: number,
): ResolveViaPoiResult {
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
  const timing = { rpcMs, matchMs: Date.now() - matchStarted };

  if (!best) {
    if (candidates.length === 0) {
      return { ok: false, reason: "no_nearby", nearbyCount: 0, timing };
    }
    if (scoredN === 0) {
      return {
        ok: false,
        reason: "no_score",
        nearbyCount: candidates.length,
        excluded,
        timing,
      };
    }
    return {
      ok: false,
      reason: "all_excluded",
      nearbyCount: candidates.length,
      excluded,
      timing,
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
      timing,
    };
  }

  return {
    ok: true,
    match: best,
    address,
    lat: best.poi.lat,
    lng: best.poi.lng,
    poiId: best.poi.id,
    timing,
  };
}

/**
 * placeName(Claude 이름) + origin(카카오 좌표) → poi 매칭.
 * 성공 시 poi 좌표·주소. 실패 시 ok:false (호출측에서 kakao 유지).
 * 시설 라우팅 실패 시 일반 경로(전체 source)로 한 번 더 시도.
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
  let rpcMs = 0;
  const tMatchAll = Date.now();

  if (routeSource) {
    const tRpc = Date.now();
    const nearbyRouted = await fetchNearbyPois(
      supabase,
      input.originLat,
      input.originLng,
      {
        radiusM: POI_ROUTING_RADIUS_M,
        source: routeSource,
        maxResults: 100,
      },
    );
    rpcMs += Date.now() - tRpc;
    const routedCands = buildCandidates(
      nearbyRouted,
      input.originLat,
      input.originLng,
      POI_ROUTING_RADIUS_M,
      placeNorm,
    );
    const routed = finishMatch(
      placeName,
      placeNorm,
      routedCands,
      true,
      rpcMs,
      tMatchAll,
    );
    if (routed.ok) return routed;
    // fall through to general path
  }

  const tRpc2 = Date.now();
  const nearby = await fetchNearbyPois(
    supabase,
    input.originLat,
    input.originLng,
    { radiusM: POI_MATCH_RADIUS_M, source: null, maxResults: 100 },
  );
  rpcMs += Date.now() - tRpc2;
  const candidates = buildCandidates(
    nearby,
    input.originLat,
    input.originLng,
    POI_MATCH_RADIUS_M,
    placeNorm,
  );
  return finishMatch(placeName, placeNorm, candidates, false, rpcMs, tMatchAll);
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
