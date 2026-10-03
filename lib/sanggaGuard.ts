/**
 * sangga(상가) 후보 전용 매칭 가드.
 * 규칙: lib/sanggaGuard.rules.json (Python scripts/localdata/sangga_common.py 와 공유)
 * poiMatch.rules.json / 타 source 매칭에는 영향 없음.
 */
import rules from "./sanggaGuard.rules.json";
import {
  normalizePoiName,
  softNormalizeDisplay,
  type MatchReason,
} from "@/lib/poiMatch";
import { isSubCategory, type SubCategory } from "@/lib/kakaoSubcategory";
import type { FeedPostCategory } from "@/lib/feedPost";

export const SANGGA_SOURCE = rules.source as "sangga";
export const SANGGA_PARTIAL_MIN_SHORTER_LEN = rules.partialMinShorterLen;
export const SANGGA_NON_EXACT_SIM_MAX_M = rules.nonExactSimMaxM;

const RAW_TO_SUB = rules.rawCategoryToSubcategory as Record<
  string,
  string | null
>;

export type SanggaGuardReject =
  | "sangga_partial_guard"
  | "sangga_sim_distance";

function properContainStr(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

/** 진부분일치(동일명 제외). soft 정규화 포함. */
export function isSanggaProperContainment(
  placeName: string,
  poiName: string,
): boolean {
  const pn = normalizePoiName(placeName);
  const sn = normalizePoiName(poiName);
  if (properContainStr(pn, sn)) return true;
  const pa = softNormalizeDisplay(placeName);
  const pb = softNormalizeDisplay(poiName);
  return properContainStr(pa, pb);
}

/**
 * sangga 후보에만 적용. 통과하면 null, 거절이면 사유.
 * - 완전일치: 기존 거리 규칙 그대로 (추가 제한 없음)
 * - 진부분일치: 짧은 쪽 ≥3자 + category 일치
 * - 그 외 유사(sim/strip): ≤ nonExactSimMaxM
 */
export function sanggaGuardRejectReason(input: {
  placeName: string;
  placeCategory?: string | null;
  poiName: string;
  poiCategory?: string | null;
  poiSource?: string | null;
  distM: number;
  reason?: MatchReason;
}): SanggaGuardReject | null {
  if ((input.poiSource || "") !== SANGGA_SOURCE) return null;

  const pn = normalizePoiName(input.placeName);
  const sn = normalizePoiName(input.poiName);
  const exact = Boolean(pn) && pn === sn;
  if (exact) return null;

  if (isSanggaProperContainment(input.placeName, input.poiName)) {
    const shorter = Math.min(pn.length, sn.length);
    if (shorter < SANGGA_PARTIAL_MIN_SHORTER_LEN) {
      return "sangga_partial_guard";
    }
    const pc = (input.placeCategory || "").trim();
    const sc = (input.poiCategory || "").trim();
    if (!pc || pc !== sc) return "sangga_partial_guard";
    return null;
  }

  if (input.distM > SANGGA_NON_EXACT_SIM_MAX_M) {
    return "sangga_sim_distance";
  }
  return null;
}

export function sanggaGuardOk(
  input: Parameters<typeof sanggaGuardRejectReason>[0],
): boolean {
  return sanggaGuardRejectReason(input) == null;
}

/** 추출 subcategory가 null일 때만 사용. raw_category(소분류명) → SubCategory. */
export function subcategoryFromSanggaRaw(
  appCategory: string,
  rawCategory: string | null | undefined,
): SubCategory | null {
  if (!rawCategory) return null;
  const mapped = RAW_TO_SUB[rawCategory.trim()];
  if (mapped == null) return null;
  return isSubCategory(appCategory as FeedPostCategory, mapped) ? mapped : null;
}
