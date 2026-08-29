import type { FeedPostCategory } from "@/lib/feedPost";

/** 카카오 로컬 `category_group_code` → 앱 카테고리 */
export function mapKakaoCategoryGroupCode(code: string): FeedPostCategory {
  if (code === "CE7") return "카페";
  if (code === "FD6") return "맛집";
  if (code === "MT1" || code === "CS2") return "쇼핑";
  if (code === "AD5") return "숙소";
  // AT4 관광명소, CT1 문화시설(박물관·미술관 등)
  if (code === "AT4" || code === "CT1") return "여행지";
  // PK6 놀이테마파크, LN3 레저스포츠 등 오락·액티비티 성격
  if (code === "PK6" || code === "LN3") return "놀거리";
  return "맛집";
}

/**
 * 카카오 `category_name` 문자열 휴리스틱.
 * 매칭 규칙이 없으면 null (호출부에서 Claude 등으로 폴백).
 */
export function tryMapKakaoCategoryName(
  categoryName: string | undefined,
): FeedPostCategory | null {
  const n = categoryName ?? "";
  if (!n) return null;
  if (n.includes("카페")) return "카페";
  if (n.includes("음식점") || n.includes("음식")) return "맛집";
  if (n.includes("쇼핑") || n.includes("마트")) return "쇼핑";
  if (n.includes("숙박")) return "숙소";
  if (n.includes("관광") || n.includes("명소")) return "여행지";
  if (n.includes("스포츠") || n.includes("여가")) return "놀거리";
  return null;
}

/** 카카오 `category_name` → PindMap 카테고리 (미매칭 시 맛집) */
export function mapKakaoCategoryToPindMap(
  categoryName: string | undefined,
): FeedPostCategory {
  return tryMapKakaoCategoryName(categoryName) ?? "맛집";
}

/**
 * 추출 저장용: 카카오 분류 우선, 없으면 Claude.
 * 1) 제과·베이커리 / 떡·한과 → 카페
 * 2) category_group_code 있으면 코드 매핑
 * 3) category_name 휴리스틱
 * 4) Claude 값
 */
export function resolvePlaceCategoryFromKakao(
  groupCode: string | null | undefined,
  categoryName: string | null | undefined,
  claudeCategory: FeedPostCategory,
): FeedPostCategory {
  const name = categoryName ?? "";
  if (name.includes("제과,베이커리") || name.includes("떡,한과")) {
    return "카페";
  }
  const code = (groupCode ?? "").trim();
  if (code) {
    return mapKakaoCategoryGroupCode(code);
  }
  return tryMapKakaoCategoryName(name) ?? claudeCategory;
}
