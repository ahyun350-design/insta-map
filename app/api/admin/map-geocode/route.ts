/**
 * Admin expanded map: coordinates for one tapped 도로명주소 result.
 * One Kakao address-search call per tap; the point is returned for display
 * (map move + card) only — never stored (Kakao terms).
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminRouteGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KAKAO_TIMEOUT_MS = 3500;

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  let address = "";
  try {
    const body = (await req.json()) as { address?: unknown };
    address = typeof body.address === "string" ? body.address.trim().slice(0, 120) : "";
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  if (address.length < 4) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  const restKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!restKey) return NextResponse.json({ error: "no_key" }, { status: 500 });

  const endpoint = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  endpoint.searchParams.set("query", address);
  endpoint.searchParams.set("size", "1");
  try {
    const res = await fetch(endpoint.toString(), {
      headers: { Authorization: `KakaoAK ${restKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
    });
    if (!res.ok) return NextResponse.json({ error: `http_${res.status}` }, { status: 502 });
    const data = (await res.json()) as { documents?: Array<{ x?: string; y?: string }> };
    const doc = data.documents?.[0];
    const lat = parseFloat(String(doc?.y ?? ""));
    const lng = parseFloat(String(doc?.x ?? ""));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ lat, lng });
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
