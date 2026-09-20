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
 * 유효한 태그 photoIndex 중 오름차순 첫 값.
 * categoryFilter가 있으면 해당 category 태그만.
 * 없으면 null (호출측에서 images[0] 폴백).
 */
export function getFirstTaggedPhotoIndex(
  imagesLength: number,
  tags: PhotoPlaceTag[] | null | undefined,
  categoryFilter?: string | null,
): number | null {
  if (!tags?.length || imagesLength <= 0) return null;
  const filter =
    categoryFilter && categoryFilter !== "all" ? categoryFilter.trim() : null;
  let best: number | null = null;
  for (const tag of tags) {
    const idx = tag.photoIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= imagesLength) continue;
    if (filter && (tag.category?.trim() ?? "") !== filter) continue;
    if (best === null || idx < best) best = idx;
  }
  return best;
}

/** 그리드/카드 썸네일용 이미지 인덱스 (태그 없으면 0) */
export function getRepresentativeImageIndex(
  imagesLength: number,
  tags: PhotoPlaceTag[] | null | undefined,
  categoryFilter?: string | null,
): number {
  return getFirstTaggedPhotoIndex(imagesLength, tags, categoryFilter) ?? 0;
}

/**
 * 홈 카테고리 필터: filter=all → 항상 true.
 * 그 외 → 해당 category 태그가 붙은 사진이 1장 이상일 때만.
 */
export function feedPostMatchesCategoryFilter(
  post: CategoryFilterPostSource,
  filter: string,
): boolean {
  if (filter === "all") return true;
  return projectPostForCategoryFilter(post, filter).include;
}

/** categories에는 있는데 매칭 태그 사진이 0장 (허위/의도 추가 여분) */
export function feedPostHasCategoryWithoutMatchingTags(
  post: CategoryFilterPostSource,
  filter: string,
): boolean {
  if (filter === "all") return false;
  if (!getDisplayCategories(post).includes(filter)) return false;
  return !projectPostForCategoryFilter(post, filter).include;
}

export type CategoryFilterCardView = {
  /** 필터 목록에 넣을지 */
  include: boolean;
  /**
   * true: 매칭 사진만·선택 카테고리 뱃지.
   * false: 필터 all — 전체 사진(대표는 첫 태그 장으로 별도 선택).
   */
  narrowed: boolean;
  /** 카드/그리드에 보여줄 이미지 (narrowed면 매칭만) */
  images: string[];
  /** 원본 images 기준 썸네일/캐러셀 시작 인덱스 (narrowed면 항상 0) */
  thumbSourceIndex: number;
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

/**
 * 홈 카드용 카테고리 필터 투영.
 * filter=all → 전체 포함, thumbSourceIndex=첫 태그 사진.
 * 매칭 태그 ≥1 → 해당 사진만·뱃지 단일.
 * 매칭 0장 → 제외 (categories 폴백 없음).
 */
export function projectPostForCategoryFilter(
  post: CategoryFilterPostSource,
  filter: string,
): CategoryFilterCardView {
  const images = Array.isArray(post.images) ? post.images : [];
  const tags = post.photoPlaceTags ?? [];

  if (filter === "all") {
    const thumbSourceIndex = getRepresentativeImageIndex(images.length, tags, null);
    const thumbTag = tags.find((t) => t.photoIndex === thumbSourceIndex);
    return {
      include: true,
      narrowed: false,
      images,
      thumbSourceIndex,
      photoPlaceTags: post.photoPlaceTags ?? null,
      visibleCategories: getDisplayCategories(post),
      otherPlaceCount: 0,
      placeName: thumbTag?.placeName?.trim() || (post.placeName ?? ""),
      address: thumbTag?.address?.trim() || (post.address ?? ""),
    };
  }

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
    return {
      include: false,
      narrowed: false,
      images: [],
      thumbSourceIndex: 0,
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
    thumbSourceIndex: 0,
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
