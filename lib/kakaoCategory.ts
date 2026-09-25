import type { FeedPostCategory } from "@/lib/feedPost";
import {
  isAppCategory,
  mapLocaldataRawCategory,
} from "@/lib/localdataCategory";

/** 카카오 `category_name` path — 술집 하위 분류 (호프/와인바/이자카야 등). */
export function isKakaoBarCategoryName(
  categoryName: string | null | undefined,
): boolean {
  const n = categoryName ?? "";
  return n.includes("> 술집 >");
}

/** 카카오 로컬 `category_group_code` → 앱 카테고리 (미매칭 시 null) */
export function mapKakaoCategoryGroupCode(
  code: string | null | undefined,
): FeedPostCategory | null {
  const c = (code ?? "").trim();
  if (!c) return null;
  if (c === "CE7") return "카페";
  if (c === "FD6") return "맛집";
  if (c === "MT1" || c === "CS2") return "쇼핑";
  if (c === "AD5") return "숙소";
  // AT4 관광명소, CT1 문화시설(박물관·미술관 등)
  if (c === "AT4" || c === "CT1") return "여행지";
  // PK6 놀이테마파크, LN3 레저스포츠 등 오락·액티비티 성격
  if (c === "PK6" || c === "LN3") return "놀거리";
  return null;
}

/**
 * 카카오 `category_name` 문자열 휴리스틱.
 * 매칭 규칙이 없으면 null.
 * 단순 "바" 매칭 금지 (커피바·샐러드바 오탐).
 */
export function tryMapKakaoCategoryName(
  categoryName: string | null | undefined,
): FeedPostCategory | null {
  const n = categoryName ?? "";
  if (!n) return null;
  if (isKakaoBarCategoryName(n)) return "술집";
  if (n.includes("제과,베이커리") || n.includes("떡,한과")) return "카페";
  if (n.includes("카페")) return "카페";
  if (n.includes("음식점") || n.includes("음식")) return "맛집";
  if (n.includes("쇼핑") || n.includes("마트")) return "쇼핑";
  // group_code 비는 전문 소매 (카메라판매·의류 등)
  if (
    n.includes("카메라") ||
    n.includes("의류") ||
    n.includes("패션") ||
    n.includes("잡화") ||
    n.includes("문구") ||
    n.includes("서점") ||
    n.includes("안경") ||
    n.includes("화장품") ||
    n.includes("가전") ||
    n.includes("꽃집") ||
    n.includes("생활용품점") ||
    (n.includes("판매") && !n.includes("음식"))
  ) {
    return "쇼핑";
  }
  if (n.includes("숙박")) return "숙소";
  if (n.includes("관광") || n.includes("명소")) return "여행지";
  if (n.includes("스포츠") || n.includes("여가")) return "놀거리";
  return null;
}

/** 카카오 `category_name` → PindMap 카테고리 (미매칭 시 null) */
export function mapKakaoCategoryToPindMap(
  categoryName: string | null | undefined,
): FeedPostCategory | null {
  return tryMapKakaoCategoryName(categoryName);
}

/**
 * 추출 저장용 최종 카테고리 우선순위:
 * 1) 카카오 category_name에 "> 술집 >" → 술집 (FD6보다 앞)
 * 2) FD6 → Claude가 맛집이 아니면 Claude, 아니면 맛집
 * 3) 기타 category_group_code
 * 4) 카카오 category_name 휴리스틱
 * 5) Claude category
 * 6) poi.raw_category (무정보 업태는 스킵)
 * 7) 맛집 (defaultCategory, 큐레이션은 null로 끄고 사용자 선택)
 */
export function resolvePlaceCategorySignals(input: {
  groupCode?: string | null;
  categoryName?: string | null;
  claudeCategory?: FeedPostCategory | null;
  poiRawCategory?: string | null;
}): FeedPostCategory | null {
  // 술집 path는 FD6보다 구체적 — 최우선
  if (isKakaoBarCategoryName(input.categoryName)) return "술집";

  const code = (input.groupCode ?? "").trim();

  // FD6 = generic food — path에 술집 없을 때만 Claude 우선
  if (code === "FD6") {
    if (
      input.claudeCategory &&
      isAppCategory(input.claudeCategory) &&
      input.claudeCategory !== "맛집"
    ) {
      return input.claudeCategory;
    }
    return "맛집";
  }

  const byCode = mapKakaoCategoryGroupCode(code);
  if (byCode) return byCode;

  const byName = tryMapKakaoCategoryName(input.categoryName);
  if (byName) return byName;

  if (input.claudeCategory && isAppCategory(input.claudeCategory)) {
    return input.claudeCategory;
  }

  const byRaw = mapLocaldataRawCategory(input.poiRawCategory);
  if (byRaw) return byRaw;

  return null;
}

export function resolveExtractPlaceCategory(input: {
  groupCode?: string | null;
  categoryName?: string | null;
  claudeCategory: FeedPostCategory;
  poiRawCategory?: string | null;
}): FeedPostCategory {
  return (
    resolvePlaceCategorySignals({
      groupCode: input.groupCode,
      categoryName: input.categoryName,
      claudeCategory: input.claudeCategory,
      poiRawCategory: input.poiRawCategory,
    }) ?? "맛집"
  );
}

/**
 * @deprecated Use resolveExtractPlaceCategory.
 */
export function resolvePlaceCategoryFromKakao(
  groupCode: string | null | undefined,
  categoryName: string | null | undefined,
  claudeCategory: FeedPostCategory,
): FeedPostCategory {
  return resolveExtractPlaceCategory({
    groupCode,
    categoryName,
    claudeCategory,
  });
}
