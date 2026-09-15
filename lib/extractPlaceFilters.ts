/**
 * Extract place-candidate gates (account-handle / overseas / caption).
 * Used by both fresh Claude and reel_cache hit paths before Kakao.
 */

export const CAPTION_MIN_CHARS = 10;

/** Bump when account-handle / overseas rules change. Lazy filter ignores version for now. */
export const EXTRACT_PLACE_RULE_VERSION = 2;

const HANGUL_RE = /[\uAC00-\uD7A3]/;
const LATIN_RE = /[A-Za-z]/;
const HIRAGANA_RE = /[\u3040-\u309F]/;
const KATAKANA_RE = /[\u30A0-\u30FF]/;
const THAI_RE = /[\u0E00-\u0E7F]/;
const CYRILLIC_RE = /[\u0400-\u04FF]/;
const DEVANAGARI_RE = /[\u0900-\u097F]/;
const HAN_RE = /[\u4E00-\u9FFF]/;
/** Instagram-style handle: lowercase alnum with at least one . or _ segment */
const ACCOUNT_HANDLE_RE = /^[a-z0-9]+([._][a-z0-9]+)+$/;

/** Caption-only city hints (weak; never sole hard-block). */
export const OVERSEAS_CITY_HINTS = [
  "도쿄",
  "오사카",
  "후쿠오카",
  "교토",
  "요코하마",
  "나고야",
  "타이베이",
  "타이완",
  "대만",
  "방콕",
  "다낭",
  "하노이",
  "호치민",
  "파리",
  "뉴욕",
  "런던",
  "싱가포르",
  "홍콩",
  "상하이",
  "베이징",
  "오키나와",
  "삿포로",
  "tokyo",
  "osaka",
  "fukuoka",
  "taipei",
  "bangkok",
  "paris",
  "new york",
  "singapore",
] as const;

/**
 * Overseas district / area stems. If name contains stem + 점|본점 → hard overseas.
 * Expandable constant.
 */
export const OVERSEAS_BRANCH_DISTRICT_STEMS = [
  "우메다",
  "긴자",
  "시부야",
  "신주쿠",
  "난바",
  "하카타",
  "텐진",
  "타이베이",
  "시먼딩",
  "방콕",
  "다낭",
  "하노이",
  "호치민",
  "오사카",
  "도쿄",
  "후쿠오카",
  "교토",
  "요코하마",
  "梅田",
  "銀座",
  "渋谷",
  "新宿",
  "難波",
  "博多",
  "天神",
] as const;

/**
 * Tokens ending in 점 that are shop-type / ops labels, NOT location branches.
 * Separated so the list can grow without touching guard logic.
 */
export const NON_BRANCH_JEOM_TOKENS = [
  "잡화점",
  "직영점",
  "백화점",
  "면세점",
  "편의점",
  "서점",
  "매점",
  "상점",
  "음식점",
  "노점",
  "지점", // alone — not "○○지점" region forms; exact/endsWith handled below
  "대리점",
  "총판점",
  // legacy industry endings still excluded
  "휴게음식점",
  "즉석판매제조가공업",
  "양과점",
  "제과점",
  "다방점",
  "주점",
  "호프점",
  "분식점",
  "중식점",
  "일식점",
  "한식점",
  "횟집점",
  "판매점",
  "가맹점",
  "영업점",
  "할인점",
  "전문점",
  "출장점",
] as const;

export type PlaceCandidateIn = {
  name: string;
  hint: string;
  region: string | null;
  category: string;
};

export type OverseasVerdict =
  | { kind: "domestic" }
  /** Skip Kakao + POI entirely */
  | { kind: "hard"; reason: string }
  /** One Kakao attempt; on miss → overseas_unsupported */
  | { kind: "soft"; reason: string };

export type OverseasResolve = {
  verdict: OverseasVerdict;
  /** Name to send to Kakao (paren-stripped when bilingual). Display name stays Claude's. */
  kakaoQueryName: string;
};

export function classifyCaption(caption: string): "ok" | "empty" | "too_short" {
  const t = (caption ?? "").trim();
  if (!t) return "empty";
  if (t.length < CAPTION_MIN_CHARS) return "too_short";
  return "ok";
}

/**
 * Instagram account id heuristic (all four must hold):
 * no Hangul, no spaces, has . or _, all lowercase, matches ACCOUNT_HANDLE_RE.
 */
export function isInstagramAccountHandle(name: string): boolean {
  const t = (name ?? "").trim();
  if (!t) return false;
  if (HANGUL_RE.test(t)) return false;
  if (/\s/.test(t)) return false;
  if (!/[._]/.test(t)) return false;
  if (/[A-Z]/.test(t)) return false;
  return ACCOUNT_HANDLE_RE.test(t);
}

export function captionHasOverseasCityHint(caption: string | null | undefined): boolean {
  const c = (caption ?? "").toLowerCase();
  if (!c) return false;
  return OVERSEAS_CITY_HINTS.some((h) => c.includes(h.toLowerCase()));
}

function hasForeignScript(s: string): boolean {
  return (
    HIRAGANA_RE.test(s) ||
    KATAKANA_RE.test(s) ||
    THAI_RE.test(s) ||
    CYRILLIC_RE.test(s) ||
    DEVANAGARI_RE.test(s)
  );
}

function hasDomesticScript(s: string): boolean {
  return HANGUL_RE.test(s) || LATIN_RE.test(s);
}

function foreignScriptReason(s: string): string {
  if (HIRAGANA_RE.test(s) || KATAKANA_RE.test(s)) return "kana_outside";
  if (THAI_RE.test(s)) return "thai_outside";
  if (CYRILLIC_RE.test(s)) return "cyrillic_outside";
  if (DEVANAGARI_RE.test(s)) return "devanagari_outside";
  return "foreign_outside";
}

/** Split paren/bracket contents from outside text. */
export function splitParenParts(name: string): { outside: string; insides: string[] } {
  const insides: string[] = [];
  const outside = (name || "")
    .replace(/[\(\[（]([^\)\]）]*)[\)\]）]/g, (_m, inner: string) => {
      const t = String(inner || "").trim();
      if (t) insides.push(t);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { outside, insides };
}

function compact(s: string): string {
  return (s || "").replace(/\s+/g, "").toLowerCase();
}

/** True if name has overseas district stem + 점/본점 (e.g. 긴자점, 梅田…店). */
export function hasOverseasDistrictBranch(name: string): boolean {
  const raw = (name || "").trim();
  if (!raw) return false;
  const n = compact(raw);
  for (const stem of OVERSEAS_BRANCH_DISTRICT_STEMS) {
    const s = compact(stem);
    if (!s) continue;
    // stem + 점 / 본점 / 店
    if (n.includes(`${s}점`) || n.includes(`${s}본점`) || n.includes(`${s}店`)) {
      return true;
    }
  }
  return false;
}

/** True if token is a non-location ○○점 (잡화점, 1호점, 지점, …). */
export function isNonBranchJeomToken(token: string): boolean {
  const t = token.replace(/\s+/g, "");
  if (!t) return false;
  // N호점 (1호점, 2호점, …) — not a district branch
  if (/^\d+호점$/.test(t)) return true;
  if (t === "지점") return true;
  return NON_BRANCH_JEOM_TOKENS.some((s) => t === s || (s !== "지점" && t.endsWith(s)));
}

function isIndustryJeomToken(token: string): boolean {
  return isNonBranchJeomToken(token);
}

/**
 * Branch tags like 강남점 / 본점 from a place name (not shop-type ○○점 / N호점).
 */
export function extractBranchTags(name: string): string[] {
  const { outside } = splitParenParts(name);
  const base = outside || name.trim();
  const tokens = base.split(/\s+/).filter(Boolean);
  const tags: string[] = [];
  const push = (t: string) => {
    const x = t.trim();
    if (!x || isNonBranchJeomToken(x)) return;
    if (!tags.includes(x)) tags.push(x);
  };
  for (const tok of tokens) {
    if (tok === "본점") {
      push(tok);
      continue;
    }
    if (tok.endsWith("본점") && tok.length > 2 && !isNonBranchJeomToken(tok)) {
      push(tok);
      continue;
    }
    if (tok.endsWith("점") && tok.length >= 2 && tok !== "점") {
      push(tok);
    }
  }
  return tags;
}

/** Whether Kakao place_name carries the same branch tag/stem as the extracted name. */
export function kakaoPlaceNameMatchesBranch(
  extractedName: string,
  kakaoPlaceName: string,
): boolean {
  const queryTags = extractBranchTags(extractedName);
  if (queryTags.length === 0) return false;
  const kakaoCompact = compact(kakaoPlaceName || "");
  if (!kakaoCompact) return false;
  for (const tag of queryTags) {
    const c = compact(tag);
    if (c && kakaoCompact.includes(c)) return true;
    const stem = branchStemFromTag(tag);
    if (stem.length >= 2 && kakaoCompact.includes(stem)) return true;
  }
  return false;
}

/**
 * Nickname / colloquial branch stems → address substrings that count as a match.
 * Stems not listed here are allowed when Kakao place_name has no branch tag
 * (unknown regions are not blocked).
 */
export const BRANCH_REGION_ALIASES: Record<string, readonly string[]> = {
  홍대: ["홍대", "서교동", "동교동", "홍익로", "와우산로", "어울마당로"],
  연남: ["연남", "연남동", "동교동", "성미산로", "월드컵북로"],
  합정: ["합정", "합정동", "독막로", "양화로"],
  망원: ["망원", "망원동", "포은로", "월드컵로"],
  성수: ["성수", "성수동", "서울숲", "아차산로", "뚝섬로"],
  건대: ["건대", "화양동", "능동", "군자로", "동일로"],
  강남: ["강남", "강남구", "역삼", "테헤란", "강남대로", "봉은사로"],
  역삼: ["역삼", "역삼동", "테헤란로"],
  선릉: ["선릉", "역삼동", "삼성동", "테헤란로"],
  삼성: ["삼성", "삼성동", "영동대로", "봉은사로", "테헤란로"],
  압구정: ["압구정", "압구정동", "신사동", "도산대로", "압구정로"],
  신사: ["신사", "신사동", "도산대로", "가로수길", "압구정로"],
  청담: ["청담", "청담동", "도산대로", "압구정로"],
  한남: ["한남", "한남동", "이태원", "독서당로", "한남대로"],
  이태원: ["이태원", "이태원동", "녹사평", "보광동"],
  대학로: ["대학로", "혜화", "혜화동", "명륜", "동숭동", "성균관로"],
  안국: ["안국", "안국동", "삼청", "율곡로", "북촌"],
  종로: ["종로", "종로구", "청진", "관철", "공평"],
  명동: ["명동", "명동길", "충무로", "남대문로"],
  을지로: ["을지로", "을지로동", "입정동"],
  여의도: ["여의도", "여의도동", "의사당대로", "국제금융로"],
  잠실: ["잠실", "잠실동", "송파", "올림픽로", "백제고분로"],
  송파: ["송파", "송파구", "잠실", "백제고분로", "올림픽로"],
  홍대입구: ["홍대", "서교동", "동교동", "홍익로"],
  경리단: ["경리단", "이태원", "녹사평대로", "회나무로"],
  해방촌: ["해방촌", "용산동", "신흥로", "신흥시장"],
  성신: ["성신", "성신여대", "동선동", "동소문로"],
  성신여대: ["성신", "성신여대", "동선동", "동소문로"],
  신촌: ["신촌", "창천동", "연희", "연세로", "신촌역"],
  이대: ["이대", "대현동", "이화여대", "이화여대길"],
  노량진: ["노량진", "노량진동", "장승배기로", "노들로"],
  영등포: ["영등포", "영등포동", "영중로", "당산"],
  문래: ["문래", "문래동", "도림", "경인로"],
  구로: ["구로", "구로동", "구로디지털", "디지털로"],
  판교: ["판교", "삼평동", "백현동", "판교역로", "대왕판교로"],
  수원: ["수원", "수원시", "인계", "행궁", "매산"],
  부산: ["부산", "부산광역시", "해운대", "서면", "남포"],
  서면: ["서면", "부전동", "전포", "서전로"],
  해운대: ["해운대", "해운대구", "우동", "중동", "달맞이"],
  광안: ["광안", "광안동", "수영", "광남로"],
  전포: ["전포", "전포동", "서면", "전포대로"],
};

function branchStemFromTag(tag: string): string {
  const c = compact(tag);
  if (c.endsWith("본점")) return c.slice(0, -2);
  if (c.endsWith("점")) return c.slice(0, -1);
  return c;
}

function addressMatchesBranchStem(stem: string, address: string): boolean {
  const addr = compact(address);
  if (!stem || !addr) return false;
  if (addr.includes(stem)) return true;
  const aliases = BRANCH_REGION_ALIASES[stem];
  if (!aliases) return false;
  return aliases.some((a) => {
    const x = compact(a);
    return x.length >= 2 && addr.includes(x);
  });
}

/**
 * Kakao path branch-tag guard (softened after dry-run regression measure).
 *
 * (a) Extracted ○○점 / 본점 must match Kakao place_name when Kakao also has a branch tag
 *     (different branch → reject).
 * (b) If Kakao place_name has no branch tag: do not reject for missing tag alone.
 *     Compare branch stem to Kakao address (+ alias map). Unknown stems → allow.
 *     Overseas district stems → reject without address check.
 */
export function kakaoBranchTagAcceptable(
  extractedName: string,
  kakaoPlaceName: string,
  kakaoAddress: string = "",
): boolean {
  const queryTags = extractBranchTags(extractedName);
  if (queryTags.length === 0) return true;

  const kakao = (kakaoPlaceName || "").trim();
  if (!kakao) return false;
  const kakaoCompact = compact(kakao);
  const kakaoTags = extractBranchTags(kakao);

  // Any query branch tag (or its stem) must appear in Kakao place_name → accept
  for (const tag of queryTags) {
    const c = compact(tag);
    if (c && kakaoCompact.includes(c)) return true;
    const stem = branchStemFromTag(tag);
    if (stem.length >= 2 && kakaoCompact.includes(stem)) return true;
  }

  // (a) Kakao has a different branch tag → reject
  if (kakaoTags.length > 0) return false;

  // (b) Kakao place_name has no branch tag → address / overseas check
  const addr = (kakaoAddress || "").trim();
  for (const tag of queryTags) {
    const stem = branchStemFromTag(tag);
    if (!stem || stem.length < 2) continue;

    // Overseas district branch stems → reject (same list as B-2 §4)
    if (
      OVERSEAS_BRANCH_DISTRICT_STEMS.some((s) => compact(s) === stem) ||
      OVERSEAS_BRANCH_DISTRICT_STEMS.some((s) => stem.includes(compact(s)) && compact(s).length >= 2)
    ) {
      return false;
    }

    // 본점 alone, or unmapped region stems → allow
    if (tag === "본점") return true;
    if (!(stem in BRANCH_REGION_ALIASES)) return true;

    // Mapped region: require address hit
    if (addressMatchesBranchStem(stem, addr)) return true;
  }

  // All query tags were mapped regions that missed the address
  const anyMapped = queryTags.some((tag) => {
    const stem = branchStemFromTag(tag);
    return stem.length >= 2 && stem in BRANCH_REGION_ALIASES;
  });
  if (!anyMapped) return true;
  return false;
}

/**
 * B-2 overseas rules + paren bilingual strip for Kakao query.
 */
export function resolveOverseasForKakao(
  name: string,
  _opts?: { caption?: string | null },
): OverseasResolve {
  const t = (name ?? "").trim();
  if (!t) return { verdict: { kind: "domestic" }, kakaoQueryName: t };

  if (hasOverseasDistrictBranch(t)) {
    return {
      verdict: { kind: "hard", reason: "overseas_district_branch" },
      kakaoQueryName: t,
    };
  }

  const { outside, insides } = splitParenParts(t);
  const outsideText = outside || t;
  const foreignOut = hasForeignScript(outsideText);
  const foreignIn = insides.some((x) => hasForeignScript(x));
  const domesticOut = hasDomesticScript(outsideText);

  // (2) foreign script outside paren → hard block
  if (foreignOut) {
    return {
      verdict: { kind: "hard", reason: foreignScriptReason(outsideText) },
      kakaoQueryName: t,
    };
  }

  // (1) bilingual paren: domestic outside, foreign only inside → query outside only
  let kakaoQueryName = outsideText.trim() || t;
  if (!foreignOut && foreignIn && domesticOut) {
    kakaoQueryName = outsideText.trim();
  }

  // (3) Han-only (no Hangul) on the Kakao query string → soft (1 attempt)
  const q = kakaoQueryName;
  if (!HANGUL_RE.test(q) && HAN_RE.test(q) && q.replace(/\s+/g, "").length >= 2) {
    // If query still somehow has foreign script, hard (shouldn't after above)
    if (hasForeignScript(q)) {
      return {
        verdict: { kind: "hard", reason: foreignScriptReason(q) },
        kakaoQueryName: q,
      };
    }
    return {
      verdict: { kind: "soft", reason: "han_only" },
      kakaoQueryName: q,
    };
  }

  return { verdict: { kind: "domestic" }, kakaoQueryName };
}

/** @deprecated use resolveOverseasForKakao */
export function detectOverseasPlace(
  name: string,
  opts?: { caption?: string | null },
): OverseasVerdict {
  return resolveOverseasForKakao(name, opts).verdict;
}

export type PreparedKakaoCandidates<T extends PlaceCandidateIn> = {
  /** Ready for Kakao (domestic + soft). Soft flagged via overseasSoftNames. */
  candidates: Array<T & { kakaoQueryName: string }>;
  /** Hard overseas — never call Kakao or POI */
  hardOverseas: T[];
  /** Names among candidates that get at most 1 Kakao attempt */
  softOverseasNames: Set<string>;
  droppedHandles: string[];
  /** After handle filter, zero candidates and at least one handle was dropped */
  onlyAccountHandles: boolean;
};

/**
 * Single gate before Kakao: drop account handles, split overseas, set kakaoQueryName.
 */
export function preparePlaceCandidatesForKakao<T extends PlaceCandidateIn>(
  items: T[],
  opts?: { caption?: string | null },
): PreparedKakaoCandidates<T> {
  const droppedHandles: string[] = [];
  const kept: T[] = [];
  for (const item of items) {
    const name = (item.name ?? "").trim();
    if (!name) continue;
    if (isInstagramAccountHandle(name)) {
      droppedHandles.push(name);
      console.log("[extract] place_filter drop", {
        kind: "account_handle",
        reason: "instagram_handle",
        name,
      });
      continue;
    }
    kept.push(item);
  }

  if (kept.length === 0) {
    return {
      candidates: [],
      hardOverseas: [],
      softOverseasNames: new Set(),
      droppedHandles,
      onlyAccountHandles: droppedHandles.length > 0,
    };
  }

  const hardOverseas: T[] = [];
  const candidates: Array<T & { kakaoQueryName: string }> = [];
  const softOverseasNames = new Set<string>();

  for (const item of kept) {
    const resolved = resolveOverseasForKakao(item.name, { caption: opts?.caption });
    if (resolved.verdict.kind === "hard") {
      hardOverseas.push(item);
      console.log("[extract] place_filter overseas", {
        kind: "hard",
        reason: resolved.verdict.reason,
        name: item.name.trim(),
      });
      continue;
    }
    if (resolved.verdict.kind === "soft") {
      softOverseasNames.add(item.name.trim());
      console.log("[extract] place_filter overseas", {
        kind: "soft",
        reason: resolved.verdict.reason,
        name: item.name.trim(),
        kakaoQueryName: resolved.kakaoQueryName,
      });
    } else if (resolved.kakaoQueryName !== item.name.trim()) {
      console.log("[extract] place_filter paren_strip", {
        name: item.name.trim(),
        kakaoQueryName: resolved.kakaoQueryName,
      });
    }
    candidates.push({ ...item, kakaoQueryName: resolved.kakaoQueryName });
  }

  return {
    candidates,
    hardOverseas,
    softOverseasNames,
    droppedHandles,
    onlyAccountHandles: false,
  };
}

/** Lazy-clean cached claude_places — drop account handles only. */
export function filterCachedClaudePlaces<T extends { name?: unknown }>(
  places: T[] | null | undefined,
): { cleaned: T[]; droppedHandles: number } {
  if (!Array.isArray(places)) return { cleaned: [], droppedHandles: 0 };
  const cleaned: T[] = [];
  let droppedHandles = 0;
  for (const p of places) {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!name) continue;
    if (isInstagramAccountHandle(name)) {
      droppedHandles += 1;
      console.log("[extract] place_filter drop", {
        kind: "account_handle",
        reason: "cached_lazy",
        name,
      });
      continue;
    }
    cleaned.push(p);
  }
  return { cleaned, droppedHandles };
}

export function kakaoMissCacheKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
