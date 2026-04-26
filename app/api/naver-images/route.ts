import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query")?.trim();
  if (!query) return NextResponse.json({ images: [] });

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return NextResponse.json({ images: [] });

  try {
    // 네이버 로컬 검색 (장소 전용)
    const localRes = await fetch(
      `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=1`,
      {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
      }
    );

    if (localRes.ok) {
      const localData = await localRes.json() as {
        items?: Array<{ title: string; address: string; category: string; link: string }>
      };
      const place = localData.items?.[0];

      if (place) {
        // 장소명으로 블로그 이미지 검색 (더 정확하게)
        const exactQuery = `${place.title.replace(/<[^>]*>/g, "")} ${place.address.split(" ").slice(0, 3).join(" ")}`;
        const imgRes = await fetch(
          `https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(exactQuery)}&display=5&sort=sim`,
          {
            headers: {
              "X-Naver-Client-Id": clientId,
              "X-Naver-Client-Secret": clientSecret,
            },
          }
        );
        if (imgRes.ok) {
          const imgData = await imgRes.json() as { items?: Array<{ thumbnail: string }> };
          const images = (imgData.items ?? []).map((i) => i.thumbnail);
          if (images.length > 0) return NextResponse.json({ images });
        }
      }
    }

    // 폴백: 기본 이미지 검색
    const res = await fetch(
      `https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(query)}&display=5&sort=sim`,
      {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
      }
    );
    if (!res.ok) return NextResponse.json({ images: [] });
    const data = await res.json() as { items?: Array<{ thumbnail: string }> };
    return NextResponse.json({ images: (data.items ?? []).map((i) => i.thumbnail) });
  } catch {
    return NextResponse.json({ images: [] });
  }
}