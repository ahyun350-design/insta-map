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

function imageUrlAt(images: string[], index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= images.length) return "";
  return String(images[index] ?? "").trim();
}

/**
 * 썸네일 URL 해석. 빈 칸 방지.
 * 1) preferredIndex의 URL
 * 2) fallbackIndices 순회
 * 3) images[0]
 * 4) "" (호출측 플레이스홀더)
 */
export function resolveFeedThumbUrl(
  images: string[],
  preferredIndex: number,
  fallbackIndices: number[] = [],
): string {
  const primary = imageUrlAt(images, preferredIndex);
  if (primary) return primary;
  for (const i of fallbackIndices) {
    const u = imageUrlAt(images, i);
    if (u) return u;
  }
  return imageUrlAt(images, 0);
}

export type CategoryRepPick = {
  /** 원본 images 기준 인덱스 */
  sourceIndex: number;
  placeName: string;
  address: string;
  imageUrl: string;
  tag: PhotoPlaceTag;
};

/**
 * 대표 태그 선택.
 * - categoryFilter가 있으면 그 category 태그만, photoIndex 오름차순.
 * - 없으면 전체 태그 중 photoIndex 최소.
 * - URL이 비어 있으면 다음 후보로 넘어감.
 * - 후보가 없으면 null.
 */
export function pickCategoryRepresentative(
  images: string[],
  tags: PhotoPlaceTag[] | null | undefined,
  categoryFilter?: string | null,
): CategoryRepPick | null {
  if (!tags?.length || images.length <= 0) return null;
  const filter =
    categoryFilter && categoryFilter !== "all" ? categoryFilter.trim() : null;

  const candidates = tags
    .filter((t) => {
      const idx = t.photoIndex;
      if (!Number.isInteger(idx) || idx < 0 || idx >= images.length) return false;
      if (filter && (t.category?.trim() ?? "") !== filter) return false;
      return true;
    })
    .sort((a, b) => a.photoIndex - b.photoIndex);

  if (candidates.length === 0) return null;

  // Prefer first with non-empty URL; else first candidate (URL may still be empty → caller fallbacks)
  const withUrl = candidates.find((t) => imageUrlAt(images, t.photoIndex));
  const tag = withUrl ?? candidates[0]!;
  const sourceIndex = tag.photoIndex;
  return {
    sourceIndex,
    placeName: tag.placeName?.trim() ?? "",
    address: tag.address?.trim() ?? "",
    imageUrl: imageUrlAt(images, sourceIndex),
    tag,
  };
}

/**
 * 유효한 태그 photoIndex 중 오름차순 첫 값.
 * categoryFilter가 있으면 해당 category 태그만.
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

/** 그리드/카드 썸네일용 이미지 인덱스. all/미지정 → 0(커버). 카테고리 필터 → 해당 첫 태그. */
export function getRepresentativeImageIndex(
  imagesLength: number,
  tags: PhotoPlaceTag[] | null | undefined,
  categoryFilter?: string | null,
): number {
  if (!categoryFilter || categoryFilter === "all") return 0;
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
 * false: 필터 all — 전체 사진(대표는 images[0]).
 */
  narrowed: boolean;
  /** 카드/그리드에 보여줄 이미지 (narrowed면 매칭만, 대표가 [0]) */
  images: string[];
  /** 그리드에 바로 쓸 썸네일 URL (항상 비지 않게 폴백됨; 완전 없으면 "") */
  thumbUrl: string;
  /** 원본 images 기준 썸네일/캐러셀 시작 인덱스 (narrowed면 필터된 배열 기준 0) */
  thumbSourceIndex: number;
  /**
   * 상세(원본 images) 진입용 원본 인덱스.
   * all → 0, 칩 ON → pickCategoryRepresentative의 sourceIndex.
   * thumbSourceIndex와 별개 (카드 필터 캐러셀은 thumbSourceIndex 유지).
   */
  originalImageIndex: number;
  /** 필터된 이미지에 맞게 photoIndex를 0..n-1로 재매핑한 태그 (narrowed일 때) */
  photoPlaceTags: PhotoPlaceTag[] | null;
  /** 뱃지에 표시할 카테고리 */
  visibleCategories: string[];
  /** 필터 카테고리가 아닌 다른 장소(고유 placeName) 수 — narrowed일 때만 의미 */
  otherPlaceCount: number;
  /** 그리드 장소 라벨 — 대표 태그와 동일 장소 */
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
 * filter=all → 전체 포함, 대표 이미지=images[0], 캐러셀 시작=0.
 *   장소명은 호출측 getRepresentativePlaceForPost 사용 (여기선 legacy 필드만).
 * 매칭 태그 ≥1 → 해당 category만, 대표=그 category 태그 중 photoIndex 최소.
 * 매칭 0장 → 제외.
 */
export function projectPostForCategoryFilter(
  post: CategoryFilterPostSource,
  filter: string,
): CategoryFilterCardView {
  const images = Array.isArray(post.images) ? post.images : [];
  const tags = post.photoPlaceTags ?? [];

  if (filter === "all") {
    const thumbSourceIndex = 0;
    const thumbUrl = resolveFeedThumbUrl(images, 0, []);
    return {
      include: true,
      narrowed: false,
      images,
      thumbUrl,
      thumbSourceIndex,
      originalImageIndex: 0,
      photoPlaceTags: post.photoPlaceTags ?? null,
      visibleCategories: getDisplayCategories(post),
      otherPlaceCount: 0,
      // 장소 라벨은 getRepresentativePlaceForPost — 여기선 legacy만 두고 호출측이 덮음
      placeName: post.placeName ?? "",
      address: post.address ?? "",
    };
  }

  const rep = pickCategoryRepresentative(images, tags, filter);
  if (!rep) {
    return {
      include: false,
      narrowed: false,
      images: [],
      thumbUrl: "",
      thumbSourceIndex: 0,
      originalImageIndex: 0,
      photoPlaceTags: null,
      visibleCategories: [],
      otherPlaceCount: 0,
      placeName: "",
      address: "",
    };
  }

  // Matching source indices (valid range), sorted — for carousel subset
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

  // Put representative first, then remaining matches in order
  const ordered = [
    rep.sourceIndex,
    ...matchingSrcIndices.filter((i) => i !== rep.sourceIndex),
  ];
  const filteredImages = ordered.map((i) => images[i]!).filter(Boolean);
  // Ensure at least one slot even if URLs empty — use resolve for thumb
  const displayImages =
    filteredImages.length > 0
      ? filteredImages
      : [resolveFeedThumbUrl(images, rep.sourceIndex, matchingSrcIndices)].filter(Boolean);

  const remappedTags: PhotoPlaceTag[] = ordered.map((srcIdx, newIdx) => {
    const tag = tags.find(
      (t) => t.photoIndex === srcIdx && (t.category?.trim() ?? "") === filter,
    );
    if (tag) return { ...tag, photoIndex: newIdx };
    return {
      photoIndex: newIdx,
      placeId: null,
      placeName: rep.placeName,
      address: rep.address,
      category: filter,
      lat: 0,
      lng: 0,
      x: 0.5,
      y: 0.5,
    };
  });

  const thumbUrl =
    resolveFeedThumbUrl(images, rep.sourceIndex, matchingSrcIndices) ||
    displayImages[0] ||
    "";

  return {
    include: true,
    narrowed: true,
    images: displayImages.length > 0 ? displayImages : images.slice(0, 1),
    thumbUrl,
    thumbSourceIndex: 0,
    originalImageIndex: rep.sourceIndex,
    photoPlaceTags: remappedTags,
    visibleCategories: [filter],
    otherPlaceCount: uniqueOtherPlaceCount(tags, filter),
    // Strict: only the matching-category representative — never legacy/other-tag place
    placeName: rep.placeName,
    address: rep.address,
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
