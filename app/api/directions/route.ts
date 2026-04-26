import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { origin: { lat: number; lng: number }; destination: { lat: number; lng: number } };
    const { origin, destination } = body;
    const kakaoKey = process.env.KAKAO_REST_API_KEY;
    if (!kakaoKey) return NextResponse.json({ error: "KAKAO_REST_API_KEY 없음" }, { status: 500 });
    const url = `https://apis-navi.kakaomobility.com/v1/directions?origin=${origin.lng},${origin.lat}&destination=${destination.lng},${destination.lat}&priority=RECOMMEND`;
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${kakaoKey}`, "Content-Type": "application/json" } });
    if (!res.ok) { const err = await res.text(); return NextResponse.json({ error: err }, { status: 500 }); }
    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "오류 발생" }, { status: 500 });
  }
}
