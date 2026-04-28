export const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
export type ClaudeCategory = "맛집" | "카페" | "쇼핑" | "숙소";
export type Place = { name: string; address: string; category: ClaudeCategory };
export type RawPlace = { name?: unknown; address?: unknown; category?: unknown; hint?: unknown };

export function isValidInstagramPostUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\//i.test(url);
}

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
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try next normalization
    }
  }
  throw new Error("Claude 응답 JSON 파싱에 실패했습니다.");
}
export function normalizeCategory(raw: unknown): ClaudeCategory | null {
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

export async function searchKakaoPlace(name: string, hint: string): Promise<{ address: string; roadAddress: string } | null> {
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) return null;
  const regionHint = hint.replace(/[-~]/g, " ").split(/[\s,]+/).find((w) => w.length >= 2 && /[가-힣]/.test(w)) ?? "";
  const query = regionHint ? `${name} ${regionHint}` : name;
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=1`, { headers: { Authorization: `KakaoAK ${kakaoKey}` } });
    if (!res.ok) return null;
    const data = await res.json() as { documents?: Array<{ address_name: string; road_address_name: string }> };
    const first = data.documents?.[0];
    if (!first) return null;
    return { address: first.address_name, roadAddress: first.road_address_name || first.address_name };
  } catch {
    return null;
  }
}

export async function scrapeInstagramCaption(url: string): Promise<string> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN이 설정되지 않았습니다.");

  const runRes = await fetch("https://api.apify.com/v2/acts//runs?token=" + token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: [url],
      resultsType: "posts",
      resultsLimit: 1,
    }),
  });

  if (!runRes.ok) throw new Error("Apify 실행 실패: " + await runRes.text());
  const runData = await runRes.json() as { data?: { id?: string; defaultDatasetId?: string } };
  const runId = runData.data?.id;
  if (!runId) throw new Error("Apify run ID를 가져올 수 없습니다.");

  let datasetId = runData.data?.defaultDatasetId;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    const statusData = await statusRes.json() as { data?: { status?: string; defaultDatasetId?: string } };
    const status = statusData.data?.status;
    datasetId = statusData.data?.defaultDatasetId ?? datasetId;
    if (status === "SUCCEEDED") break;
    if (status === "FAILED" || status === "ABORTED") throw new Error("Apify 작업 실패");
  }

  if (!datasetId) throw new Error("Dataset ID를 가져올 수 없습니다.");

  const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`);
  const items = await itemsRes.json() as Array<{ caption?: unknown; text?: unknown; description?: unknown }>;
  if (!items?.length) throw new Error("Instagram 게시물을 가져올 수 없습니다.");

  const post = items[0];
  const caption = post?.caption ?? post?.text ?? post?.description ?? "";
  if (!caption) throw new Error("캡션을 찾을 수 없습니다.");
  return String(caption).trim();
}

export async function extractPlacesByClaude(caption: string): Promise<RawPlace[]> {
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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API 오류: ${err}`);
  }
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) throw new Error("Claude 응답이 비어 있습니다.");
  return parseClaudePlacesSafely(text);
}
