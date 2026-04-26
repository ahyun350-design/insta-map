import { NextResponse } from "next/server";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClaudeCategory = "맛집" | "카페" | "쇼핑" | "숙소";
type Place = { name: string; address: string; category: ClaudeCategory };
type RawPlace = { name?: unknown; address?: unknown; category?: unknown; hint?: unknown };

function sanitizeJsonLikeText(input: string): string {
  return input.replace(/```json|```/gi, "").replace(/[""]/g, '"').replace(/['']/g, "'").replace(/,\s*([}\]])/g, "$1").trim();
}
function extractJsonPayload(text: string): string {
  const arrayStart = text.indexOf("["); const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) return text.slice(arrayStart, arrayEnd + 1).trim();
  const objectStart = text.indexOf("{"); const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) return text.slice(objectStart, objectEnd + 1).trim();
  return text.trim();
}
function quoteUnquotedKeys(jsonLike: string): string {
  return jsonLike.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
}
function singleQuotedToDoubleQuoted(jsonLike: string): string {
  return jsonLike.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, group: string) => `"${group.replace(/"/g, '\\"')}"`);
}
function parseClaudeJsonSafely(rawText: string): unknown {
  const base = sanitizeJsonLikeText(rawText);
  const jsonPayload = extractJsonPayload(base);
  const attempts = [jsonPayload, quoteUnquotedKeys(jsonPayload), singleQuotedToDoubleQuoted(jsonPayload), quoteUnquotedKeys(singleQuotedToDoubleQuoted(jsonPayload))];
  for (const attempt of attempts) { try { return JSON.parse(attempt); } catch { } }
  throw new Error("Claude 응답 JSON 파싱에 실패했습니다.");
}
function normalizeCategory(raw: unknown): ClaudeCategory | null {
  if (raw === "맛집" || raw === "카페" || raw === "쇼핑" || raw === "숙소") return raw;
  if (raw === "restaurant") return "맛집";
  if (raw === "cafe") return "카페";
  if (raw === "shopping") return "쇼핑";
  if (raw === "stay" || raw === "hotel") return "숙소";
  return null;
}
function parseClaudePlacesSafely(rawText: string): RawPlace[] {
  const parsed = parseClaudeJsonSafely(rawText);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.filter((item) => item && typeof item === "object") as RawPlace[];
}

async function searchKakaoPlace(name: string, hint: string): Promise<{ address: string; roadAddress: string } | null> {
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) return null;
  const regionHint = hint.replace(/[-~]/g, " ").split(/[\s,]+/).find(w => w.length >= 2 && /[가-힣]/.test(w)) ?? "";
  const query = regionHint ? `${name} ${regionHint}` : name;
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=1`, { headers: { Authorization: `KakaoAK ${kakaoKey}` } });
    if (!res.ok) return null;
    const data = await res.json() as { documents?: Array<{ address_name: string; road_address_name: string }> };
    const first = data.documents?.[0];
    if (!first) return null;
    return { address: first.address_name, roadAddress: first.road_address_name || first.address_name };
  } catch { return null; }
}

// fetch로 Instagram HTML에서 캡션 추출 시도
async function scrapeInstagramCaption(url: string): Promise<string> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  };

  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`Instagram 페이지 로딩 실패: ${res.status}`);
  const html = await res.text();

  // 1. og:description 메타태그에서 추출
  const ogMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i)
    || html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:description"[^>]*>/i);
  if (ogMatch?.[1]) {
    const decoded = ogMatch[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    if (decoded.length > 5) return decoded;
  }

  // 2. JSON-LD에서 추출
  const jsonLdMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonLdMatch[1]);
      const caption = parsed?.caption ?? parsed?.articleBody ?? parsed?.description ?? "";
      if (typeof caption === "string" && caption.trim().length > 5) return caption.trim();
    } catch { }
  }

  // 3. window._sharedData에서 추출
  const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});\s*<\/script>/s);
  if (sharedDataMatch?.[1]) {
    try {
      const data = JSON.parse(sharedDataMatch[1]);
      const edges = data?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media?.edge_media_to_caption?.edges;
      if (edges?.[0]?.node?.text) return edges[0].node.text;
    } catch { }
  }

  throw new Error("Instagram 캡션을 가져올 수 없습니다. Instagram이 자동 접근을 차단했을 수 있습니다.");
}

async function extractPlacesByClaude(caption: string): Promise<RawPlace[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다.");

  const prompt = [
    "아래 인스타그램 캡션에서 언급된 모든 장소를 추출하세요.",
    "장소가 여러 개면 모두 포함하고, 없으면 빈 배열을 반환하세요.",
    '반드시 JSON 배열만 반환하세요. 형식: [{"name":"장소명","hint":"동네명또는역이름","category":"맛집|카페|쇼핑|숙소"}]',
    "hint는 반드시 캡션에 직접 언급된 동네명, 역이름, 구명 중 가장 구체적인 것 하나만 넣으세요.",
    "예: 망원동, 합정, 성수, 용산역 처럼 짧고 구체적인 지역명 하나만.",
    "절대로 서울, 한국 같은 넓은 지역명은 쓰지 마세요. 구체적인 동네명이 없으면 빈 문자열.",
    'category는 반드시 "맛집", "카페", "쇼핑", "숙소" 중 하나만 사용하세요.',
    "",
    `caption: ${caption}`,
  ].join("\n");

  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      temperature: 0,
      system: 'You must return only pure JSON array. Output format: [{"name":"...","hint":"...","category":"카페"}]. Do not include markdown, code fences, explanations, or any extra text.',
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) { const err = await res.text(); throw new Error(`Claude API 오류: ${err}`); }
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) throw new Error("Claude 응답이 비어 있습니다.");
  return parseClaudePlacesSafely(text);
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { instagramUrl?: string };
    const instagramUrl = body.instagramUrl?.trim();

    if (!instagramUrl) {
      return NextResponse.json({ error: "instagramUrl이 필요합니다." }, { status: 400 });
    }

    const validHost = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\//i.test(instagramUrl);
    if (!validHost) {
      return NextResponse.json({ error: "유효한 Instagram 게시물 URL을 입력해주세요." }, { status: 400 });
    }

    const caption = await scrapeInstagramCaption(instagramUrl);
    const rawPlaces = await extractPlacesByClaude(caption);

    const places: Place[] = [];
    for (const item of rawPlaces) {
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