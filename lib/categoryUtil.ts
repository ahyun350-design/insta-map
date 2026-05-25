import {
  FEED_POST_CATEGORIES,
  type FeedPost,
  type FeedPostCategory,
  type PhotoPlaceTag,
} from "@/lib/feedPost";

function isFeedPostCategory(value: string): value is FeedPostCategory {
  return (FEED_POST_CATEGORIES as readonly string[]).includes(value);
}

/**
 * photo_place_tags의 장소 category(읽기 전용) → 큐레이션 categories 초기값.
 * 장소 태그 category 값은 변경하지 않음.
 */
export function extractCategoriesFromPhotoTags(
  tags: PhotoPlaceTag[],
  order: readonly FeedPostCategory[] = FEED_POST_CATEGORIES,
): FeedPostCategory[] {
  const fromTags = new Set<FeedPostCategory>();
  for (const tag of tags) {
    const raw = tag.category?.trim();
    if (raw && isFeedPostCategory(raw)) {
      fromTags.add(raw);
    }
  }
  return order.filter((cat) => fromTags.has(cat));
}

export type FeedPostCategorySource = Pick<FeedPost, "category" | "categories">;

/** 큐레이션 게시글(feed_posts) 표시용 카테고리 — places·photo_place_tags.category와 무관 */
export function getDisplayCategories(post: FeedPostCategorySource): string[] {
  if (post.categories && post.categories.length > 0) {
    return post.categories;
  }
  if (post.category) {
    return [post.category];
  }
  return [];
}

/** 홈 카테고리 필터: 선택 카테고리가 큐레이션 categories에 포함되는지 */
export function feedPostMatchesCategoryFilter(post: FeedPostCategorySource, filter: string): boolean {
  if (filter === "all") return true;
  return getDisplayCategories(post).includes(filter);
}

/** 카드·상세 등: 최대 maxVisible개 + 나머지 개수 */
export function formatDisplayCategoriesForUi(
  post: FeedPostCategorySource,
  maxVisible = 3,
): { visible: string[]; extraCount: number } {
  const all = getDisplayCategories(post);
  if (all.length <= maxVisible) {
    return { visible: all, extraCount: 0 };
  }
  return { visible: all.slice(0, maxVisible), extraCount: all.length - maxVisible };
}
