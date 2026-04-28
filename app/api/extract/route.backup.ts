import { NextResponse } from "next/server";
import {
  extractPlacesByClaude,
  isValidInstagramPostUrl,
  normalizeCategory,
  Place,
  RawPlace,
  scrapeInstagramCaption,
  searchKakaoPlace,
} from "@/app/api/extract/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backup of legacy synchronous extract endpoint.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { instagramUrl?: string };
    const instagramUrl = body.instagramUrl?.trim();

    if (!instagramUrl) return NextResponse.json({ error: "instagramUrl이 필요합니다." }, { status: 400 });
    if (!isValidInstagramPostUrl(instagramUrl)) return NextResponse.json({ error: "유효한 Instagram 게시물 URL을 입력해주세요." }, { status: 400 });

    const caption = await scrapeInstagramCaption(instagramUrl);
    const rawPlaces = await extractPlacesByClaude(caption);

    const places: Place[] = [];
    for (const item of rawPlaces as RawPlace[]) {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const hint = typeof item.hint === "string" ? item.hint.trim() : "";
      const category = normalizeCategory(item.category);
      if (!name || !category) continue;
      const kakaoResult = await searchKakaoPlace(name, hint);
      if (kakaoResult) places.push({ name, address: kakaoResult.roadAddress || kakaoResult.address, category });
    }

    if (places.length === 0) throw new Error("장소 추출에 실패했습니다.");
    return NextResponse.json({ caption, places });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
