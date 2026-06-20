import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMAP_PEDESTRIAN_URL =
  "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1";

/** ~5m at Korean latitudes — Tmap often errors on identical/near-identical points */
const MIN_SEGMENT_DISTANCE_DEG = 0.00005;

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

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch (parseErr) {
      console.error("[walk-api] invalid request JSON", parseErr);
      return NextResponse.json(
        { error: "invalid_request_json", message: "요청 JSON 파싱 실패" },
        { status: 400 },
      );
    }

    const { origin: originRaw, destination: destinationRaw } = body as {
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
      return NextResponse.json(
        {
          error: "invalid_coordinates",
          message: "origin/destination 좌표가 유효하지 않습니다",
          origin: originRaw ?? null,
          destination: destinationRaw ?? null,
        },
        { status: 400 },
      );
    }

    if (coordsTooClose(origin, destination)) {
      console.warn("[walk-api] coords too close — skip Tmap", { origin, destination });
      return NextResponse.json(
        {
          error: "coords_too_close",
          message: "출발지와 도착지가 너무 가깝습니다",
          fallback: "straight_line",
        },
        { status: 422 },
      );
    }

    const appKeyRaw = process.env.TMAP_APP_KEY;
    const appKey = appKeyRaw?.trim();
    if (!appKey) {
      console.error("[walk-api] TMAP_APP_KEY missing", {
        hasRaw: Boolean(appKeyRaw),
        rawLength: appKeyRaw?.length ?? 0,
      });
      return NextResponse.json(
        { error: "missing_tmap_key", message: "TMAP_APP_KEY 없음" },
        { status: 500 },
      );
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
      console.error("[walk-api] tmap fetch failed", fetchErr);
      return NextResponse.json(
        {
          error: "tmap_fetch_failed",
          message: fetchErr instanceof Error ? fetchErr.message : "Tmap 요청 실패",
        },
        { status: 502 },
      );
    }

    const responseText = await res.text();

    if (!res.ok) {
      console.error("[walk-api] tmap status", res.status, "body", responseText);
      return NextResponse.json(
        {
          error: "tmap_error",
          message: `Tmap API HTTP ${res.status}`,
          tmapStatus: res.status,
          tmapBody: responseText.slice(0, 500),
        },
        { status: 502 },
      );
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
      return NextResponse.json(
        {
          error: "tmap_invalid_json",
          message: "Tmap 응답 JSON 파싱 실패",
          tmapBody: responseText.slice(0, 500),
        },
        { status: 502 },
      );
    }

    const businessError = tmapErrorMessage(data);
    if (businessError) {
      console.error("[walk-api] tmap business error", businessError, data);
      return NextResponse.json(
        {
          error: "tmap_business_error",
          message: businessError,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("[walk-api] unhandled", e);
    return NextResponse.json(
      {
        error: "internal_error",
        message: e instanceof Error ? e.message : "오류 발생",
      },
      { status: 500 },
    );
  }
}
