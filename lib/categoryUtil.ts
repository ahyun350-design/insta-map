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

export type CategoryFilterPostSource = FeedPostCategorySource &
  Pick<FeedPost, "images" | "photoPlaceTags" | "placeName" | "address">;

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

/**
 * 홈 카테고리 필터(가):
 * - filter=all → 항상 포함
 * - 해당 category 태그 사진 ≥1 → 포함(사진 좁힘)
 * - 태그 0장이어도 categories에 있으면 포함(원본 그대로)
 */
export function feedPostMatchesCategoryFilter(
  post: CategoryFilterPostSource,
  filter: string,
): boolean {
  if (filter === "all") return true;
  return projectPostForCategoryFilter(post, filter).include;
}

/** categories에는 있는데 매칭 태그 사진이 0장 — 원본 폴백 대상 */
export function feedPostHasCategoryWithoutMatchingTags(
  post: CategoryFilterPostSource,
  filter: string,
): boolean {
  if (filter === "all") return false;
  if (!getDisplayCategories(post).includes(filter)) return false;
  const view = projectPostForCategoryFilter(post, filter);
  return view.include && !view.narrowed;
}

export type CategoryFilterCardView = {
  /** 필터 목록에 넣을지 */
  include: boolean;
  /**
   * true: 매칭 사진만·선택 카테고리 뱃지.
   * false: 원본 전체(필터 all이거나 태그 0장 폴백).
   */
  narrowed: boolean;
  /** 카드/그리드에 보여줄 이미지 */
  images: string[];
  /** 필터된 이미지에 맞게 photoIndex를 0..n-1로 재매핑한 태그 (narrowed일 때) */
  photoPlaceTags: PhotoPlaceTag[] | null;
  /** 뱃지에 표시할 카테고리 */
  visibleCategories: string[];
  /** 필터 카테고리가 아닌 다른 장소(고유 placeName) 수 — narrowed일 때만 의미 */
  otherPlaceCount: number;
  /** 그리드 장소 라벨용 */
  placeName: string;
  address: string;
};

function uniqueOtherPlaceCount(tags: PhotoPlaceTag[], filter: string): number {
  const names = new Set<string>();
  for (const tag of tags) {
    const cat = tag.category?.trim() ?? "";
    const name = tag.placeName?.trim() ?? "";
    if (!name || cat === filter) continue;
    names.add(name);
  }
  return names.size;
}

function originalCardView(post: CategoryFilterPostSource): CategoryFilterCardView {
  const images = Array.isArray(post.images) ? post.images : [];
  return {
    include: true,
    narrowed: false,
    images,
    photoPlaceTags: post.photoPlaceTags ?? null,
    visibleCategories: getDisplayCategories(post),
    otherPlaceCount: 0,
    placeName: post.placeName ?? "",
    address: post.address ?? "",
  };
}

/**
 * 홈 카드용 카테고리 필터 투영.
 * filter=all → 원본.
 * 매칭 태그 ≥1 → 해당 사진만·뱃지 단일.
 * 매칭 0장이되 categories에 포함 → 원본 폴백(제외하지 않음).
 * categories에도 없고 매칭도 없으면 제외.
 */
export function projectPostForCategoryFilter(
  post: CategoryFilterPostSource,
  filter: string,
): CategoryFilterCardView {
  const images = Array.isArray(post.images) ? post.images : [];
  const tags = post.photoPlaceTags ?? [];

  if (filter === "all") {
    return originalCardView(post);
  }

  const inCategories = getDisplayCategories(post).includes(filter);

  const matchingSrcIndices: number[] = [];
  const seen = new Set<number>();
  for (const tag of tags) {
    if ((tag.category?.trim() ?? "") !== filter) continue;
    const idx = tag.photoIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= images.length) continue;
    if (seen.has(idx)) continue;
    seen.add(idx);
    matchingSrcIndices.push(idx);
  }
  matchingSrcIndices.sort((a, b) => a - b);

  if (matchingSrcIndices.length === 0) {
    if (inCategories) {
      return originalCardView(post);
    }
    return {
      include: false,
      narrowed: false,
      images: [],
      photoPlaceTags: null,
      visibleCategories: [],
      otherPlaceCount: 0,
      placeName: post.placeName ?? "",
      address: post.address ?? "",
    };
  }

  const filteredImages = matchingSrcIndices.map((i) => images[i]!);
  const remappedTags: PhotoPlaceTag[] = matchingSrcIndices.map((srcIdx, newIdx) => {
    const tag = tags.find((t) => t.photoIndex === srcIdx && (t.category?.trim() ?? "") === filter);
    if (tag) return { ...tag, photoIndex: newIdx };
    return {
      photoIndex: newIdx,
      placeId: null,
      placeName: "",
      address: "",
      category: filter,
      lat: 0,
      lng: 0,
      x: 0.5,
      y: 0.5,
    };
  });
  const first = remappedTags[0];

  return {
    include: true,
    narrowed: true,
    images: filteredImages,
    photoPlaceTags: remappedTags,
    visibleCategories: [filter],
    otherPlaceCount: uniqueOtherPlaceCount(tags, filter),
    placeName: first?.placeName?.trim() || (post.placeName ?? ""),
    address: first?.address?.trim() || (post.address ?? ""),
  };
}

/** 카드·상세 등: 최대 maxVisible개 + 나머지 개수 */
export function formatDisplayCategoriesForUi(
  categories: string[] | FeedPostCategorySource,
  maxVisible = 3,
): { visible: string[]; extraCount: number } {
  const all = Array.isArray(categories) ? categories : getDisplayCategories(categories);
  if (all.length <= maxVisible) {
    return { visible: all, extraCount: 0 };
  }
  return { visible: all.slice(0, maxVisible), extraCount: all.length - maxVisible };
}
