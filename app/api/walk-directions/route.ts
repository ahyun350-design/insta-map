import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      origin: { lat: number; lng: number };
      destination: { lat: number; lng: number };
    };
    const { origin, destination } = body;
    const appKey = process.env.TMAP_APP_KEY;
    if (!appKey) {
      return NextResponse.json({ error: "TMAP_APP_KEY 없음" }, { status: 500 });
    }

    const res = await fetch(
      "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          appKey,
        },
        body: JSON.stringify({
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
        }),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: 500 });
    }

    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "오류 발생" },
      { status: 500 },
    );
  }
}
