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
