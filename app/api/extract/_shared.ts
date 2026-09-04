export { isValidInstagramPostUrl } from "@/lib/instagramUrl";

export const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_APIFY_ACTOR_ID = "apify~instagram-post-scraper";
export type ClaudeCategory = "맛집" | "카페" | "쇼핑" | "숙소" | "놀거리" | "여행지";
export type Place = { name: string; address: string; category: ClaudeCategory };
export type RawPlace = { name?: unknown; address?: unknown; category?: unknown; hint?: unknown };

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
  if (
    raw === "맛집" ||
    raw === "카페" ||
    raw === "쇼핑" ||
    raw === "숙소" ||
    raw === "놀거리" ||
    raw === "여행지"
  ) {
    return raw;
  }
  if (raw === "restaurant") return "맛집";
  if (raw === "cafe") return "카페";
  if (raw === "shopping") return "쇼핑";
  if (raw === "stay" || raw === "hotel") return "숙소";
  if (raw === "fun" || raw === "leisure") return "놀거리";
  if (raw === "travel" || raw === "sightseeing") return "여행지";
  return null;
}
function parseClaudePlacesSafely(rawText: string): RawPlace[] {
  const parsed = parseClaudeJsonSafely(rawText);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.filter((item) => item && typeof item === "object") as RawPlace[];
}

export type KakaoPlaceLookup = {
  address: string;
  roadAddress: string;
  lat: number;
  lng: number;
  placeName: string;
  category_group_code: string;
  category_name: string;
  /** 0=1차 원본 쿼리, 1+=폴백 */
  queryIndex: number;
};

export type SearchKakaoPlaceOptions = {
  /** epoch ms — 넘기면 남은 폴백 쿼리 중단 (선택) */
  deadlineMs?: number;
};

const KAKAO_SEARCH_MAX_ATTEMPTS = 4;

/**
 * 메뉴·수식어가 붙은 상호명 폴백 후보.
 * 원본 → 마지막 어절 제거(최대 3회) → 첫 어절 단독. 최대 4개.
 * 첫 어절이 1글자면 first_token 단계는 건너뜀.
 */
function buildKakaoQueryFallbacks(name: string): { query: string; stage: string }[] {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const out: { query: string; stage: string }[] = [];
  const push = (query: string, stage: string) => {
    const t = query.trim();
    if (!t) return;
    if (out.some((x) => x.query === t)) return;
    if (out.length >= KAKAO_SEARCH_MAX_ATTEMPTS) return;
    out.push({ query: t, stage });
  };

  push(trimmed, "original");

  let current = tokens.slice();
  for (let n = 1; n <= 3 && current.length > 1; n += 1) {
    current = current.slice(0, -1);
    push(current.join(" "), `drop_last_${n}`);
  }

  const first = tokens[0];
  if (first && first.length >= 2) {
    push(first, "first_token");
  }

  return out;
}

/**
 * 카카오 키워드 검색 — 0건이면 어절 폴백 순차 재시도(최대 4회).
 * size=15. hint가 있으면 주소 포함 후보 우선, 없으면 "hint + 상호명" 재검색, 그래도 없으면 documents[0].
 * @param hint Claude가 뽑은 동네/역/구명 (주소 매칭·재검색에 사용).
 * @param _region 호환용(현재 미사용).
 * @param _caption 호환용(미사용).
 */
export async function searchKakaoPlace(
  name: string,
  hint: string = "",
  _region?: string,
  _caption: string = "",
  options?: SearchKakaoPlaceOptions,
): Promise<KakaoPlaceLookup | null> {
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) return null;

  const trimmed = name.trim();
  if (!trimmed) return null;
  const hintTrimmed = hint.trim();

  const deadlineMs = options?.deadlineMs;
  const queries = buildKakaoQueryFallbacks(trimmed);

  type Doc = {
    place_name?: string;
    address_name: string;
    road_address_name: string;
    x: string;
    y: string;
    category_group_code?: string;
    category_name?: string;
  };

  type PickKind = "hint_match" | "hint_query" | "first";

  const toLookup = (doc: Doc, queryIndex: number): KakaoPlaceLookup | null => {
    const lat = parseFloat(doc.y);
    const lng = parseFloat(doc.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      address: doc.address_name,
      roadAddress: doc.road_address_name || doc.address_name,
      lat,
      lng,
      placeName: (doc.place_name || "").trim(),
      category_group_code: (doc.category_group_code ?? "").trim(),
      category_name: (doc.category_name ?? "").trim(),
      queryIndex,
    };
  };

  const addressIncludesHint = (doc: Doc, regionHint: string): boolean => {
    const road = (doc.road_address_name || "").trim();
    const addr = (doc.address_name || "").trim();
    return road.includes(regionHint) || addr.includes(regionHint);
  };

  const fetchDocuments = async (
    query: string,
    queryIndex: number,
    stage: string,
  ): Promise<Doc[] | null> => {
    try {
      const res = await fetch(
        `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=15`,
        { headers: { Authorization: `KakaoAK ${kakaoKey}` } },
      );
      if (!res.ok) {
        console.log("[extract] kakao search", {
          query,
          queryIndex,
          stage,
          hit: false,
          status: res.status,
        });
        return null;
      }
      const data = (await res.json()) as { documents?: Doc[] };
      return data.documents ?? [];
    } catch {
      console.log("[extract] kakao search", {
        query,
        queryIndex,
        stage,
        hit: false,
        reason: "exception",
      });
      return null;
    }
  };

  const logPick = (
    pick: PickKind,
    lookup: KakaoPlaceLookup,
    meta: { query: string; queryIndex: number; stage: string; candidates: number },
  ) => {
    console.log("[extract] kakao search", {
      pick,
      hint: hintTrimmed || undefined,
      candidates: meta.candidates,
      placeName: lookup.placeName,
      query: meta.query,
      queryIndex: meta.queryIndex,
      stage: meta.stage,
      hit: true,
      address: lookup.roadAddress,
    });
  };

  /** 결과 목록에서 hint 우선 → hint+상호명 재검색 → documents[0] */
  const pickFromDocuments = async (
    docs: Doc[],
    query: string,
    queryIndex: number,
    stage: string,
  ): Promise<KakaoPlaceLookup | null> => {
    if (hintTrimmed) {
      const matched = docs.find((d) => addressIncludesHint(d, hintTrimmed));
      if (matched) {
        const lookup = toLookup(matched, queryIndex);
        if (lookup) {
          logPick("hint_match", lookup, {
            query,
            queryIndex,
            stage,
            candidates: docs.length,
          });
          return lookup;
        }
      }

      const hintQuery = `${hintTrimmed} ${trimmed}`.replace(/\s+/g, " ").trim();
      if (hintQuery && hintQuery !== query) {
        if (deadlineMs != null && Date.now() >= deadlineMs) {
          console.log("[extract] kakao search", {
            query: hintQuery,
            queryIndex,
            stage: `${stage}+hint_query`,
            hit: false,
            reason: "deadline",
          });
        } else {
          const hintDocs = await fetchDocuments(hintQuery, queryIndex, `${stage}+hint_query`);
          if (hintDocs && hintDocs.length > 0) {
            const lookup = toLookup(hintDocs[0]!, queryIndex);
            if (lookup) {
              logPick("hint_query", lookup, {
                query: hintQuery,
                queryIndex,
                stage: `${stage}+hint_query`,
                candidates: hintDocs.length,
              });
              return lookup;
            }
          }
        }
      }
    }

    const lookup = toLookup(docs[0]!, queryIndex);
    if (!lookup) {
      console.log("[extract] kakao search", {
        query,
        queryIndex,
        stage,
        hit: false,
        reason: "invalid_coords",
      });
      return null;
    }
    logPick("first", lookup, {
      query,
      queryIndex,
      stage,
      candidates: docs.length,
    });
    return lookup;
  };

  for (let i = 0; i < queries.length; i++) {
    const item = queries[i]!;
    if (deadlineMs != null && Date.now() >= deadlineMs) {
      console.log("[extract] kakao search", {
        query: item.query,
        queryIndex: i,
        stage: item.stage,
        hit: false,
        reason: "deadline",
      });
      return null;
    }
    const docs = await fetchDocuments(item.query, i, item.stage);
    if (docs == null) continue;
    if (docs.length === 0) {
      console.log("[extract] kakao search", {
        query: item.query,
        queryIndex: i,
        stage: item.stage,
        hit: false,
      });
      continue;
    }
    const picked = await pickFromDocuments(docs, item.query, i, item.stage);
    if (picked) return picked;
  }
  return null;
}

export async function scrapeInstagramCaption(url: string): Promise<string> {
  const token = process.env.APIFY_API_TOKEN;
  const actorId = process.env.APIFY_ACTOR_ID?.trim() || DEFAULT_APIFY_ACTOR_ID;
  if (!token) throw new Error("APIFY_API_TOKEN이 설정되지 않았습니다.");
  if (!actorId) throw new Error("APIFY actor ID가 설정되지 않았습니다.");

  const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`;
  const maxStartAttempts = 3;
  let runId: string | undefined;
  let datasetId: string | undefined;

  for (let attempt = 0; attempt < maxStartAttempts; attempt++) {
    const runRes = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directUrls: [url],
        resultsType: "posts",
        resultsLimit: 1,
      }),
    });

    if (runRes.ok) {
      const runData = (await runRes.json()) as {
        data?: { id?: string; defaultDatasetId?: string };
      };
      runId = runData.data?.id;
      datasetId = runData.data?.defaultDatasetId;
      break;
    }

    const runErrText = await runRes.text();
    const isConcurrent =
      /concurrent-runs-limit-exceeded/i.test(runErrText) || /concurrent/i.test(runErrText);
    console.error("[extract] Apify run failed", {
      status: runRes.status,
      statusText: runRes.statusText,
      runErrText,
      attempt: attempt + 1,
    });
    if (isConcurrent && attempt < maxStartAttempts - 1) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (isConcurrent) {
      throw new Error("concurrent-runs-limit-exceeded");
    }
    throw new Error("Apify 실행 실패: " + runErrText);
  }

  if (!runId) throw new Error("Apify run ID를 가져올 수 없습니다.");

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
    '반드시 JSON 배열만 반환하세요. 형식: [{"name":"장소명","hint":"동네명또는역이름","category":"맛집|카페|쇼핑|숙소|놀거리|여행지"}]',
    "hint는 반드시 캡션에 직접 언급된 동네명, 역이름, 구명 중 가장 구체적인 것 하나만 넣으세요.",
    "예: 망원동, 합정, 성수, 용산역 처럼 짧고 구체적인 지역명 하나만.",
    "절대로 서울, 한국 같은 넓은 지역명은 쓰지 마세요. 구체적인 동네명이 없으면 빈 문자열.",
    'category는 반드시 "맛집", "카페", "쇼핑", "숙소", "놀거리", "여행지" 중 하나만 사용하세요.',
    "카테고리는 장소의 주된 목적(먹는 곳 / 사는 곳 / 노는 곳 / 자는 곳 / 보는 곳)을 기준으로 가장 가까운 것을 고르세요. 애매하다고 맛집·카페로 몰지 마세요.",
    "맛집: 식사 중심 음식점(밥·요리 파는 곳). 레스토랑, 식당, 술집, 바.",
    "카페: 커피·음료·디저트 중심.",
    "쇼핑: 물건 파는 곳 전반 — 편집샵, 소품샵, 편집매장, 브랜드 스토어·플래그십, 팝업스토어, 쇼핑몰, 백화점, 패션·의류·잡화 매장, 라이프스타일 스토어, 복합 리테일 공간(예: 무신사 메가스토어). 이름에 매장/스토어/샵/메가스토어/플래그십/편집샵/소품샵/팝업이 있으면 쇼핑을 우선 고려하세요.",
    "숙소: 호텔·펜션·게스트하우스·숙박.",
    "놀거리: 노래방, 볼링장, 영화관, 오락실, 방탈출, 액티비티·체험, 전시·팝업 체험형.",
    "여행지: 관광명소, 공원, 랜드마크, 자연경관, 포토스팟.",
    "복합공간(카페+매장 등)은 주된 기능으로 판단하되, 매장·쇼핑 비중이 크면 쇼핑으로 분류하세요.",
    "게시물이 실제로 소개하는 장소만 추출한다.",
    "지나가듯 언급된 지명, 만나는 장소, 근처 랜드마크는 추출하지 않는다.",
    '예: "스타필드에서 만나서 ○○카페 갔어요" → ○○카페만 추출. 스타필드는 제외.',
    "백화점, 쇼핑몰, 역 이름 같은 큰 시설은 그 안의 특정 가게를 소개하는 경우에만 추출한다.",
    "확신이 없으면 넣지 않는다. 적게 뽑는 쪽이 낫다.",
    "카테고리는 그 장소의 주된 용도로 판단한다. 술집·바·전시·공연장은 카페가 아니다.",
    "",
    `caption: ${caption}`,
  ].join("\n");

  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      temperature: 0,
      system:
        'You must return only pure JSON array. Output format: [{"name":"...","hint":"...","category":"카페"}]. category must be exactly one of: 맛집, 카페, 쇼핑, 숙소, 놀거리, 여행지 (Korean strings). Do not include markdown, code fences, explanations, or any extra text.',
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
