/**
 * Post-fail Kakao query rescue variants.
 * Used only after the existing 6-stage fallbacks + hint handling all miss.
 * Max 3 extra keyword calls per place name; never persist Kakao responses.
 */

export type StripBranchResult = {
  cleaned: string;
  /** Region stem peeled from a branch/region suffix (may be empty). */
  regionHint: string;
};

export type KakaoRescueAttempt = {
  query: string;
  stage: "rescue_strip" | "rescue_norm" | "rescue_hint";
  /** Hint used for adoption (address must include this when non-empty). */
  adoptHint: string;
  /** Name compared for exact place_name match when adoptHint is empty. */
  cleanedName: string;
};

const BRANCH_ONLY = /^(본점|지점|직영점|분점)$/;
/** Trailing token: 연남본점 / 성수점 / 익선동점 */
const BRANCH_WITH_REGION = /^(.+?)(본점|지점|직영점|분점|점)$/;
/** Trailing admin/region token without 점: 동대문구, 성수동, 홍대입구역 */
const REGION_TOKEN = /^[가-힣A-Za-z0-9]{2,12}(구|동|역|읍|면|리)$/;

function splitTail(name: string): { head: string; tail: string } | null {
  // Prefer space/underscore so tails like "광안리굿-7점" stay one token.
  let m = name.match(/^(.*)([\s_]+)([^\s_]+)$/u);
  if (m) {
    const head = (m[1] ?? "").trim();
    const tail = (m[3] ?? "").trim();
    if (head && tail) return { head, tail };
  }
  // Hyphen-only names: "가게-성수동"
  m = name.match(/^(.*)-([^-]+)$/u);
  if (m) {
    const head = (m[1] ?? "").trim();
    const tail = (m[2] ?? "").trim();
    if (head && tail) return { head, tail };
  }
  return null;
}

function regionFromBranchTail(tail: string): { ok: boolean; regionHint: string } {
  if (BRANCH_ONLY.test(tail)) return { ok: true, regionHint: "" };
  const m = tail.match(BRANCH_WITH_REGION);
  if (m) {
    const region = (m[1] ?? "").trim();
    if (!region) return { ok: false, regionHint: "" };
    return { ok: true, regionHint: region };
  }
  if (REGION_TOKEN.test(tail)) return { ok: true, regionHint: tail };
  return { ok: false, regionHint: "" };
}

/**
 * a) Strip branch / region suffixes only when separated by space, underscore, or hyphen.
 * Names like 홍콩반점 / 동네주점 stay unchanged (no separator before 점).
 */
export function stripBranchOrRegionSuffix(name: string): StripBranchResult {
  const trimmed = name.trim();
  if (!trimmed) return { cleaned: "", regionHint: "" };

  const parts = splitTail(trimmed);
  if (!parts) return { cleaned: trimmed, regionHint: "" };

  const peeled = regionFromBranchTail(parts.tail);
  if (!peeled.ok) return { cleaned: trimmed, regionHint: "" };
  if (parts.head.length < 2) return { cleaned: trimmed, regionHint: "" };

  return { cleaned: parts.head, regionHint: peeled.regionHint };
}

/**
 * b) Spacing removal, vol.* drop, latin case / specials cleanup.
 */
export function normalizePlaceQuery(name: string): string {
  let s = name.trim();
  if (!s) return "";
  s = s.replace(/\bvol\.?\s*\d+\b/gi, " ");
  s = s.replace(/\s+/g, "");
  s = s.toLowerCase();
  s = s.replace(/[^\p{Script=Hangul}a-z0-9]/gu, "");
  return s.trim();
}

export function shouldAdoptRescueResult(
  doc: { placeName: string; address: string; roadAddress: string },
  opts: { cleanedName: string; hint: string },
): boolean {
  const hint = opts.hint.trim();
  if (hint) {
    const road = (doc.roadAddress || "").trim();
    const addr = (doc.address || "").trim();
    return road.includes(hint) || addr.includes(hint);
  }
  const cleaned = opts.cleanedName.trim();
  if (!cleaned) return false;
  return (doc.placeName || "").trim() === cleaned;
}

/**
 * Build up to 3 rescue attempts in order a → b → c (deduped).
 * Only call these after the existing Kakao fallback path returns no lookup.
 */
export function buildKakaoRescueAttempts(
  originalName: string,
  hint: string = "",
  priorQueries: ReadonlyArray<string> = [],
): KakaoRescueAttempt[] {
  const trimmed = originalName.trim();
  if (!trimmed) return [];
  const prior = new Set(
    priorQueries.map((q) => q.trim()).filter(Boolean),
  );

  const claudeHint = hint.trim();
  const stripped = stripBranchOrRegionSuffix(trimmed);
  // Strip attempt prefers peeled region; other attempts prefer Claude hint.
  const stripAdoptHint = stripped.regionHint || claudeHint;
  const generalAdoptHint = claudeHint || stripped.regionHint;
  const baseCleaned =
    stripped.cleaned && stripped.cleaned !== trimmed ? stripped.cleaned : trimmed;
  const normalized = normalizePlaceQuery(baseCleaned);

  const out: KakaoRescueAttempt[] = [];
  const seenQueries = new Set<string>();

  const push = (attempt: KakaoRescueAttempt) => {
    if (out.length >= 3) return;
    const q = attempt.query.trim();
    if (q.length < 2) return;
    if (seenQueries.has(q)) return;
    // Do not re-issue the exact original query except as hint-prefixed form
    if (q === trimmed && attempt.stage !== "rescue_hint") return;
    // Skip queries already tried by the primary 6-stage fallbacks
    if (prior.has(q)) return;
    seenQueries.add(q);
    out.push({ ...attempt, query: q });
  };

  // a) strip branch/region
  if (stripped.cleaned && stripped.cleaned !== trimmed) {
    push({
      query: stripped.cleaned,
      stage: "rescue_strip",
      adoptHint: stripAdoptHint,
      cleanedName: stripped.cleaned,
    });
  }

  // b) normalize
  if (normalized && normalized !== trimmed) {
    push({
      query: normalized,
      stage: "rescue_norm",
      adoptHint: generalAdoptHint,
      cleanedName: normalized,
    });
  }

  // c) hint + cleaned
  const cleanedForHint = normalized || baseCleaned;
  if (generalAdoptHint && cleanedForHint) {
    const hintQuery = `${generalAdoptHint} ${cleanedForHint}`.replace(/\s+/g, " ").trim();
    push({
      query: hintQuery,
      stage: "rescue_hint",
      adoptHint: generalAdoptHint,
      cleanedName: cleanedForHint,
    });
  }

  return out;
}
