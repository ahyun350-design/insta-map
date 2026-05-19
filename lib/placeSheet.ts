import type { CompanionTag } from "@/lib/companionTag";

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
};

/** 지도 핀·바텀시트와 동일한 kakao place 객체 형태 */
export type PlaceSheetData = {
  place_name: string;
  category_name?: string;
  road_address_name?: string;
  address_name?: string;
  phone?: string;
  place_url?: string;
  y?: string;
  x?: string;
  _feedPosts?: PlaceSheetFeedPost[];
  _savedPlaceId?: string;
};

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
  };
}
