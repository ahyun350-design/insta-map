/**
 * Admin MapLibre: Kakao 대중교통 경로 조회 (live only — never stored/cached).
 * GET upstream: https://dapi.kakao.com/v2/routing/publictraffic
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminRouteGate";
import {
  MAP_TRANSIT_TIMEOUT_MS,
  mapKakaoHttpError,
  parseKakaoPublicTraffic,
  type TransitErrorCode,
} from "@/lib/mapTransit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  startLat?: unknown;
  startLng?: unknown;
  endLat?: unknown;
  endLng?: unknown;
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function err(code: TransitErrorCode, status: number) {
  return NextResponse.json({ error: code }, { status });
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
    return err("bad_json", 400);
  }

  const startLat = num(body.startLat);
  const startLng = num(body.startLng);
  const endLat = num(body.endLat);
  const endLng = num(body.endLng);
  if (
    startLat == null ||
    startLng == null ||
    endLat == null ||
    endLng == null ||
    Math.abs(startLat) > 90 ||
    Math.abs(endLat) > 90 ||
    Math.abs(startLng) > 180 ||
    Math.abs(endLng) > 180
  ) {
    return err("bad_input", 400);
  }

  const restKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!restKey) return err("no_key", 500);

  const url = new URL("https://dapi.kakao.com/v2/routing/publictraffic");
  url.searchParams.set("start_x", String(startLng));
  url.searchParams.set("start_y", String(startLat));
  url.searchParams.set("end_x", String(endLng));
  url.searchParams.set("end_y", String(endLat));

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${restKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(MAP_TRANSIT_TIMEOUT_MS),
    });
    if (!res.ok) {
      return err(mapKakaoHttpError(res.status), 502);
    }
    const raw: unknown = await res.json();
    const parsed = parseKakaoPublicTraffic(raw);
    if (!parsed.ok) {
      const status =
        parsed.error === "too_close" || parsed.error === "EQUAL_POINTS"
          ? 200
          : parsed.error === "no_results" || parsed.error === "NO_RESULTS"
            ? 200
            : 200;
      return NextResponse.json(
        { status: parsed.status, error: parsed.error, routes: [] },
        { status },
      );
    }
    return NextResponse.json({ status: "OK", routes: parsed.routes });
  } catch {
    return err("fetch_failed", 502);
  }
}
