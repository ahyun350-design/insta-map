import { NextResponse } from "next/server";
import { requireBearerUser } from "@/lib/requireBearerUser";

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

export async function POST(req: Request) {
  const routeT0 = Date.now();
  let authMs = 0;
  let tmapMs = 0;
  const withTimings = (res: NextResponse, extra?: Record<string, unknown>) => {
    const totalMs = Date.now() - routeT0;
    res.headers.set(
      "Server-Timing",
      `auth;dur=${authMs}, tmap;dur=${tmapMs}, total;dur=${totalMs}`,
    );
    res.headers.set(
      "x-walk-timings",
      JSON.stringify({ authMs, tmapMs, totalMs, ...extra }),
    );
    return res;
  };

  try {
    const authT0 = Date.now();
    const auth = await requireBearerUser(req);
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

    const appKeyRaw = process.env.TMAP_APP_KEY;
    const appKey = appKeyRaw?.trim();
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

    // ── Batch: auth once, Tmap parallel ──────────────────────────────
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

      const tmapWallT0 = Date.now();
      const results = await Promise.all(
        pairs.map(async (pair) => {
          if ("error" in pair) {
            return {
              ok: false as const,
              error: pair.error,
              message: pair.message,
              tmapMs: 0,
            };
          }
          return fetchTmapPedestrian(pair.origin, pair.destination, appKey);
        }),
      );
      tmapMs = Date.now() - tmapWallT0;

      const segmentTmapMs = results.map((r) => r.tmapMs);
      return withTimings(
        NextResponse.json({
          results: results.map((r) => {
            if (r.ok) return { ok: true as const, data: r.data };
            const { tmapMs: _drop, ...rest } = r;
            return rest;
          }),
        }),
        { batch: true, segmentCount: results.length, segmentTmapMs },
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
      );
    }

    return withTimings(NextResponse.json(single.data));
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
