import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Category = "맛집" | "카페" | "쇼핑" | "숙소";

function mapCategoryCode(code: string): Category {
  if (code === "CE7") return "카페";
  if (code === "FD6") return "맛집";
  if (code === "MT1" || code === "CS2") return "쇼핑";
  if (code === "AD5") return "숙소";
  return "맛집";
}

async function getNaverImage(query: string): Promise<string | null> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(query)}&display=1&sort=sim`,
      {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { items?: Array<{ thumbnail: string }> };
    return data.items?.[0]?.thumbnail ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query")?.trim();

  if (!query) {
    return NextResponse.json({ error: "검색어가 필요합니다." }, { status: 400 });
  }

  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) {
    return NextResponse.json({ error: "KAKAO_REST_API_KEY가 없습니다." }, { status: 500 });
  }

  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=5`;

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "카카오 검색 실패" }, { status: 500 });
  }

  const data = await res.json() as {
    documents?: Array<{
      place_name: string;
      road_address_name: string;
      address_name: string;
      category_group_code: string;
    }>;
  };

  const places = await Promise.all(
    (data.documents ?? []).map(async (doc) => {
      const image = await getNaverImage(doc.place_name);
      return {
        name: doc.place_name,
        address: doc.road_address_name || doc.address_name,
        category: mapCategoryCode(doc.category_group_code),
        image,
      };
    })
  );

  if (places.length === 0) {
    return NextResponse.json({ error: "검색 결과가 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ places });
}