/**
 * LOCALDATA 업태구분명 → 앱 카테고리.
 * Source of truth: lib/localdataCategoryMap.json (shared with scripts/localdata/prepare.py).
 */
import type { FeedPostCategory } from "@/lib/feedPost";
import mapJson from "@/lib/localdataCategoryMap.json";

const APP_CATEGORIES = new Set<FeedPostCategory>([
  "맛집",
  "카페",
  "쇼핑",
  "숙소",
  "놀거리",
  "여행지",
]);

export const LOCALDATA_CAFE_RAWS = new Set(mapJson.cafe);
export const LOCALDATA_PLAY_RAWS = new Set(mapJson.play);
export const LOCALDATA_SHOP_RAWS = new Set(mapJson.shop);
export const LOCALDATA_STAY_RAWS = new Set(mapJson.stay);
/** 무정보 업태 — poi category를 채택하지 않음 */
export const LOCALDATA_UNINFORMATIVE_RAWS = new Set(mapJson.uninformative);
/** poi 적재에서 제외 */
export const LOCALDATA_EXCLUDE_RAWS = new Set(mapJson.exclude);

export function isAppCategory(v: string | null | undefined): v is FeedPostCategory {
  return typeof v === "string" && APP_CATEGORIES.has(v as FeedPostCategory);
}

export function isUninformativeRawCategory(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const t = raw.trim();
  if (!t) return true;
  return LOCALDATA_UNINFORMATIVE_RAWS.has(t);
}

export function shouldExcludePoiRawCategory(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  return LOCALDATA_EXCLUDE_RAWS.has(raw.trim());
}

/**
 * LOCALDATA 업태 → 앱 카테고리.
 * 무정보/제외/미매핑 → null (다음 신호로 폴백).
 */
export function mapLocaldataRawCategory(
  raw: string | null | undefined,
): FeedPostCategory | null {
  if (isUninformativeRawCategory(raw)) return null;
  if (shouldExcludePoiRawCategory(raw)) return null;
  const t = (raw || "").trim();
  if (LOCALDATA_CAFE_RAWS.has(t)) return "카페";
  if (LOCALDATA_PLAY_RAWS.has(t)) return "놀거리";
  if (LOCALDATA_SHOP_RAWS.has(t)) return "쇼핑";
  if (LOCALDATA_STAY_RAWS.has(t)) return "숙소";
  return null;
}
