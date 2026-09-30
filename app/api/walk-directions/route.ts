import { NextResponse } from "next/server";
import { requireBearerClaims } from "@/lib/requireBearerClaims";
import {
  cachedRouteToGeoJson,
  extractRouteFromTmapGeoJson,
  l1Get,
  l2GetMany,
  l2WriteMany,
  l1Set,
  walkRouteCacheKey,
  type WalkCachedRoute,
} from "@/lib/walkRouteCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMAP_PEDESTRIAN_URL =
  "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1";

/** ~5m at Korean latitudes — Tmap often errors on identical/near-identical points */
const MIN_SEGMENT_DISTANCE_DEG = 0.00005;
const MAX_BATCH_SEGMENTS = 20;

type LatLngInput = { lat?: unknown; lng?: unknown };

function normalizeCoord(coord: LatLngInput | undefined): { lat: number; lng: number } | null {
  const lat = Number(coord?.lat);
  const lng = Number(coord?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function coordsTooClose(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): boolean {
  if (origin.lat === destination.lat && origin.lng === destination.lng) return true;
  const dLat = Math.abs(origin.lat - destination.lat);
  const dLng = Math.abs(origin.lng - destination.lng);
  return dLat < MIN_SEGMENT_DISTANCE_DEG && dLng < MIN_SEGMENT_DISTANCE_DEG;
}

function tmapErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (typeof record.errorMessage === "string" && record.errorMessage.trim()) {
    return record.errorMessage;
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  return null;
}

type SegmentPair = {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
};

function readSegmentPair(raw: unknown): SegmentPair | { error: string; message: string } {
  if (!raw || typeof raw !== "object") {
    return { error: "invalid_coordinates", message: "segment 좌표가 유효하지 않습니다" };
  }
  const record = raw as Record<string, unknown>;
  const originRaw = (record.from ?? record.origin) as LatLngInput | undefined;
  const destinationRaw = (record.to ?? record.destination) as LatLngInput | undefined;
  const origin = normalizeCoord(originRaw);
  const destination = normalizeCoord(destinationRaw);
  if (!origin || !destination) {
    return {
      error: "invalid_coordinates",
      message: "origin/destination 좌표가 유효하지 않습니다",
    };
  }
  return { origin, destination };
}

type TmapSegmentResult =
  | { ok: true; data: unknown; tmapMs: number }
  | {
      ok: false;
      error: string;
      message: string;
      fallback?: string;
      tmapStatus?: number;
      tmapBody?: string;
      tmapMs: number;
    };

async function fetchTmapPedestrian(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  appKey: string,
): Promise<TmapSegmentResult> {
  if (coordsTooClose(origin, destination)) {
    return {
      ok: false,
      error: "coords_too_close",
      message: "출발지와 도착지가 너무 가깝습니다",
      fallback: "straight_line",
      tmapMs: 0,
    };
  }

  const tmapPayload = {
    startX: origin.lng,
    startY: origin.lat,
    endX: destination.lng,
    endY: destination.lat,
    startName: "출발",
    endName: "도착",
    reqCoordType: "WGS84GEO",
    resCoordType: "WGS84GEO",
    searchOption: "0",
    sort: "index",
  };

  const tmapT0 = Date.now();
  let res: Response;
  try {
    res = await fetch(TMAP_PEDESTRIAN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        appKey,
      },
      body: JSON.stringify(tmapPayload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (fetchErr) {
    return {
      ok: false,
      error: "tmap_fetch_failed",
      message: fetchErr instanceof Error ? fetchErr.message : "Tmap 요청 실패",
      tmapMs: Date.now() - tmapT0,
    };
  }

  const responseText = await res.text();
  const tmapMs = Date.now() - tmapT0;

  if (!res.ok) {
    console.error("[walk-api] tmap status", res.status, "body", responseText);
    return {
      ok: false,
      error: "tmap_error",
      message: `Tmap API HTTP ${res.status}`,
      tmapStatus: res.status,
      tmapBody: responseText.slice(0, 500),
      tmapMs,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(responseText);
  } catch (jsonErr) {
    console.error(
      "[walk-api] tmap response not JSON",
      jsonErr,
      "body",
      responseText.slice(0, 500),
    );
    return {
      ok: false,
      error: "tmap_invalid_json",
      message: "Tmap 응답 JSON 파싱 실패",
      tmapBody: responseText.slice(0, 500),
      tmapMs,
    };
  }

  const businessError = tmapErrorMessage(data);
  if (businessError) {
    console.error("[walk-api] tmap business error", businessError, data);
    return {
      ok: false,
      error: "tmap_business_error",
      message: businessError,
      tmapMs,
    };
  }

  return { ok: true, data, tmapMs };
}

type BatchItemResult =
  | { ok: true; data: unknown; cache: "l1" | "l2" | "tmap"; tmapMs: number }
  | {
      ok: false;
      error: string;
      message: string;
      fallback?: string;
      tmapStatus?: number;
      tmapBody?: string;
      tmapMs: number;
    };

export async function POST(req: Request) {
  const routeT0 = Date.now();
  let authMs = 0;
  let tmapMs = 0;
  let l2Ms = 0;
  const withTimings = (res: NextResponse, extra?: Record<string, unknown>) => {
    const totalMs = Date.now() - routeT0;
    res.headers.set(
      "Server-Timing",
      `auth;dur=${authMs}, l2;dur=${l2Ms}, tmap;dur=${tmapMs}, total;dur=${totalMs}`,
    );
    res.headers.set(
      "x-walk-timings",
      JSON.stringify({ authMs, l2Ms, tmapMs, totalMs, v: 3, ...extra }),
    );
    return res;
  };

  try {
    const authT0 = Date.now();
    const auth = await requireBearerClaims(req);
    authMs = Date.now() - authT0;
    if ("error" in auth) return withTimings(auth.error);

    let body: unknown;
    try {
      body = await req.json();
    } catch (parseErr) {
      console.error("[walk-api] invalid request JSON", parseErr);
      return withTimings(
        NextResponse.json(
          { error: "invalid_request_json", message: "요청 JSON 파싱 실패" },
          { status: 400 },
        ),
      );
    }

    const bodyRecord = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const segmentsRaw = bodyRecord.segments;
    /** Ops/measure only: skip in-process L1 so L2 path can be timed after warm writes. */
    const bypassL1 = bodyRecord.bypassL1 === true;

    const appKeyRaw = process.env.TMAP_APP_KEY;
    const appKey = appKeyRaw?.trim() ?? "";

    // ── Batch: auth once, L1 → L2(IN once) → Tmap parallel ────────────
    if (Array.isArray(segmentsRaw)) {
      if (segmentsRaw.length === 0) {
        return withTimings(
          NextResponse.json(
            { error: "empty_segments", message: "segments 배열이 비어 있습니다" },
            { status: 400 },
          ),
        );
      }
      if (segmentsRaw.length > MAX_BATCH_SEGMENTS) {
        return withTimings(
          NextResponse.json(
            {
              error: "too_many_segments",
              message: `segments는 최대 ${MAX_BATCH_SEGMENTS}개까지`,
            },
            { status: 400 },
          ),
        );
      }

      const pairs: Array<SegmentPair | { error: string; message: string }> = segmentsRaw.map(
        (raw) => readSegmentPair(raw),
      );

      type Slot =
        | { kind: "error"; error: string; message: string }
        | { kind: "pair"; origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; key: string };

      const slots: Slot[] = pairs.map((pair) => {
        if ("error" in pair) return { kind: "error", error: pair.error, message: pair.message };
        return {
          kind: "pair",
          origin: pair.origin,
          destination: pair.destination,
          key: walkRouteCacheKey(pair.origin, pair.destination),
        };
      });

      const results: BatchItemResult[] = new Array(slots.length);
      let l1Hits = 0;
      let l2Hits = 0;
      let tmapMisses = 0;

      const needL2Keys: string[] = [];
      const needL2Indexes: number[] = [];

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]!;
        if (slot.kind === "error") {
          results[i] = {
            ok: false,
            error: slot.error,
            message: slot.message,
            tmapMs: 0,
          };
          continue;
        }
        if (!bypassL1) {
          const l1 = l1Get(slot.key);
          if (l1) {
            l1Hits += 1;
            results[i] = {
              ok: true,
              data: cachedRouteToGeoJson(l1),
              cache: "l1",
              tmapMs: 0,
            };
            continue;
          }
        }
        needL2Keys.push(slot.key);
        needL2Indexes.push(i);
      }

      if (needL2Keys.length > 0) {
        const l2T0 = Date.now();
        const l2Map = await l2GetMany(needL2Keys);
        l2Ms = Date.now() - l2T0;
        const stillMiss: number[] = [];
        for (const idx of needL2Indexes) {
          const slot = slots[idx]!;
          if (slot.kind !== "pair") continue;
          const hit = l2Map.get(slot.key);
          if (hit) {
            l2Hits += 1;
            results[idx] = {
              ok: true,
              data: cachedRouteToGeoJson(hit),
              cache: "l2",
              tmapMs: 0,
            };
          } else {
            stillMiss.push(idx);
          }
        }

        if (stillMiss.length > 0) {
          if (!appKey) {
            console.error("[walk-api] TMAP_APP_KEY missing", {
              hasRaw: Boolean(appKeyRaw),
              rawLength: appKeyRaw?.length ?? 0,
            });
            return withTimings(
              NextResponse.json(
                { error: "missing_tmap_key", message: "TMAP_APP_KEY 없음" },
                { status: 500 },
              ),
            );
          }

          const tmapWallT0 = Date.now();
          const pendingWrites: Array<{ key: string; route: WalkCachedRoute }> = [];
          const tmapResults = await Promise.all(
            stillMiss.map(async (idx) => {
              const slot = slots[idx]!;
              if (slot.kind !== "pair") {
                return { idx, result: null as TmapSegmentResult | null };
              }
              const result = await fetchTmapPedestrian(slot.origin, slot.destination, appKey);
              return { idx, result, slot };
            }),
          );
          tmapMs = Date.now() - tmapWallT0;

          for (const item of tmapResults) {
            const { idx, result } = item;
            if (!result) continue;
            if (!result.ok) {
              tmapMisses += 1;
              results[idx] = { ...result };
              continue;
            }
            const slot = (item as { slot: Extract<Slot, { kind: "pair" }> }).slot;
            const extracted = extractRouteFromTmapGeoJson(
              result.data,
              slot.origin,
              slot.destination,
            );
            if (extracted) {
              l1Set(slot.key, extracted);
              pendingWrites.push({ key: slot.key, route: extracted });
            }
            tmapMisses += 1;
            results[idx] = {
              ok: true,
              data: result.data,
              cache: "tmap",
              tmapMs: result.tmapMs,
            };
          }

          // Fire-and-forget L2 write — do not await
          l2WriteMany(pendingWrites);
        }
      }

      return withTimings(
        NextResponse.json({
          results: results.map((r) => {
            if (r.ok) {
              return { ok: true as const, data: r.data, cache: r.cache };
            }
            const { tmapMs: _drop, ...rest } = r;
            return rest;
          }),
        }),
        {
          batch: true,
          segmentCount: results.length,
          cache: { l1: l1Hits, l2: l2Hits, tmap: tmapMisses },
        },
      );
    }

    // ── Legacy single: origin + destination ──────────────────────────
    const { origin: originRaw, destination: destinationRaw } = bodyRecord as {
      origin?: LatLngInput;
      destination?: LatLngInput;
    };

    const origin = normalizeCoord(originRaw);
    const destination = normalizeCoord(destinationRaw);
    if (!origin || !destination) {
      console.error("[walk-api] invalid coordinates", {
        origin: originRaw,
        destination: destinationRaw,
      });
      return withTimings(
        NextResponse.json(
          {
            error: "invalid_coordinates",
            message: "origin/destination 좌표가 유효하지 않습니다",
            origin: originRaw ?? null,
            destination: destinationRaw ?? null,
          },
          { status: 400 },
        ),
      );
    }

    const cacheKey = walkRouteCacheKey(origin, destination);
    if (!bypassL1) {
      const l1Hit = l1Get(cacheKey);
      if (l1Hit) {
        return withTimings(NextResponse.json(cachedRouteToGeoJson(l1Hit)), {
          cache: { l1: 1, l2: 0, tmap: 0 },
        });
      }
    }

    {
      const l2T0 = Date.now();
      const l2Map = await l2GetMany([cacheKey]);
      l2Ms = Date.now() - l2T0;
      const l2Hit = l2Map.get(cacheKey);
      if (l2Hit) {
        return withTimings(NextResponse.json(cachedRouteToGeoJson(l2Hit)), {
          cache: { l1: 0, l2: 1, tmap: 0 },
        });
      }
    }

    if (!appKey) {
      console.error("[walk-api] TMAP_APP_KEY missing", {
        hasRaw: Boolean(appKeyRaw),
        rawLength: appKeyRaw?.length ?? 0,
      });
      return withTimings(
        NextResponse.json(
          { error: "missing_tmap_key", message: "TMAP_APP_KEY 없음" },
          { status: 500 },
        ),
      );
    }

    const single = await fetchTmapPedestrian(origin, destination, appKey);
    tmapMs = single.tmapMs;

    if (!single.ok) {
      const status =
        single.error === "coords_too_close"
          ? 422
          : single.error === "invalid_coordinates"
            ? 400
            : 502;
      return withTimings(
        NextResponse.json(
          {
            error: single.error,
            message: single.message,
            ...(single.fallback ? { fallback: single.fallback } : {}),
            ...(single.tmapStatus != null ? { tmapStatus: single.tmapStatus } : {}),
            ...(single.tmapBody ? { tmapBody: single.tmapBody } : {}),
          },
          { status },
        ),
        { cache: { l1: 0, l2: 0, tmap: 1 } },
      );
    }

    const extracted = extractRouteFromTmapGeoJson(single.data, origin, destination);
    if (extracted) {
      l1Set(cacheKey, extracted);
      l2WriteMany([{ key: cacheKey, route: extracted }]);
    }

    return withTimings(NextResponse.json(single.data), {
      cache: { l1: 0, l2: 0, tmap: 1 },
    });
  } catch (e) {
    console.error("[walk-api] unhandled", e);
    return withTimings(
      NextResponse.json(
        {
          error: "internal_error",
          message: e instanceof Error ? e.message : "오류 발생",
        },
        { status: 500 },
      ),
    );
  }
}
