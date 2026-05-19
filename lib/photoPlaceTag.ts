import type { FeedPost, FeedPostCategory, PhotoPlaceTag } from "@/lib/feedPost";

/** 카카오 `category_name` → PindMap 카테고리 */
export function mapKakaoCategoryToPindMap(categoryName: string | undefined): FeedPostCategory {
  const n = categoryName ?? "";
  if (n.includes("카페")) return "카페";
  if (n.includes("음식점") || n.includes("음식")) return "맛집";
  if (n.includes("쇼핑") || n.includes("마트")) return "쇼핑";
  if (n.includes("숙박")) return "숙소";
  if (n.includes("관광") || n.includes("명소")) return "여행지";
  if (n.includes("스포츠") || n.includes("여가")) return "놀거리";
  return "맛집";
}

export function clampPhotoTagCoord(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function photoTapToNormalized(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { x: number; y: number } {
  const w = rect.width || 1;
  const h = rect.height || 1;
  return {
    x: clampPhotoTagCoord((clientX - rect.left) / w),
    y: clampPhotoTagCoord((clientY - rect.top) / h),
  };
}

export function upsertPhotoPlaceTag(tags: PhotoPlaceTag[], tag: PhotoPlaceTag): PhotoPlaceTag[] {
  return [...tags.filter((t) => t.photoIndex !== tag.photoIndex), tag];
}

export function removePhotoPlaceTag(tags: PhotoPlaceTag[], photoIndex: number): PhotoPlaceTag[] {
  return tags.filter((t) => t.photoIndex !== photoIndex);
}

export function getPhotoPlaceTag(tags: PhotoPlaceTag[], photoIndex: number): PhotoPlaceTag | undefined {
  return tags.find((t) => t.photoIndex === photoIndex);
}

/** 대표 장소(INSERT·카드 폴백): photoIndex 0 우선, 없으면 첫 태그 */
export function getRepresentativePhotoPlaceTag(tags: PhotoPlaceTag[]): PhotoPlaceTag | undefined {
  return tags.find((t) => t.photoIndex === 0) ?? tags[0];
}

export type DisplayPlaceForPhoto = {
  placeId: string | null;
  placeName: string;
  address: string;
  category: string;
  lat?: number;
  lng?: number;
  x?: number;
  y?: number;
};

export function hasPhotoPlaceTags(post: Pick<FeedPost, "photoPlaceTags">): boolean {
  return Array.isArray(post.photoPlaceTags) && post.photoPlaceTags.length > 0;
}

/**
 * 사진별 태그가 있으면 해당 인덱스 사용, 없으면 큐레이션 대표 장소 폴백, 둘 다 없으면 null.
 */
export function getDisplayPlaceForPhoto(
  post: Pick<
    FeedPost,
    "photoPlaceTags" | "placeName" | "address" | "category" | "lat" | "lng"
  >,
  photoIndex: number,
): DisplayPlaceForPhoto | null {
  const tag = post.photoPlaceTags?.find((t) => t.photoIndex === photoIndex);
  if (tag) {
    return {
      placeId: tag.placeId,
      placeName: tag.placeName,
      address: tag.address,
      category: tag.category,
      lat: tag.lat,
      lng: tag.lng,
      x: tag.x,
      y: tag.y,
    };
  }

  if (post.placeName.trim()) {
    return {
      placeId: null,
      placeName: post.placeName,
      address: post.address,
      category: post.category,
      ...(typeof post.lat === "number" && typeof post.lng === "number"
        ? { lat: post.lat, lng: post.lng }
        : {}),
    };
  }

  return null;
}

export type PlaceRefForPhotoTagMatch = {
  placeId?: string | null;
  placeName?: string;
  address?: string;
  lat?: number;
  lng?: number;
};

export type RelatedPostsAnchor = {
  placeName: string;
  lat?: number;
  lng?: number;
  address?: string;
};

/**
 * 주어진 장소가 큐레이션의 사진 태그 중 하나에 매칭되는지 확인
 */
function photoTagMatchesPlaceRef(tag: PhotoPlaceTag, placeRef: PlaceRefForPhotoTagMatch): boolean {
  if (placeRef.placeId && tag.placeId && tag.placeId === placeRef.placeId) return true;
  const refName = placeRef.placeName?.trim() ?? "";
  const refAddr = placeRef.address?.trim() ?? "";
  if (refName && tag.placeName.trim() === refName) {
    if (!refAddr || tag.address.trim() === refAddr) return true;
  }
  return false;
}

export function postHasPlaceInPhotoTags(
  post: Pick<FeedPost, "photoPlaceTags">,
  placeRef: PlaceRefForPhotoTagMatch,
): boolean {
  if (!post.photoPlaceTags || post.photoPlaceTags.length === 0) return false;
  return post.photoPlaceTags.some((tag) => photoTagMatchesPlaceRef(tag, placeRef));
}

/** placeRef에 매칭되는 사진 인덱스. legacy(태그 없음)는 빈 배열 → 호출부에서 전체 사진 표시 */
export function getMatchingPhotoIndices(
  post: Pick<FeedPost, "photoPlaceTags">,
  placeRef: PlaceRefForPhotoTagMatch,
): number[] {
  if (!post.photoPlaceTags || post.photoPlaceTags.length === 0) return [];
  return post.photoPlaceTags
    .filter((tag) => photoTagMatchesPlaceRef(tag, placeRef))
    .map((tag) => tag.photoIndex);
}

/** PlaceDetailSheet 관련 큐레이션 카드용 — 태그 매칭 사진만, legacy는 전체 */
export function getRelatedPostImagesForPlace(
  post: Pick<FeedPost, "images" | "photoPlaceTags">,
  placeRef: PlaceRefForPhotoTagMatch,
): string[] {
  const indices = getMatchingPhotoIndices(post, placeRef);
  if (indices.length === 0) return post.images;
  return [...indices]
    .sort((a, b) => a - b)
    .map((i) => post.images[i])
    .filter((src): src is string => typeof src === "string" && src.length > 0);
}

export function placeRefToRelatedAnchor(ref: PlaceRefForPhotoTagMatch): RelatedPostsAnchor {
  return {
    placeName: ref.placeName?.trim() ?? "",
    ...(typeof ref.lat === "number" && typeof ref.lng === "number"
      ? { lat: ref.lat, lng: ref.lng }
      : {}),
    address: ref.address,
  };
}

export function dedupeFeedPostsById<T extends { id: string }>(posts: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of posts) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * PlaceDetailSheet 관련 큐레이션: 사진 태그 매칭 + 기존 거리 매칭(legacy) 합치기
 */
export function mergeRelatedFeedPostsForPlaceSheet(
  posts: FeedPost[],
  placeRef: PlaceRefForPhotoTagMatch,
  legacyFilter: (posts: FeedPost[], anchor: RelatedPostsAnchor) => FeedPost[],
): FeedPost[] {
  const tagMatched = posts.filter((p) => !p.archived && postHasPlaceInPhotoTags(p, placeRef));
  const legacyPool = posts.filter(
    (p) => !p.archived && (!p.photoPlaceTags || p.photoPlaceTags.length === 0),
  );
  const legacyMatched = legacyFilter(legacyPool, placeRefToRelatedAnchor(placeRef));
  return dedupeFeedPostsById([...tagMatched, ...legacyMatched]);
}

export function validatePhotoPlaceTags(
  photos: string[],
  tags: PhotoPlaceTag[],
): { ok: boolean; missing: number[] } {
  const tagged = new Set(tags.map((t) => t.photoIndex));
  const missing: number[] = [];

  for (let i = 0; i < photos.length; i++) {
    if (!tagged.has(i)) missing.push(i);
  }

  return { ok: missing.length === 0, missing };
}
