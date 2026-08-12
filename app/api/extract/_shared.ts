export const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_APIFY_ACTOR_ID = "apify~instagram-post-scraper";
export type ClaudeCategory = "맛집" | "카페" | "쇼핑" | "숙소" | "놀거리" | "여행지";
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
  /** 0=1차 원본 쿼리, 1+=폴백 */
  queryIndex: number;
};

function stripKakaoBranchSuffix(name: string): string {
  return name.replace(/\s+[^\s]+점$/u, "").trim();
}

function regionFromKakaoHint(hint: string): string {
  return (
    hint.replace(/[-~]/g, " ").split(/[\s,]+/).find((w) => w.length >= 2 && /[가-힣]/.test(w)) ?? ""
  );
}

function normalizePlaceNameKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]【】·・.'"`ʼʹ]/g, "")
    .replace(/점$/u, "");
}

/** 이름 정합: 정규화 후 동일, 또는 공식 지점 수식어가 붙은 확장만 허용(느슨한 부분일치 거부). */
function isExactKakaoNameMatch(queryName: string, placeName: string): boolean {
  const q = normalizePlaceNameKey(queryName);
  const p = normalizePlaceNameKey(placeName);
  if (!q || !p) return false;
  if (q === p) return true;
  const q2 = normalizePlaceNameKey(stripKakaoBranchSuffix(queryName));
  if (q2 && q2 === p) return true;
  // 예: 검색 "오일리버거잠실" → 결과 "오일리버거잠실석촌호수직영점"
  const branchSuffixOk = (base: string) =>
    Boolean(base) &&
    p.startsWith(base) &&
    p.length - base.length <= 16 &&
    /점$/.test(p);
  return branchSuffixOk(q) || branchSuffixOk(q2);
}

const KR_AREA_SHORT = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "제주",
  "성수", "성수동", "홍대", "연남", "합정", "망원", "이태원", "한남", "잠실", "여의도",
  "판교", "해운대", "광안리", "서면", "강남", "역삼", "선릉", "삼성", "청담", "압구정",
  "신사", "명동", "을지로", "종로", "인사동", "삼청", "북촌", "서촌", "건대", "신촌",
  "마포", "영등포", "노량진", "혜화", "속초", "강릉", "여수", "경주", "전주", "수원",
];

function collectExpectedRegions(caption: string, hint: string, placeName: string): string[] {
  const regions = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim();
    if (t.length >= 2) regions.add(t);
  };
  const fromHint = regionFromKakaoHint(hint);
  if (fromHint) add(fromHint);
  for (const a of KR_AREA_SHORT) {
    if (caption.includes(a)) add(a);
  }
  for (const m of caption.matchAll(/([가-힣]{2,12}(?:시|군|구|동|읍|면))/g)) {
    add(m[1]);
  }
  const branch = placeName.match(/([^\s]+)점$/u)?.[1];
  if (branch && branch.length >= 2 && /[가-힣]/.test(branch)) add(branch);
  return [...regions];
}

function addressMatchesExpectedRegions(address: string, regions: string[]): boolean {
  if (regions.length === 0) return true;
  const compact = address.replace(/\s+/g, "");
  return regions.some((r) => compact.includes(r.replace(/\s+/g, "")));
}

export type SearchKakaoPlaceOptions = {
  /** epoch ms — 넘기면 남은 폴백 쿼리 중단 */
  deadlineMs?: number;
};

/**
 * 카카오 키워드 검색 — 쿼리 폴백은 순차(1차 히트 시 즉시 종료).
 * size=5로 후보를 보고 이름+지역 정합을 통과한 첫 문서를 채택.
 * @param hint 기존 호출 호환용(Claude hint). region 미지정 시 지역명 후보로 사용.
 * @param region 알고 있는 지역명(선택). 있으면 5차 폴백에 우선 사용.
 * @param caption 캡션(선택). 지역 정합 검증에 사용.
 */
export async function searchKakaoPlace(
  name: string,
  hint: string = "",
  region?: string,
  caption: string = "",
  options?: SearchKakaoPlaceOptions,
): Promise<KakaoPlaceLookup | null> {
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) return null;

  const trimmed = name.trim();
  if (!trimmed) return null;

  const deadlineMs = options?.deadlineMs;
  const noSpace = trimmed.replace(/\s+/g, "");
  const withoutBranch = stripKakaoBranchSuffix(trimmed);
  const withoutBranchNoSpace = withoutBranch.replace(/\s+/g, "");
  const regionName = (region?.trim() || regionFromKakaoHint(hint)).trim();
  const expectedRegions = collectExpectedRegions(caption, hint, trimmed);
  if (regionName) expectedRegions.push(regionName);
  const regionsUnique = [...new Set(expectedRegions)];

  const queries: string[] = [];
  const pushUnique = (q: string) => {
    const t = q.trim();
    if (!t) return;
    if (!queries.includes(t)) queries.push(t);
  };

  // 1차: 원본 / 2차: 공백 제거 / 3차: ○○점 제거 / 4차: 지점+공백 제거 / 5차: 지역 붙이기
  pushUnique(trimmed);
  pushUnique(noSpace);
  pushUnique(withoutBranch);
  pushUnique(withoutBranchNoSpace);
  if (regionName) {
    pushUnique(`${trimmed} ${regionName}`);
  }

  type Doc = {
    place_name?: string;
    address_name: string;
    road_address_name: string;
    x: string;
    y: string;
  };

  const pickFromDocs = (
    docs: Doc[],
    query: string,
    queryIndex: number,
  ): KakaoPlaceLookup | null => {
    let sawNameMatch = false;
    for (const doc of docs) {
      const placeName = (doc.place_name || "").trim();
      const address = doc.road_address_name || doc.address_name || "";
      const lat = parseFloat(doc.y);
      const lng = parseFloat(doc.x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (!isExactKakaoNameMatch(trimmed, placeName)) continue;
      sawNameMatch = true;

      const regionOk = addressMatchesExpectedRegions(address, regionsUnique);
      // 폴백(2차~)은 지역 힌트가 있을 때만 채택. 지역 힌트 없으면 1차만 허용.
      if (queryIndex >= 1) {
        if (regionsUnique.length === 0 || !regionOk) continue;
      } else if (regionsUnique.length > 0 && !regionOk) {
        continue;
      }

      console.log("[extract] kakao search", { query, queryIndex, hit: true, placeName, address });
      return {
        address: doc.address_name,
        roadAddress: doc.road_address_name || doc.address_name,
        lat,
        lng,
        placeName,
        queryIndex,
      };
    }

    if (docs.length === 0) {
      console.log("[extract] kakao search", { query, queryIndex, hit: false });
    } else if (!sawNameMatch) {
      console.log("[extract] kakao search", {
        query,
        queryIndex,
        hit: false,
        reason: "name_mismatch",
        placeName: (docs[0]?.place_name || "").trim(),
      });
    } else {
      console.log("[extract] kakao search", {
        query,
        queryIndex,
        hit: false,
        reason: queryIndex >= 1 ? "fallback_region_strict" : "region_mismatch",
        placeName: (docs[0]?.place_name || "").trim(),
        address: docs[0]?.road_address_name || docs[0]?.address_name,
        regions: regionsUnique,
      });
    }
    return null;
  };

  const lookupOnce = async (
    query: string,
    queryIndex: number,
  ): Promise<KakaoPlaceLookup | null> => {
    try {
      const res = await fetch(
        `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=5`,
        { headers: { Authorization: `KakaoAK ${kakaoKey}` } },
      );
      if (!res.ok) {
        console.log("[extract] kakao search", { query, queryIndex, hit: false, status: res.status });
        return null;
      }
      const data = (await res.json()) as { documents?: Doc[] };
      return pickFromDocs(data.documents ?? [], query, queryIndex);
    } catch {
      console.log("[extract] kakao search", { query, queryIndex, hit: false, reason: "exception" });
      return null;
    }
  };

  for (let i = 0; i < queries.length; i++) {
    if (deadlineMs != null && Date.now() >= deadlineMs) {
      console.log("[extract] kakao search", {
        query: queries[i],
        queryIndex: i,
        hit: false,
        reason: "deadline",
      });
      return null;
    }
    const result = await lookupOnce(queries[i]!, i);
    if (result) return result; // 1차(또는 n차) 히트 시 나머지 폴백 건너뜀
  }
  return null;
}

export async function scrapeInstagramCaption(url: string): Promise<string> {
  const token = process.env.APIFY_API_TOKEN;
  const actorId = process.env.APIFY_ACTOR_ID?.trim() || DEFAULT_APIFY_ACTOR_ID;
  if (!token) throw new Error("APIFY_API_TOKEN이 설정되지 않았습니다.");
  if (!actorId) throw new Error("APIFY actor ID가 설정되지 않았습니다.");

  const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`;

  const runRes = await fetch(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: [url],
      resultsType: "posts",
      resultsLimit: 1,
    }),
  });

  if (!runRes.ok) {
    const runErrText = await runRes.text();
    console.error("[extract] Apify run failed", { status: runRes.status, statusText: runRes.statusText, runErrText });
    throw new Error("Apify 실행 실패: " + runErrText);
  }
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
