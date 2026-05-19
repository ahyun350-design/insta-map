import type { FeedPost, PhotoPlaceTag } from "@/lib/feedPost";

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
