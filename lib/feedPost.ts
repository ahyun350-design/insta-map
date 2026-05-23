import { isCompanionTag, type CompanionTag } from "@/lib/companionTag";

export type FeedPostCategory = "맛집" | "카페" | "쇼핑" | "숙소" | "놀거리" | "여행지";

const FEED_POST_CATEGORIES: readonly FeedPostCategory[] = [
  "맛집",
  "카페",
  "쇼핑",
  "숙소",
  "놀거리",
  "여행지",
];

export type PhotoPlaceTag = {
  photoIndex: number;
  placeId: string | null;
  placeName: string;
  address: string;
  category: string;
  lat: number;
  lng: number;
  x: number;
  y: number;
};

export type FeedPostComment = {
  id: string;
  user: string;
  userId?: string;
  avatarUrl?: string;
  text: string;
  createdAt: string;
};

export type FeedPost = {
  id: string;
  user: string;
  userId: string;
  userAvatarUrl?: string;
  title: string;
  placeName: string;
  address: string;
  lat?: number;
  lng?: number;
  category: FeedPostCategory;
  comment: string;
  images: string[];
  createdAt: string;
  companionTag?: CompanionTag | null;
  photoPlaceTags?: PhotoPlaceTag[] | null;
  courseId?: string | null;
  archived?: boolean;
  likes_count: number;
  liked_by_me: boolean;
  comments: FeedPostComment[];
};

type FeedPostRow = {
  id: string;
  user_name: string;
  user_id?: string | null;
  title: string;
  place_name: string;
  address: string;
  lat?: unknown;
  lng?: unknown;
  category: string;
  comment: string;
  companion_tag?: unknown;
  photo_place_tags?: unknown;
  course_id?: string | null;
  images?: string[] | null;
  created_at: string;
  archived?: boolean | null;
  likes_count?: number | null;
  comments?: Array<{
    id: string;
    user_name: string;
    user_id?: string | null;
    text: string;
    created_at: string;
  }> | null;
};

function isFeedPostCategory(value: string): value is FeedPostCategory {
  return (FEED_POST_CATEGORIES as readonly string[]).includes(value);
}

function coerceLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | undefined {
  const la = typeof lat === "number" ? lat : typeof lat === "string" ? Number(lat) : NaN;
  const ln = typeof lng === "number" ? lng : typeof lng === "string" ? Number(lng) : NaN;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return undefined;
  return { lat: la, lng: ln };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parsePhotoPlaceTagItem(raw: unknown): PhotoPlaceTag | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const rawIndex = item.photoIndex;
  const photoIndex =
    typeof rawIndex === "number"
      ? rawIndex
      : typeof rawIndex === "string"
        ? Number.parseInt(rawIndex, 10)
        : NaN;
  if (!Number.isInteger(photoIndex) || photoIndex < 0) {
    return null;
  }

  const placeName = typeof item.placeName === "string" ? item.placeName.trim() : "";
  const address = typeof item.address === "string" ? item.address.trim() : "";
  const categoryRaw = typeof item.category === "string" ? item.category : "";
  if (!placeName || !isFeedPostCategory(categoryRaw)) return null;

  const latLng = coerceLatLng(item.lat, item.lng);
  if (!latLng) return null;

  const x = typeof item.x === "number" ? item.x : NaN;
  const y = typeof item.y === "number" ? item.y : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const placeId =
    item.placeId === null
      ? null
      : typeof item.placeId === "string" && item.placeId.trim()
        ? item.placeId.trim()
        : null;

  return {
    photoIndex,
    placeId,
    placeName,
    address,
    category: categoryRaw,
    lat: latLng.lat,
    lng: latLng.lng,
    x: clamp01(x),
    y: clamp01(y),
  };
}

/** Supabase `photo_place_tags` jsonb → PhotoPlaceTag[] | null */
export function parsePhotoPlaceTagsFromRow(value: unknown): PhotoPlaceTag[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;

  const parsed = value
    .map((item) => parsePhotoPlaceTagItem(item))
    .filter((item): item is PhotoPlaceTag => item !== null);

  return parsed.length > 0 ? parsed : null;
}

export type ParseFeedPostOptions = {
  likedByMe?: boolean;
};

/** Supabase feed_posts row → FeedPost */
export function parseFeedPostFromRow(row: FeedPostRow, options: ParseFeedPostOptions = {}): FeedPost {
  const coords = coerceLatLng(row.lat, row.lng);
  const category = isFeedPostCategory(row.category) ? row.category : "카페";

  return {
    id: row.id,
    user: row.user_name,
    userId: row.user_id ?? "",
    title: row.title,
    placeName: row.place_name,
    address: row.address,
    ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
    category,
    comment: row.comment,
    companionTag: isCompanionTag(row.companion_tag) ? row.companion_tag : null,
    photoPlaceTags: parsePhotoPlaceTagsFromRow(row.photo_place_tags),
    courseId: row.course_id ?? null,
    images: row.images ?? [],
    createdAt: row.created_at,
    archived: row.archived ?? false,
    likes_count: row.likes_count ?? 0,
    liked_by_me: options.likedByMe ?? false,
    comments: (row.comments ?? []).map((c) => ({
      id: c.id,
      user: c.user_name,
      userId: c.user_id ?? undefined,
      text: c.text,
      createdAt: c.created_at,
    })),
  };
}
