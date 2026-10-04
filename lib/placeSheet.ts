import type { CompanionTag } from "@/lib/companionTag";
import type { PhotoPlaceTag } from "@/lib/feedPost";
import type { PlaceRefForPhotoTagMatch } from "@/lib/photoPlaceTag";

export type PlaceSheetFeedPost = {
  id: string;
  user: string;
  userAvatarUrl?: string;
  title: string;
  placeName: string;
  category: string;
  comment: string;
  images: string[];
  createdAt: string;
  companionTag?: CompanionTag | null;
  likes_count: number;
  liked_by_me: boolean;
  comments: unknown[];
  photoPlaceTags?: PhotoPlaceTag[] | null;
};

/** 지도 핀·바텀시트와 동일한 kakao place 객체 형태 */
export type PlaceSheetData = {
  place_name: string;
  category_name?: string;
  /** Fine category under category_name — place detail only */
  subcategory?: string | null;
  road_address_name?: string;
  address_name?: string;
  phone?: string;
  place_url?: string;
  y?: string;
  x?: string;
  _feedPosts?: PlaceSheetFeedPost[];
  _savedPlaceId?: string;
  _placeRef?: PlaceRefForPhotoTagMatch;
  /** places.source — admin MapLibre sheet phone gate */
  _placeSource?: "kakao" | "user" | "poi" | null;
  /** public.poi.phone (never copied onto places) */
  _poiPhone?: string | null;
};

/** Displayable phone: keep original formatting, hide if fewer than 7 digits. */
export function displayablePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return trimmed;
}

/** 주소에서 구/군 + 동/읍/면/가 추출 (네이버 검색 보조 쿼리). */
export function extractGuDongFromAddress(address: string | null | undefined): string {
  if (typeof address !== "string") return "";
  const text = address.trim();
  if (!text) return "";
  const gu = text.match(/[가-힣]+(?:구|군)/)?.[0] ?? "";
  const dong = text.match(/[가-힣]+(?:동|읍|면|가)/)?.[0] ?? "";
  return [gu, dong].filter(Boolean).join(" ");
}

export function buildKakaoMapViewUrl(placeName: string, lat: number, lng: number): string {
  return `https://map.kakao.com/link/map/${encodeURIComponent(placeName)},${lat},${lng}`;
}

export function buildKakaoTransitUrl(placeName: string, lat: number, lng: number): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(placeName)},${lat},${lng}`;
}

export function buildNaverMapSearchUrl(placeName: string, address?: string | null): string {
  const guDong = extractGuDongFromAddress(address);
  const q = guDong ? `${placeName} ${guDong}` : placeName;
  return `https://map.naver.com/p/search/${encodeURIComponent(q)}`;
}

export function feedPostToPlaceSheet(
  post: {
    id: string;
    placeName: string;
    address: string;
    category: string;
    lat?: number;
    lng?: number;
  },
  relatedPosts: PlaceSheetFeedPost[],
  savedPlaceId?: string,
  placeRef?: PlaceRefForPhotoTagMatch,
): PlaceSheetData {
  const hasCoords = typeof post.lat === "number" && typeof post.lng === "number";
  return {
    place_name: post.placeName,
    category_name: post.category,
    road_address_name: post.address,
    address_name: post.address,
    phone: "",
    place_url: "",
    ...(hasCoords ? { y: String(post.lat), x: String(post.lng) } : {}),
    _feedPosts: relatedPosts,
    ...(savedPlaceId ? { _savedPlaceId: savedPlaceId } : {}),
    ...(placeRef ? { _placeRef: placeRef } : {}),
  };
}

export function placeRefFromPlaceSheet(place: PlaceSheetData): PlaceRefForPhotoTagMatch {
  if (place._placeRef) return place._placeRef;
  const lat = parseFloat(String(place.y ?? ""));
  const lng = parseFloat(String(place.x ?? ""));
  return {
    placeName: place.place_name,
    address: place.road_address_name || place.address_name,
    placeId: null,
    ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
  };
}
