/**
 * POI 좌표 재매칭 규칙 (앱·배치 공용).
 * 규칙 데이터: lib/poiMatch.rules.json
 * Python 배치는 동일 JSON을 읽고 scripts/localdata/poi_match.py 로 동일 알고리즘을 사용한다.
 */
import rules from "./poiMatch.rules.json";

export type MatchReason = "sim" | "contain" | "strip";
export type ExcludeReason =
  | "facility_keyword"
  | "franchise_prefix"
  | "distance"
  | "reverse_contain";

export type MatchCandidate = {
  placeName: string;
  placeNorm: string;
  poiName: string;
  poiNorm: string;
  simRaw: number;
  distM: number;
};

export type MatchScore = {
  score: number;
  reason: MatchReason;
};

export type MatchPick = MatchScore & {
  distM: number;
  excluded?: ExcludeReason;
};

const FACILITY_SUFFIXES = [...rules.facilitySuffixes].sort(
  (a, b) => b.length - a.length,
);
const FACILITY_EXACT_END = new Set(rules.facilityExactEnd);
const FRANCHISE_PREFIXES = [...rules.franchisePrefixes].sort(
  (a, b) => b.length - a.length,
);
const INDUSTRY_PREFIXES = [...rules.industryPrefixes].sort(
  (a, b) => b.length - a.length,
);
const REGION_PREFIXES = new Set(rules.regionPrefixes);

const ROUTING_PAIRS: Array<{ kw: string; source: string }> = Object.entries(
  rules.facilityRouting ?? {},
)
  .flatMap(([source, kws]) =>
    (kws as string[]).map((kw) => ({ kw, source })),
  )
  .sort((a, b) => b.kw.length - a.kw.length);

const PARK_GENERIC_SUFFIXES = [...(rules.parkGenericSuffixes ?? [])].sort(
  (a, b) => b.length - a.length,
);
const PARK_GENERIC_MAX_M = rules.parkGenericMaxM ?? 200;
const ROUTING_CAPS = rules.facilityRoutingCaps ?? {
  simGe90OrExact: 500,
  sim70to90: 300,
  contain: 300,
};

export const POI_MATCH_RADIUS_M = rules.radiusM;
export const POI_MATCH_BBOX_DEG = rules.bboxDeg;
export const POI_ROUTING_RADIUS_M = rules.facilityRoutingRadiusM ?? 500;
export const POI_ROUTING_BBOX_DEG = rules.facilityRoutingBboxDeg ?? 0.006;

export function normalizePoiName(raw: string): string {
  let s = (raw || "").trim();
  // strip (...) and （...） repeatedly
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, "").replace(/（[^）]*）/g, "");
  }
  s = s.replace(/[·,&/\-_.''"`~!@#$%^*+=?<>[\]{}|\\:;]/g, "");
  s = s.replace(/\s+/g, "");
  return s.toLowerCase();
}

function stripParens(text: string): string {
  let prev: string | null = null;
  let cur = text;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(/\([^()]*\)/g, "").replace(/（[^）]*）/g, "");
  }
  return cur;
}

/** 접사·괄호·지역접두 제거 후 비교용 */
export function softNormalizeDisplay(name: string): string {
  let s = stripParens((name || "").trim());
  s = s.replace(/\s+/g, " ").trim();
  let tokens = s.split(" ").filter(Boolean);
  while (tokens.length && REGION_PREFIXES.has(tokens[0]!)) {
    tokens = tokens.slice(1);
  }
  if (tokens.length && tokens[tokens.length - 1] === "본점") {
    tokens = tokens.slice(0, -1);
  }
  const last = tokens[tokens.length - 1];
  if (last && last.endsWith("점") && last !== "점") {
    tokens = tokens.slice(0, -1);
  }
  s = tokens.join("");
  if (s.endsWith("본점") && s.length > 2) {
    s = s.slice(0, -2);
  }
  s = s.replace(/[·,&/\-_.''"`~!@#$%^*+=?<>[\]{}|\\:;]/g, "");
  return s.toLowerCase();
}

export function containsNorm(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

function compactPlaceName(placeName: string): string {
  return (placeName || "").replace(/\s+/g, "").trim();
}

/** Starts with industry prefix (카페/커피/식당/…) → never facility-route. */
export function startsWithIndustryPrefix(placeName: string): boolean {
  const n = compactName(placeName);
  if (!n) return false;
  for (const pref of INDUSTRY_PREFIXES) {
    const p = pref.toLowerCase();
    if (n.startsWith(p) && n.length > p.length) return true;
  }
  return false;
}

/** Letter-script majority: hangul | latin | null (no letters / no majority). */
export function scriptMajority(raw: string): "hangul" | "latin" | null {
  let hangul = 0;
  let latin = 0;
  for (const ch of raw || "") {
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch)) hangul += 1;
    else if (/[A-Za-z]/.test(ch)) latin += 1;
  }
  const total = hangul + latin;
  if (total === 0) return null;
  if (hangul > total / 2) return "hangul";
  if (latin > total / 2) return "latin";
  return null;
}

const REGION_TAG_EXACT = new Set([
  "강남",
  "성수",
  "홍대",
  "부산",
  "서울",
  "연남",
  "합정",
  "망원",
  "이태원",
  "한남",
  "을지로",
  "명동",
  "잠실",
  "여의도",
  "종로",
  "용산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "제주",
  "서면",
  "해운대",
  "전포",
  "건대",
  "신촌",
  "이대",
  "압구정",
  "청담",
  "삼성",
  "역삼",
  "선릉",
  "가로수길",
  "북촌",
  "서촌",
  "익선",
]);

const FACILITY_TAG_SUFFIXES = [
  "몰",
  "센터",
  "타워",
  "뮤지엄",
  "미술관",
  "박물관",
  "시청",
  "백화점",
  "아울렛",
  "터미널",
] as const;

/** Branch / location tag inside parens — do not use as match variant. */
export function isParenBranchTag(inside: string): boolean {
  const t = (inside || "").replace(/\s+/g, "").trim();
  if (!t) return true;
  if (t === "본점" || t === "지점" || t === "직영점") return true;
  if (t.endsWith("점") && t.length >= 2) return true; // 홍대점, 서울시청점, 을지로점
  if (REGION_TAG_EXACT.has(t)) return true;
  for (const suf of FACILITY_TAG_SUFFIXES) {
    if (t.endsWith(suf) && t.length > suf.length) return true;
  }
  return false;
}

/**
 * Display-name variants for scoring.
 * Always includes full string. Outside/inside paren splits only when:
 *  (가) outside vs inside have different letter-script majorities (hangul↔latin)
 *  (나) inside is not a branch/location tag
 * Same-script parens (both hangul or both latin) → no split.
 */
export function nameDisplayVariants(raw: string): string[] {
  const full = (raw || "").trim();
  if (!full) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  add(full);

  const insides: string[] = [];
  const re = /\(([^()]*)\)|（([^）]*)）/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(full))) {
    insides.push((m[1] ?? m[2] ?? "").trim());
  }
  if (!insides.length) return out;

  const outside = stripParens(full).trim();
  const outScript = scriptMajority(outside);
  for (const inn of insides) {
    if (isParenBranchTag(inn)) continue;
    const inScript = scriptMajority(inn);
    if (!outScript || !inScript || outScript === inScript) continue;
    // Cross-script alias only
    add(outside);
    add(inn);
  }
  return out;
}

/** 시설 라우팅 접미 → poi.source (없으면 null = 일반 경로) */
export function detectFacilityRoute(placeName: string): string | null {
  if (startsWithIndustryPrefix(placeName)) return null;

  const raw = (placeName || "").replace(/\s+/g, " ").trim();
  const n = compactPlaceName(placeName);
  if (!n) return null;
  const tokens = raw ? raw.split(" ").filter(Boolean) : [];

  for (const { kw, source } of ROUTING_PAIRS) {
    if (kw === "산") {
      // Only when last eoejeol is exactly ○○산 (avoid 부산/수산/남산 inside shop names).
      // Ambiguous cases may still route; resolvePlaceViaPoi falls back to general.
      if (!tokens.length) continue;
      const last = tokens[tokens.length - 1]!;
      if (!/^[0-9A-Za-z가-힣]{1,8}산$/.test(last)) continue;
      const earlier = tokens.slice(0, -1).map((t) => compactName(t));
      const industryHit = earlier.some((t) =>
        INDUSTRY_PREFIXES.some((pref) => {
          const p = pref.toLowerCase();
          return t === p || t.startsWith(p);
        }),
      );
      if (industryHit) continue;
      return source;
    }
    if (n.endsWith(kw)) return source;
  }
  return null;
}

/** park 일반명: 지정 접미 + 앞 수식어 1어절 이하 */
export function isParkGenericName(placeName: string): boolean {
  const raw = (placeName || "").replace(/\s+/g, " ").trim();
  if (!raw) return false;
  const compact = raw.replace(/\s+/g, "");
  for (const suf of PARK_GENERIC_SUFFIXES) {
    if (!compact.endsWith(suf)) continue;
    const prefixC = compact.slice(0, -suf.length);
    if (!prefixC) return true;
    const tokens = raw.split(" ").filter(Boolean);
    let built = "";
    let nPrefix = 0;
    for (const t of tokens) {
      if (built === prefixC) break;
      built += t.replace(/\s+/g, "");
      nPrefix += 1;
      if (built === prefixC) break;
    }
    if (built !== prefixC) nPrefix = 1;
    return nPrefix <= 1;
  }
  return false;
}

/** 차단(B) 시설 접미. 라우팅(A)이면 false. */
export function endsWithFacilityBlock(placeName: string): boolean {
  const n = compactPlaceName(placeName);
  if (!n) return false;
  if (detectFacilityRoute(placeName)) return false;
  for (const kw of FACILITY_SUFFIXES) {
    if (n.endsWith(kw)) return true;
  }
  for (const kw of FACILITY_EXACT_END) {
    if (n.endsWith(kw)) return true;
  }
  return false;
}

/** @deprecated 하위호환 — 차단 시설만 True (라우팅은 False) */
export function endsWithFacility(placeName: string): boolean {
  return endsWithFacilityBlock(placeName);
}

export function franchisePrefixBlocked(
  placeName: string,
  poiName: string,
): boolean {
  const placeCompact = (placeName || "").replace(/\s+/g, "").toLowerCase();
  const poiCompact = (poiName || "").replace(/\s+/g, "").toLowerCase();
  for (const brand of FRANCHISE_PREFIXES) {
    const brandKey = brand.replace(/\s+/g, "").toLowerCase();
    if (!brandKey) continue;
    if (!poiCompact.startsWith(brandKey)) continue;
    if (!placeCompact.includes(brandKey)) return true;
  }
  return false;
}

export function compactName(s: string): string {
  return (s || "").replace(/\s+/g, "").trim().toLowerCase();
}

export function stripIndustryPrefix(placeName: string): string {
  const n = compactName(placeName);
  for (const pref of INDUSTRY_PREFIXES) {
    const p = pref.toLowerCase();
    if (n.startsWith(p) && n.length > p.length) return n.slice(p.length);
  }
  return n;
}

/** True = 제외(reverse_contain) */
export function isReverseContain(
  placeNorm: string,
  poiNorm: string,
  placeName: string,
  poiName: string,
  moveM: number | null,
): boolean {
  const pn = (placeNorm || "").trim();
  const qn = (poiNorm || "").trim();
  if (!pn || !qn) return false;
  if (qn.length >= pn.length) return false;
  if (!pn.includes(qn)) return false;
  if (moveM == null) return false;
  const stripped = stripIndustryPrefix(placeName);
  const poiC = compactName(poiName);
  const poiN = compactName(qn);
  const industryExact =
    Boolean(stripped) && (stripped === poiC || stripped === poiN);
  if (industryExact) return moveM > rules.reverseContain.industryExactMaxM;
  return moveM > rules.reverseContain.maxM;
}

export function distanceCap(
  reason: MatchReason,
  sim: number,
  exact: boolean,
): number {
  if (reason === "sim") {
    if (exact || sim >= 90) return rules.distanceCaps.simGe90OrExact;
    return rules.distanceCaps.sim70to90;
  }
  if (reason === "contain") return rules.distanceCaps.contain;
  return rules.distanceCaps.strip;
}

export function routingDistanceCap(
  reason: MatchReason,
  sim: number,
  exact: boolean,
): number {
  if (reason === "sim") {
    if (exact || sim >= 90) return ROUTING_CAPS.simGe90OrExact;
    return ROUTING_CAPS.sim70to90;
  }
  return ROUTING_CAPS.contain;
}

/** difflib.SequenceMatcher.ratio 호환 (Ratcliff/Obershelp) */
export function sequenceRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const matching = matchingBlocks(a, b);
  let m = 0;
  for (const block of matching) m += block.size;
  return (2 * m) / (a.length + b.length);
}

function matchingBlocks(
  a: string,
  b: string,
): Array<{ a: number; b: number; size: number }> {
  const stack: Array<[number, number, number, number]> = [
    [0, a.length, 0, b.length],
  ];
  const blocks: Array<{ a: number; b: number; size: number }> = [];
  while (stack.length) {
    const [alo, ahi, blo, bhi] = stack.pop()!;
    const hit = findLongestMatch(a, alo, ahi, b, blo, bhi);
    if (hit.size) {
      blocks.push(hit);
      if (alo < hit.a && blo < hit.b) {
        stack.push([alo, hit.a, blo, hit.b]);
      }
      if (hit.a + hit.size < ahi && hit.b + hit.size < bhi) {
        stack.push([hit.a + hit.size, ahi, hit.b + hit.size, bhi]);
      }
    }
  }
  blocks.sort((x, y) => x.a - y.a || x.b - y.b);
  return blocks;
}

function findLongestMatch(
  a: string,
  alo: number,
  ahi: number,
  b: string,
  blo: number,
  bhi: number,
): { a: number; b: number; size: number } {
  let bestI = alo;
  let bestJ = blo;
  let bestSize = 0;
  const bIndex = new Map<string, number[]>();
  for (let j = blo; j < bhi; j++) {
    const ch = b[j]!;
    const arr = bIndex.get(ch);
    if (arr) arr.push(j);
    else bIndex.set(ch, [j]);
  }
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const next = new Map<number, number>();
    const indexes = bIndex.get(a[i]!) || [];
    for (const j of indexes) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const length = (j2len.get(j - 1) || 0) + 1;
      next.set(j, length);
      if (length > bestSize) {
        bestI = i - length + 1;
        bestJ = j - length + 1;
        bestSize = length;
      }
    }
    j2len = next;
  }
  return { a: bestI, b: bestJ, size: bestSize };
}

export function scoreCandidate(
  placeName: string,
  placeNorm: string,
  poiName: string,
  poiNorm: string,
  simRaw: number,
): MatchScore | null {
  const exact = Boolean(placeNorm) && placeNorm === poiNorm;

  if (simRaw >= 70 || exact) {
    return {
      score: exact ? Math.max(simRaw, 100) : simRaw,
      reason: "sim",
    };
  }

  if (containsNorm(placeNorm, poiNorm)) {
    const shorter = Math.min(placeNorm.length, poiNorm.length);
    const longer = Math.max(placeNorm.length, poiNorm.length) || 1;
    return {
      score: 70 + 30 * (shorter / longer),
      reason: "contain",
    };
  }

  const pa = softNormalizeDisplay(placeName);
  const pb = softNormalizeDisplay(poiName);
  if (pa.length >= 2 && pb.length >= 2) {
    const sim3 = sequenceRatio(pa, pb) * 100;
    if (sim3 >= 70) return { score: sim3, reason: "strip" };
    if (containsNorm(pa, pb)) {
      const shorter = Math.min(pa.length, pb.length);
      const longer = Math.max(pa.length, pb.length) || 1;
      return {
        score: 70 + 30 * (shorter / longer),
        reason: "strip",
      };
    }
  }
  return null;
}

/** 라우팅: sim(≥70)/contain 만. strip·sim<70 불가. */
export function scoreCandidateRouting(
  placeName: string,
  placeNorm: string,
  poiName: string,
  poiNorm: string,
  simRaw: number,
): MatchScore | null {
  const exact = Boolean(placeNorm) && placeNorm === poiNorm;
  if (simRaw >= 70 || exact) {
    return {
      score: exact ? Math.max(simRaw, 100) : simRaw,
      reason: "sim",
    };
  }
  if (containsNorm(placeNorm, poiNorm)) {
    const shorter = Math.min(placeNorm.length, poiNorm.length);
    const longer = Math.max(placeNorm.length, poiNorm.length) || 1;
    return {
      score: 70 + 30 * (shorter / longer),
      reason: "contain",
    };
  }
  return null;
}

export function applyFilters(
  placeName: string,
  placeNorm: string,
  poiName: string,
  poiNorm: string,
  score: number,
  reason: MatchReason,
  distM: number,
): ExcludeReason | null {
  if (franchisePrefixBlocked(placeName, poiName)) return "franchise_prefix";

  const facility = endsWithFacilityBlock(placeName);
  const exact = Boolean(placeNorm) && placeNorm === poiNorm;

  if (facility) {
    if (reason === "contain" || reason === "strip") return "facility_keyword";
    if (reason === "sim" && score < 95 && !exact) return "facility_keyword";
  }

  if (
    reason === "contain" &&
    isReverseContain(placeNorm, poiNorm, placeName, poiName, distM)
  ) {
    return "reverse_contain";
  }

  const cap = distanceCap(reason, score, exact);
  if (distM > cap) return "distance";
  return null;
}

/** 라우팅 경로: franchise/facility 차단 없음. 넓은 거리 상한. */
export function applyFiltersRouting(
  placeName: string,
  placeNorm: string,
  poiName: string,
  poiNorm: string,
  score: number,
  reason: MatchReason,
  distM: number,
): ExcludeReason | null {
  if (reason !== "sim" && reason !== "contain") return "distance";
  const exact = Boolean(placeNorm) && placeNorm === poiNorm;
  if (
    reason === "contain" &&
    isReverseContain(placeNorm, poiNorm, placeName, poiName, distM)
  ) {
    return "reverse_contain";
  }
  let cap = routingDistanceCap(reason, score, exact);
  if (
    detectFacilityRoute(placeName) === "park" &&
    isParkGenericName(placeName)
  ) {
    cap = Math.min(cap, PARK_GENERIC_MAX_M);
  }
  if (distM > cap) return "distance";
  return null;
}

export function evaluateCandidate(
  c: MatchCandidate,
  opts?: { routing?: boolean },
): MatchPick | null {
  const routing = Boolean(opts?.routing);
  const placeVars = nameDisplayVariants(c.placeName);
  const poiVars = nameDisplayVariants(c.poiName);
  // Fall back to provided norms when no variants (should not happen)
  if (!placeVars.length) placeVars.push(c.placeName);
  if (!poiVars.length) poiVars.push(c.poiName);

  let bestPass: MatchPick | null = null;
  let bestExcl: MatchPick | null = null;

  for (const placeVar of placeVars) {
    for (const poiVar of poiVars) {
      const placeNorm = normalizePoiName(placeVar);
      const poiNorm = normalizePoiName(poiVar);
      if (placeNorm.length < 2 || poiNorm.length < 2) continue;
      const simRaw = roughNameSimilarity(placeNorm, poiNorm);
      const scored = routing
        ? scoreCandidateRouting(placeVar, placeNorm, poiVar, poiNorm, simRaw)
        : scoreCandidate(placeVar, placeNorm, poiVar, poiNorm, simRaw);
      if (!scored) continue;

      // Franchise/facility checks use original display names; norms from winning pair.
      const blocked = routing
        ? applyFiltersRouting(
            c.placeName,
            placeNorm,
            c.poiName,
            poiNorm,
            scored.score,
            scored.reason,
            c.distM,
          )
        : applyFilters(
            c.placeName,
            placeNorm,
            c.poiName,
            poiNorm,
            scored.score,
            scored.reason,
            c.distM,
          );

      const pick: MatchPick = blocked
        ? { ...scored, distM: c.distM, excluded: blocked }
        : { ...scored, distM: c.distM };

      if (!pick.excluded) {
        if (
          !bestPass ||
          pick.score > bestPass.score ||
          (pick.score === bestPass.score && pick.distM < bestPass.distM)
        ) {
          bestPass = pick;
        }
      } else if (
        !bestExcl ||
        pick.score > bestExcl.score ||
        (pick.score === bestExcl.score && pick.distM < bestExcl.distM)
      ) {
        bestExcl = pick;
      }
    }
  }

  return bestPass ?? bestExcl;
}

export type PoiRow = {
  id: number;
  name: string;
  name_norm: string | null;
  lat: number;
  lng: number;
  road_address: string | null;
  jibun_address: string | null;
  category?: string | null;
  source?: string | null;
};

export type PlacePoiMatch = {
  poi: PoiRow;
  score: number;
  reason: MatchReason;
  distM: number;
};

/** 후보 POI 중 최고 매칭 1건 (필터 통과만). */
export function pickBestPoiMatch(
  placeName: string,
  placeNorm: string,
  candidates: Array<PoiRow & { distM: number; simRaw: number }>,
  opts?: { routing?: boolean },
): PlacePoiMatch | null {
  let best: PlacePoiMatch | null = null;
  for (const c of candidates) {
    const pick = evaluateCandidate(
      {
        placeName,
        placeNorm,
        poiName: c.name,
        poiNorm: c.name_norm || normalizePoiName(c.name),
        simRaw: c.simRaw,
        distM: c.distM,
      },
      opts,
    );
    if (!pick || pick.excluded) continue;
    if (
      !best ||
      pick.score > best.score ||
      (pick.score === best.score && pick.distM < best.distM)
    ) {
      best = {
        poi: c,
        score: pick.score,
        reason: pick.reason,
        distM: pick.distM,
      };
    }
  }
  return best;
}

export function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** trigram-ish proxy for client-side when DB similarity() unavailable */
export function roughNameSimilarity(a: string, b: string): number {
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  if (a === b) return 100;
  return sequenceRatio(a, b) * 100;
}

export function formatPlaceSourceLog(
  source: "poi" | "kakao",
  placeName: string,
): string {
  const safe = (placeName || "").replace(/\|/g, "/").trim();
  return `place_source|${source}|${safe}`;
}
