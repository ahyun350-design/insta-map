import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KakaoKeywordDoc = {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query")?.trim();
    if (!query) {
      return NextResponse.json({ error: "query가 필요합니다." }, { status: 400 });
    }

    const restKey = process.env.KAKAO_REST_API_KEY;
    if (!restKey) {
      return NextResponse.json(
        { error: "서버에 KAKAO_REST_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const endpoint = new URL(
      "https://dapi.kakao.com/v2/local/search/keyword.json"
    );
    endpoint.searchParams.set("query", query);
    endpoint.searchParams.set("size", "1");

    const response = await fetch(endpoint.toString(), {
      headers: {
        Authorization: `KakaoAK ${restKey}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json(
        { error: `Kakao Local API 오류: ${err}` },
        { status: 502 }
      );
    }

    const data = (await response.json()) as {
      documents?: KakaoKeywordDoc[];
    };
    const first = data.documents?.[0];
    if (!first) {
      return NextResponse.json({ result: null });
    }

    return NextResponse.json({
      result: {
        id: first.id,
        placeName: first.place_name,
        address: first.road_address_name || first.address_name,
        lng: Number(first.x),
        lat: Number(first.y),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
