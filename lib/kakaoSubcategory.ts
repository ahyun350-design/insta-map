import type { FeedPostCategory } from "@/lib/feedPost";

/** Fine category under a top-level FeedPostCategory — never mixed into Category / FEED_POST_CATEGORIES. */
export type SubCategory =
  | "한식"
  | "일식"
  | "중식"
  | "양식"
  | "분식"
  | "아시안"
  | "치킨"
  | "고기"
  | "커피"
  | "베이커리"
  | "디저트"
  | "테마카페"
  | "패션"
  | "생활용품"
  | "서점"
  | "문구"
  | "뷰티"
  | "호프"
  | "이자카야"
  | "와인바"
  | "칵테일바"
  | "문화시설"
  | "관광명소"
  | "공원"
  | "사우나"
  | "여가시설"
  | "스포츠"
  | "호텔"
  | "펜션"
  | "리조트"
  | "게스트하우스";

export const SUBCATEGORIES_BY_CATEGORY: Record<
  FeedPostCategory,
  readonly SubCategory[]
> = {
  맛집: ["한식", "일식", "중식", "양식", "분식", "아시안", "치킨", "고기"],
  카페: ["커피", "베이커리", "디저트", "테마카페"],
  쇼핑: ["패션", "생활용품", "서점", "문구", "뷰티"],
  술집: ["호프", "이자카야", "와인바", "칵테일바"],
  여행지: ["문화시설", "관광명소", "공원"],
  놀거리: ["사우나", "여가시설", "스포츠"],
  숙소: ["호텔", "펜션", "리조트", "게스트하우스"],
};

const ALLOWED = new Map<FeedPostCategory, Set<string>>(
  (Object.keys(SUBCATEGORIES_BY_CATEGORY) as FeedPostCategory[]).map((cat) => [
    cat,
    new Set(SUBCATEGORIES_BY_CATEGORY[cat]),
  ]),
);

export function isSubCategory(
  category: FeedPostCategory,
  value: string | null | undefined,
): value is SubCategory {
  if (!value) return false;
  return ALLOWED.get(category)?.has(value) === true;
}

function parseKakaoPath(categoryName: string | null | undefined): {
  l2: string;
  l3: string;
} {
  const parts = String(categoryName ?? "")
    .split(/\s*>\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { l2: parts[1] ?? "", l3: parts[2] ?? "" };
}

function accept(
  appCategory: FeedPostCategory,
  candidate: string | null,
): SubCategory | null {
  if (!candidate) return null;
  return isSubCategory(appCategory, candidate) ? candidate : null;
}

/**
 * Kakao `category_name` path → SubCategory under the given app category.
 * - Uses L2 for most parents; café / bar / lodging use L3 where listed.
 * - Values not in the map → null (no force-fit).
 * - Never changes appCategory. If path conflicts with parent (e.g. 맛집 + L2 카페) → null.
 */
export function resolveKakaoSubcategory(
  appCategory: FeedPostCategory,
  categoryName: string | null | undefined,
): SubCategory | null {
  const { l2, l3 } = parseKakaoPath(categoryName);
  if (!l2 && !l3) return null;

  switch (appCategory) {
    case "맛집": {
      // L3 meat under 한식 → 고기 (more specific than 한식)
      if (l2 === "한식" && l3 === "육류,고기") {
        return accept(appCategory, "고기");
      }
      if (l2 === "한식") return accept(appCategory, "한식");
      if (l2 === "일식") return accept(appCategory, "일식");
      if (l2 === "중식") return accept(appCategory, "중식");
      if (l2 === "양식") return accept(appCategory, "양식");
      if (l2 === "분식") return accept(appCategory, "분식");
      if (l2 === "아시아음식") return accept(appCategory, "아시안");
      if (l2 === "치킨") return accept(appCategory, "치킨");
      // 카페/술집/간식 등 → null (do not reparent)
      return null;
    }
    case "카페": {
      // L3 under 카페 / 간식 only — L2 alone is not a subcategory
      if (l3 === "커피전문점") return accept(appCategory, "커피");
      if (l3 === "테마카페") return accept(appCategory, "테마카페");
      if (l3 === "제과,베이커리") return accept(appCategory, "베이커리");
      if (l3 === "아이스크림") return accept(appCategory, "디저트");
      return null;
    }
    case "쇼핑": {
      if (l2 === "패션") return accept(appCategory, "패션");
      if (l2 === "생활용품점") return accept(appCategory, "생활용품");
      if (l2 === "도서") return accept(appCategory, "서점");
      if (l2 === "문구,사무용품") return accept(appCategory, "문구");
      if (l2 === "미용") return accept(appCategory, "뷰티");
      return null;
    }
    case "술집": {
      if (l3 === "호프,요리주점") return accept(appCategory, "호프");
      if (l3 === "일본식주점") return accept(appCategory, "이자카야");
      if (l3 === "와인바") return accept(appCategory, "와인바");
      if (l3 === "칵테일바") return accept(appCategory, "칵테일바");
      return null;
    }
    case "여행지": {
      if (l2 === "문화시설") return accept(appCategory, "문화시설");
      if (l2 === "관광,명소") return accept(appCategory, "관광명소");
      if (l2 === "공원") return accept(appCategory, "공원");
      return null;
    }
    case "놀거리": {
      if (l2 === "목욕탕,사우나") return accept(appCategory, "사우나");
      if (l2 === "여가시설") return accept(appCategory, "여가시설");
      if (l2 === "스포츠시설") return accept(appCategory, "스포츠");
      return null;
    }
    case "숙소": {
      if (l3 === "호텔") return accept(appCategory, "호텔");
      if (l3 === "펜션") return accept(appCategory, "펜션");
      if (l3 === "콘도,리조트") return accept(appCategory, "리조트");
      if (l3 === "게스트하우스") return accept(appCategory, "게스트하우스");
      return null;
    }
    default:
      return null;
  }
}

/** Format for place detail: "카페 · 베이커리" or just "카페". */
export function formatCategoryWithSubcategory(
  category: string,
  subcategory: string | null | undefined,
): string {
  const cat = category.trim();
  const sub = typeof subcategory === "string" ? subcategory.trim() : "";
  if (!cat) return sub;
  if (!sub) return cat;
  return `${cat} · ${sub}`;
}
