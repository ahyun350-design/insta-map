"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { debugLog, dlog } from "@/lib/debugLog";
import { withAutoRetry, withAutoRetryAndMessageSendRecovery } from "@/lib/connectionRecovery";
import { useUser } from "@/lib/useUser";
import { usePushNotifications } from "@/lib/usePushNotifications";
import { InAppNotificationToast } from "@/components/InAppNotificationToast";
import {
  formatInAppNotificationFromRow,
  formatMessageInAppText,
  type InAppNotificationItem,
} from "@/lib/inAppNotification";
import { useInAppNotifications } from "@/lib/useInAppNotifications";
import FeedSkeleton from "@/components/FeedSkeleton";
import EmptyState from "@/components/EmptyState";
import { useToast } from "@/components/Toast";
import { prepareImageForUpload } from "@/lib/prepareImageForUpload";
import {
  addNativeMarkers,
  clearNativeMarkerClickHandlers,
  clearNativeMarkers,
  createNativeMap,
  destroyNativeMap,
  isNativeMapAvailable,
  presentFullscreenNativeMap,
  dismissFullscreenNativeMap,
  updateFullscreenNativeMarkers,
  setFullscreenNativeCamera,
  setFullscreenNativeRoute,
  setFullscreenNativeSearchResults,
  clearFullscreenNativeSearchResults,
  setFullscreenNativePlaceSaved,
  setFullscreenNativeDirectionsInfo,
  setFullscreenNativeMyLocation,
  setNativeCamera,
  setNativeMarkerClickHandler,
} from "@/lib/nativeMap";
import { PindmapNativeMap } from "@pindmap/native-map";
import { uploadAvatar } from "@/lib/uploadAvatar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { FollowListModal, type FollowListType } from "@/components/FollowListModal";
import { ChatCourseCard } from "@/components/ChatCourseCard";
import { CourseEditScreen } from "@/components/CourseEditScreen";
import { NewCurationScreen } from "@/components/NewCurationScreen";
import { MAX_CURATION_PHOTOS } from "@/components/curation/types";
import {
  companionFilterChipLabel,
  isCompanionTag,
  type CompanionTag,
  type CompanionTagFilter,
} from "@/lib/companionTag";
import { CompanionTagFilterChips } from "@/components/CompanionTagFilterChips";
import { HomeFeedTopBar } from "@/components/HomeFeedTopBar";
import { HomeSearchScreen } from "@/components/HomeSearchScreen";
import { feedPostMatchesHomeSearch } from "@/lib/homeFeedSearch";
import { feedPostMatchesCategoryFilter, getDisplayCategories } from "@/lib/categoryUtil";
import { HomeCategoryFilterChips, type HomeCategoryFilter } from "@/components/HomeCategoryFilterChips";
import { BottomTabBar } from "@/components/BottomTabBar";
import { useNativeKeyboard } from "@/lib/useNativeKeyboard";
import { FeedPostMedia } from "@/components/FeedPostCard";
import { FeedPostLinkedCourse } from "@/components/FeedPostLinkedCourse";
import { PlaceDetailSheet } from "@/components/PlaceDetailSheet";
import { MapSearchResultsSheet, type MapSearchPlaceResult } from "@/components/MapSearchResultsSheet";
import { MapResearchAreaButton } from "@/components/MapResearchAreaButton";
import { feedPostToPlaceSheet, type PlaceSheetData } from "@/lib/placeSheet";
import { PostGrid } from "@/components/PostGrid";
import { PostGridCell } from "@/components/PostGridCell";
import { UserAvatarCache, collectFeedPostAvatarKeys, normalizeAvatarUrl } from "@/lib/userAvatarCache";
import { fetchIsPostLikedByUser, toggleLikeRow } from "@/lib/likes";
import {
  buildCourseShareText,
  deleteCourse,
  fetchCourseById,
  fetchMyCourses,
  importCourse,
  formatCourseDate,
  saveCourse,
  updateCourseItems,
  updateCourseTitle,
  type SavedCourse,
  type SavedCourseItem,
} from "@/lib/courses";
import {
  getCurrentPositionForMapStage1,
  getCurrentPositionForMapStage2,
  isGeolocationPermissionDenied,
} from "@/lib/getCurrentPositionForMap";
import { MessageUserSearchRow } from "@/components/MessageUserSearchRow";
import { getDisplayFriendName } from "@/lib/friendDisplay";
import { searchUsersByUsername, type UserSearchHit } from "@/lib/userSearch";
import {
  copyTextToClipboard,
  getCourseShareUrl,
  shareViaNavigatorShare,
} from "@/lib/pindmapLinks";
import { parseFeedPostFromRow, type FeedPost, type PhotoPlaceTag } from "@/lib/feedPost";
import {
  getDisplayPlaceForPhoto,
  getRelatedPostImagesForPlace,
  getRepresentativePhotoPlaceTag,
  hasPhotoPlaceTags,
  buildUniqueCourseItemsFromPhotoPlaceTags,
  mergeRelatedFeedPostsForPlaceSheet,
  type PlaceRefForPhotoTagMatch,
} from "@/lib/photoPlaceTag";
type TabId = "home" | "messages" | "map" | "saved" | "mypage";
type Category = "맛집" | "카페" | "쇼핑" | "숙소" | "놀거리" | "여행지";

/** 큐레이션·저장 탭 카테고리 나열 순 */
const CATEGORY_MAIN_ORDER: Category[] = ["맛집", "카페", "쇼핑", "숙소", "놀거리", "여행지"];
const CATEGORY_COURSE_MODAL_ORDER: Category[] = ["카페", "맛집", "쇼핑", "숙소", "놀거리", "여행지"];
/** 현재 위치 기반 코스 추천 반경 (km) */
const COURSE_WALK_RADIUS_KM = 1.5;
const DEFAULT_AVOID_CONSECUTIVE_CATEGORIES: Category[] = ["카페", "맛집"];

/** 카카오/검색 `category_name` 기반 자동 카테고리 */
function inferCategoryFromKakaoCategoryName(categoryName: string | undefined): Category {
  const n = categoryName ?? "";
  if (n.includes("카페")) return "카페";
  if (n.includes("음식") || n.includes("맛집")) return "맛집";
  if (n.includes("숙박") || n.includes("호텔")) return "숙소";
  if (
    n.includes("문화") ||
    n.includes("관광") ||
    n.includes("여행") ||
    n.includes("자연") ||
    n.includes("명소")
  ) {
    return "여행지";
  }
  if (
    n.includes("게임") ||
    n.includes("오락") ||
    n.includes("노래방") ||
    n.includes("볼링") ||
    n.includes("영화") ||
    n.includes("PC방") ||
    n.includes("스포츠")
  ) {
    return "놀거리";
  }
  return "쇼핑";
}
type Place = { id: string; name: string; address: string; category: Category; lat?: number; lng?: number };
type KakaoStatus = "idle" | "loading" | "ready" | "error";

/** autoload=false: script onload 후 maps.load() 완료 전에는 LatLng 등이 없음 */
function isKakaoMapsApiReady(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return typeof window.kakao?.maps?.LatLng === "function";
  } catch {
    return false;
  }
}

/** maps.load 콜백·readyState 폴링 (LAN IP origin silent fail 진단용) */
function beginKakaoMapsLoad(onReady: () => void): void {
  if (!window.kakao?.maps) {
    console.error("[PindMap:kakao] beginKakaoMapsLoad — no window.kakao.maps");
    return;
  }
  const origin = window.location.origin;
  const readyState = (window.kakao.maps as { readyState?: number }).readyState;
  console.log("[PindMap:kakao] calling maps.load()", { origin, readyState });

  let polls = 0;
  const pollId = window.setInterval(() => {
    polls += 1;
    const rs = (window.kakao?.maps as { readyState?: number })?.readyState;
    console.log("[PindMap:kakao] maps.load poll", {
      polls,
      readyState: rs,
      hasLatLng: isKakaoMapsApiReady(),
      origin,
    });
    if (isKakaoMapsApiReady()) {
      window.clearInterval(pollId);
    } else if (polls >= 30) {
      window.clearInterval(pollId);
      console.error("[PindMap:kakao] maps.load stalled 30s — origin may be blocked by Kakao domain auth", {
        origin,
        hint: "Use Railway HTTPS staging, not http://192.168.x.x LAN IP",
      });
    }
  }, 1000);

  try {
    window.kakao.maps.load(() => {
      window.clearInterval(pollId);
      console.log("[PindMap:kakao] maps.load callback fired", {
        hasLatLng: isKakaoMapsApiReady(),
        readyState: (window.kakao?.maps as { readyState?: number })?.readyState,
      });
      onReady();
    });
  } catch (err) {
    window.clearInterval(pollId);
    console.error("[PindMap:kakao] maps.load threw", err);
  }
}
type Comment = { id: string; user: string; userId?: string; avatarUrl?: string; text: string; createdAt: string };
type PostImageItem = {
  id: string;
  previewUrl: string;
  publicUrl?: string;
  status: "uploading" | "uploaded" | "failed";
  file?: File;
  error?: string;
};
type FriendRoom = { id: string; friendId: string; friendName: string; friendAvatarUrl?: string };
type ChatRoom = { id: string; friendId: string; friendName: string; friendAvatarUrl?: string; lastMessage: string; lastTime: string; unreadCount: number; };

/** 마지막 메시지 시각(lastTime) 기준 최신순 — DM 앱과 동일 */
function sortChatRoomsByRecency(rooms: ChatRoom[]): ChatRoom[] {
  return [...rooms].sort(
    (a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime(),
  );
}
type Message = { id: string; senderId: string; text: string; createdAt: string; read?: boolean; status?: "pending" | "sent" | "failed"; };

const CHAT_MESSAGES_PAGE_SIZE = 50;
const PROFILE_BIO_MAX_LENGTH = 150;
const REALTIME_REMOUNT_DEBOUNCE_MS = 1000;
const REALTIME_REMOUNT_BACKOFFS_MS = [1000, 3000, 10000] as const;
const REALTIME_REMOUNT_MAX_RETRIES = 5;
const REALTIME_ERROR_STATUSES = new Set(["CHANNEL_ERROR", "CLOSED", "TIMED_OUT"]);

function promiseWithTimeout<T>(p: Promise<T>, ms: number, label: string, abort?: AbortController): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      abort?.abort();
      reject(new Error(`${label}:timeout`));
    }, ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

type ExtractJobStatus = "pending" | "processing" | "completed" | "failed";
type ActiveExtractJob = {
  jobId: string;
  instagramUrl: string;
  status: ExtractJobStatus;
  progressStep: string;
};
type ExtractStatusResponse = {
  status: ExtractJobStatus;
  progress_step?: string;
  /** 서버가 DB insert 후 id 포함해 반환 (클라이언트 insert 불필요) */
  result_places?: Array<Omit<Place, "id"> & { id?: string }>;
  error_message?: string | null;
  error?: string;
};
type LatLng = { lat: number; lng: number };

function coerceLatLng(lat?: unknown, lng?: unknown): LatLng | null {
  const la = typeof lat === "number" ? lat : parseFloat(String(lat ?? ""));
  const ln = typeof lng === "number" ? lng : parseFloat(String(lng ?? ""));
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return { lat: la, lng: ln };
}

/** 카카오 POI: y=위도(lat), x=경도(lng) */
function kakaoYXToLatLng(y?: unknown, x?: unknown): LatLng | null {
  return coerceLatLng(y, x);
}

function latLngFromRow(row: { lat?: unknown; lng?: unknown }): LatLng | null {
  return coerceLatLng(row.lat, row.lng);
}

function mapPlaceRow(p: { id: string; name: string; address: string; category: string; lat?: unknown; lng?: unknown }): Place {
  const coords = latLngFromRow(p);
  return {
    id: p.id,
    name: p.name,
    address: p.address,
    category: p.category as Category,
    ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
  };
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/서울특별시|서울시|부산광역시|인천광역시|대구광역시|대전광역시|광주광역시|울산광역시|세종특별자치시/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeAddress(value: string): string {
  return normalizeText(value);
}

function namesAreSimilar(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 이 지역 재검색 버튼 — 최소 이동 거리(m) 및 화면 높이 대비 비율 */
const MAP_RESEARCH_MIN_DISTANCE_M = 600;
const MAP_RESEARCH_VIEWPORT_RATIO = 0.25;

function getMapResearchDistanceThresholdM(map: { getBounds?: () => { getNorthEast: () => { getLat: () => number }; getSouthWest: () => { getLat: () => number } } } | null): number {
  try {
    const bounds = map?.getBounds?.();
    if (bounds) {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const latSpan = Math.abs(ne.getLat() - sw.getLat());
      const visibleHeightM = latSpan * 111320;
      return Math.max(MAP_RESEARCH_MIN_DISTANCE_M, visibleHeightM * MAP_RESEARCH_VIEWPORT_RATIO);
    }
  } catch {
    /* noop */
  }
  return MAP_RESEARCH_MIN_DISTANCE_M;
}

/** Kakao Native SDK zoomLevel: 숫자 클수록 가까움 (동네 ~16, 도시 ~12, 전국 ~7) */
const FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM = 16;
const FULLSCREEN_NATIVE_DEFAULT_ENTRY_ZOOM = 16;

function estimateKakaoNativeZoomLevelForLatLngSpan(
  latSpan: number,
  lngSpan: number,
  minLevel = 12,
  maxLevel = 16,
): number {
  const span = Math.max(latSpan, lngSpan);
  if (span <= 0) return FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM;
  let level: number;
  if (span < 0.002) level = 17;
  else if (span < 0.006) level = 16;
  else if (span < 0.015) level = 15;
  else if (span < 0.04) level = 14;
  else if (span < 0.12) level = 13;
  else if (span < 0.35) level = 12;
  else if (span < 1.0) level = 10;
  else if (span < 2.5) level = 8;
  else level = 7;
  return Math.max(minLevel, Math.min(maxLevel, level));
}

/** JS Kakao Map level(작을수록 가까움) → Native SDK zoomLevel(클수록 가까움) */
function kakaoJsLevelToNativeZoomLevel(jsLevel: number): number {
  const level = Math.round(jsLevel);
  return Math.max(1, Math.min(20, 21 - level));
}

function computeFullscreenNativeSearchCamera(
  markers: LatLng[],
  options?: { preserveView?: boolean },
): { lat: number; lng: number; zoom: number } | null {
  if (options?.preserveView) return null;
  const valid = markers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    return { lat: valid[0]!.lat, lng: valid[0]!.lng, zoom: FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM };
  }
  const fitMarkers = valid.slice(0, 3);
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const m of fitMarkers) {
    minLat = Math.min(minLat, m.lat);
    maxLat = Math.max(maxLat, m.lat);
    minLng = Math.min(minLng, m.lng);
    maxLng = Math.max(maxLng, m.lng);
  }
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  const padding = Math.max(latSpan, lngSpan) * 0.1 + 0.001;
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
    zoom: estimateKakaoNativeZoomLevelForLatLngSpan(
      latSpan + padding,
      lngSpan + padding,
      14,
      16,
    ),
  };
}

function computeFullscreenNativeEntryCamera(
  markers: Array<{ lat: number; lng: number }>,
  fallback: { lat: number; lng: number },
  options?: { myLocation?: LatLng | null; useMyLocation?: boolean },
): { lat: number; lng: number; zoom: number } {
  const useMyLocation = options?.useMyLocation !== false;
  const myLocation = options?.myLocation;
  if (
    useMyLocation &&
    myLocation &&
    Number.isFinite(myLocation.lat) &&
    Number.isFinite(myLocation.lng)
  ) {
    return {
      lat: myLocation.lat,
      lng: myLocation.lng,
      zoom: FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM,
    };
  }

  const valid = markers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
  const markerZoomBounds = useMyLocation
    ? { min: 12, max: 16 }
    : { min: 10, max: 16 };

  if (valid.length === 0) {
    return { lat: fallback.lat, lng: fallback.lng, zoom: FULLSCREEN_NATIVE_DEFAULT_ENTRY_ZOOM };
  }
  if (valid.length === 1) {
    return { lat: valid[0]!.lat, lng: valid[0]!.lng, zoom: FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM };
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const m of valid) {
    minLat = Math.min(minLat, m.lat);
    maxLat = Math.max(maxLat, m.lat);
    minLng = Math.min(minLng, m.lng);
    maxLng = Math.max(maxLng, m.lng);
  }
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  const padding = Math.max(latSpan, lngSpan) * 0.2 + 0.005;
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
    zoom: estimateKakaoNativeZoomLevelForLatLngSpan(
      latSpan + padding,
      lngSpan + padding,
      markerZoomBounds.min,
      markerZoomBounds.max,
    ),
  };
}

/** 동명이 장소 큐레이션 매칭 — 같은 블록(약 100m) 또는 좌표 없을 때 주소 텍스트 fallback */
const RELATED_POST_MAX_DISTANCE_M = 100;

type RelatedPostAnchor = {
  placeName: string;
  lat?: number;
  lng?: number;
  address?: string;
};

function relatedAnchorFromPlace(place: Place): RelatedPostAnchor {
  return { placeName: place.name, lat: place.lat, lng: place.lng, address: place.address };
}

function relatedAnchorFromKakaoPlace(place: {
  place_name?: string;
  y?: string | number;
  x?: string | number;
  road_address_name?: string;
  address_name?: string;
}): RelatedPostAnchor {
  const coords = kakaoYXToLatLng(place.y, place.x);
  return {
    placeName: String(place.place_name ?? ""),
    ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
    address: String(place.road_address_name || place.address_name || ""),
  };
}

function filterRelatedFeedPosts(posts: FeedPost[], anchor: RelatedPostAnchor): FeedPost[] {
  const targetName = anchor.placeName.trim();
  if (!targetName) return [];

  const anchorCoords = latLngFromRow(anchor);
  const anchorAddr = normalizeAddress(anchor.address ?? "");

  return posts.filter((p) => {
    if (p.archived) return false;
    if (p.placeName.trim() !== targetName) return false;

    const postCoords = latLngFromRow(p);
    if (anchorCoords && postCoords) {
      return (
        distanceMeters(anchorCoords.lat, anchorCoords.lng, postCoords.lat, postCoords.lng) <=
        RELATED_POST_MAX_DISTANCE_M
      );
    }

    const postAddr = normalizeAddress(p.address ?? "");
    if (anchorAddr && postAddr) {
      return anchorAddr === postAddr || anchorAddr.includes(postAddr) || postAddr.includes(anchorAddr);
    }

    return !anchorCoords && !postCoords;
  });
}

/** PlaceDetailSheet 관련 큐레이션 — 사진 태그 매칭 + legacy 거리 매칭 합침 (filterRelatedFeedPosts 본체는 그대로) */
function getRelatedPostsForPlaceSheet(
  posts: FeedPost[],
  placeRef: PlaceRefForPhotoTagMatch,
): FeedPost[] {
  return mergeRelatedFeedPostsForPlaceSheet(posts, placeRef, filterRelatedFeedPosts);
}

const MAX_NATIVE_MARKER_PHOTOS = 5;

function getMarkerPhotoMetaForPlace(
  posts: FeedPost[],
  place: Place,
  coords?: LatLng,
): { photos: string[]; postCount: number; photoPostIds: string[] } {
  const placeRef = placeRefFromPlace(place, coords?.lat, coords?.lng);
  const relatedPosts = getRelatedPostsForPlaceSheet(posts, placeRef);
  const photos: string[] = [];
  const photoPostIds: string[] = [];
  const seen = new Set<string>();
  for (const post of relatedPosts) {
    for (const url of getRelatedPostImagesForPlace(post, placeRef)) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      photos.push(url);
      photoPostIds.push(post.id);
      if (photos.length >= MAX_NATIVE_MARKER_PHOTOS) break;
    }
    if (photos.length >= MAX_NATIVE_MARKER_PHOTOS) break;
  }
  return { photos, postCount: relatedPosts.length, photoPostIds };
}

function placeRefFromPlace(place: Place, lat?: number, lng?: number): PlaceRefForPhotoTagMatch {
  const coords =
    typeof lat === "number" && typeof lng === "number"
      ? { lat, lng }
      : latLngFromRow(place) ?? undefined;
  return {
    placeId: place.id,
    placeName: place.name,
    address: place.address,
    ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
  };
}

function placeRefFromKakaoPlace(place: {
  id?: string;
  place_name?: string;
  y?: string | number;
  x?: string | number;
  road_address_name?: string;
  address_name?: string;
}): PlaceRefForPhotoTagMatch {
  const anchor = relatedAnchorFromKakaoPlace(place);
  return {
    placeId: place.id ?? null,
    placeName: anchor.placeName,
    address: anchor.address,
    ...(anchor.lat != null && anchor.lng != null ? { lat: anchor.lat, lng: anchor.lng } : {}),
  };
}

function placeRefFromFeedPost(post: FeedPost, photoIndex = 0): PlaceRefForPhotoTagMatch {
  const display = getDisplayPlaceForPhoto(post, photoIndex);
  if (display) {
    return {
      placeId: display.placeId,
      placeName: display.placeName,
      address: display.address,
      lat: display.lat,
      lng: display.lng,
    };
  }
  if (hasPhotoPlaceTags(post)) {
    return { placeName: "", address: "", placeId: null };
  }
  return {
    placeName: post.placeName,
    address: post.address,
    lat: post.lat,
    lng: post.lng,
    placeId: null,
  };
}

declare global { interface Window { kakao: any; } }

/**
 * 확장 지도 검색 결과(파란 핀 근처) 탭 처리용.
 * WKWebView에서 마커 click이 불안정할 때 지도 투영 픽셀 거리로 동일 장소를 찾기 위함.
 */
function pickNearestExpandedSearchPlaceByPixel(map: any, lat: number, lng: number, candidates: any[], maxPx: number): any | null {
  const k = typeof window !== "undefined" ? window.kakao : undefined;
  const proj = map?.getProjection?.();
  if (!k?.maps?.LatLng || !proj?.pointFromCoords) return null;
  let origin: { x: number; y: number };
  try {
    origin = proj.pointFromCoords(new k.maps.LatLng(lat, lng));
  } catch {
    return null;
  }
  let best: any | null = null;
  let bestPx = Infinity;
  for (const p of candidates) {
    const py = parseFloat(p.y);
    const px = parseFloat(p.x);
    if (Number.isNaN(py) || Number.isNaN(px)) continue;
    let pt: { x: number; y: number };
    try {
      pt = proj.pointFromCoords(new k.maps.LatLng(py, px));
    } catch {
      continue;
    }
    const d = Math.hypot(pt.x - origin.x, pt.y - origin.y);
    if (d < bestPx) {
      bestPx = d;
      best = p;
    }
  }
  return bestPx <= maxPx ? best : null;
}

/** WKWebView: 저장 핀 마커 click 불안정 시 touchend→픽셀 매칭(검색 핀 헬퍼와 동일 56px) */
function pickNearestSavedPlaceByPixel(
  map: any,
  tapLat: number,
  tapLng: number,
  places: Place[],
  coordsById: Record<string, LatLng>,
  hiddenPlaceIds: Set<string>,
  maxPx: number,
): Place | null {
  const k = typeof window !== "undefined" ? window.kakao : undefined;
  const proj = map?.getProjection?.();
  if (!k?.maps?.LatLng || !proj?.pointFromCoords) return null;
  let origin: { x: number; y: number };
  try {
    origin = proj.pointFromCoords(new k.maps.LatLng(tapLat, tapLng));
  } catch {
    return null;
  }
  let bestPlace: Place | null = null;
  let bestPx = Infinity;
  for (const p of places) {
    if (hiddenPlaceIds.has(p.id)) continue;
    const c = coordsById[p.id];
    if (!c || typeof c.lat !== "number" || typeof c.lng !== "number") continue;
    let pt: { x: number; y: number };
    try {
      pt = proj.pointFromCoords(new k.maps.LatLng(c.lat, c.lng));
    } catch {
      continue;
    }
    const d = Math.hypot(pt.x - origin.x, pt.y - origin.y);
    if (d < bestPx) {
      bestPx = d;
      bestPlace = p;
    }
  }
  return bestPx <= maxPx ? bestPlace : null;
}

const CHAT_LIST = [
  { id: "1", name: "지수", preview: "이번 주말 성수 갈래?", time: "오후 4:12" },
  { id: "2", name: "민호", preview: "저장해둔 카페 링크 보내줘!", time: "오전 11:05" },
  { id: "3", name: "여행메이트", preview: "부산 맛집 리스트 공유했어", time: "어제" },
];

const CATEGORY_CLASS: Record<Category, string> = {
  맛집: "restaurant",
  카페: "cafe",
  쇼핑: "shopping",
  숙소: "stay",
  놀거리: "fun",
  여행지: "travel",
};
const CATEGORY_PIN: Record<Category, { color: string; emoji: string }> = {
  맛집: { color: "#513229", emoji: "🍽️" },
  카페: { color: "#FCE6B7", emoji: "☕" },
  쇼핑: { color: "#D8EBF9", emoji: "🛍️" },
  숙소: { color: "#D7D4B1", emoji: "🏠" },
  놀거리: { color: "#c4b5fd", emoji: "🎮" },
  여행지: { color: "#99e9f2", emoji: "🗺️" },
};
const CATEGORY_COLORS: Record<Category, string> = {
  맛집: "#513229",
  카페: "#b08d57",
  쇼핑: "#4a7fa5",
  숙소: "#7a7a50",
  놀거리: "#6d4bd6",
  여행지: "#1b9aad",
};
const ACTIVE_JOBS_STORAGE_KEY = "pindmap_active_extract_jobs";
const HIDDEN_PLACE_IDS_STORAGE_KEY = "pindmap_hidden_place_ids";

function makeMarkerImage(category: Category) {
  const { color, emoji } = CATEGORY_PIN[category];
  const stroke = category === "맛집" ? "#fff" : "#999";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${color}" stroke="${stroke}" stroke-width="1"/><circle cx="18" cy="18" r="13" fill="white" opacity="0.9"/><text x="18" y="23" text-anchor="middle" font-size="14">${emoji}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function makeMyLocationImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1a2a7a" stroke="white" stroke-width="2.5"/><circle cx="12" cy="12" r="4" fill="white"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금 전"; if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`; return `${Math.floor(h / 24)}일 전`;
}
function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h < 12 ? "오전" : "오후";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${hour12}:${m}`;
}
function extractRegion(address: string): string {
  if (!address) return "기타";
  const parts = address.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return parts[0] || "기타";
}

function cleanInstagramUrl(url: string): string {
  const match = url.match(/(https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[^/?#]+)/);
  if (match) {
    return `${match[1]}/`;
  }
  return url;
}

// 두 좌표 사이의 직선거리 (km) - Haversine 공식
function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // 지구 반지름 (km)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const FULLSCREEN_COURSE_DIRECTIONS_WARN_STOPS = 10;

function parseDirectionsRouteToPath(route: {
  sections?: { roads?: { vertexes?: number[] }[] }[];
}): LatLng[] {
  const path: LatLng[] = [];
  route.sections?.forEach((section) => {
    section.roads?.forEach((road) => {
      const vertexes = road.vertexes ?? [];
      for (let i = 0; i < vertexes.length; i += 2) {
        const lng = Number(vertexes[i]);
        const lat = Number(vertexes[i + 1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          path.push({ lat, lng });
        }
      }
    });
  });
  return path;
}

function straightLineSegmentPath(origin: LatLng, destination: LatLng): LatLng[] {
  return [origin, destination];
}

async function fetchDirectionsSegmentPath(
  origin: LatLng,
  destination: LatLng,
): Promise<LatLng[]> {
  try {
    const res = await fetch("/api/directions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination, mode: "car" }),
    });
    const data = (await res.json()) as {
      routes?: { sections?: { roads?: { vertexes?: number[] }[] }[] }[];
    };
    const route = data.routes?.[0];
    if (!route) return straightLineSegmentPath(origin, destination);
    const path = parseDirectionsRouteToPath(route);
    return path.length >= 2 ? path : straightLineSegmentPath(origin, destination);
  } catch {
    return straightLineSegmentPath(origin, destination);
  }
}

/** 코스 장소 순서대로 인접 구간마다 도로 경로를 요청해 하나의 path로 이어붙임. */
async function buildCourseRoadPathFromDirections(stops: LatLng[]): Promise<LatLng[]> {
  if (stops.length < 2) return stops;
  const merged: LatLng[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const segment = await fetchDirectionsSegmentPath(stops[i]!, stops[i + 1]!);
    if (merged.length === 0) merged.push(...segment);
    else merged.push(...segment.slice(1));
  }
  return merged.length >= 2 ? merged : stops;
}

function parseTmapWalkGeoJsonToPath(data: {
  features?: {
    geometry?: { type?: string; coordinates?: number[][] };
  }[];
}): LatLng[] {
  const path: LatLng[] = [];
  data.features?.forEach((feature) => {
    if (feature.geometry?.type !== "LineString") return;
    const coordinates = feature.geometry.coordinates ?? [];
    coordinates.forEach((coord) => {
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        path.push({ lat, lng });
      }
    });
  });
  return path;
}

async function fetchWalkDirectionsSegmentPath(
  origin: LatLng,
  destination: LatLng,
): Promise<LatLng[]> {
  try {
    const res = await fetch("/api/walk-directions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination }),
    });
    if (!res.ok) return straightLineSegmentPath(origin, destination);
    const data = (await res.json()) as {
      features?: { geometry?: { type?: string; coordinates?: number[][] } }[];
    };
    const path = parseTmapWalkGeoJsonToPath(data);
    return path.length >= 2 ? path : straightLineSegmentPath(origin, destination);
  } catch {
    return straightLineSegmentPath(origin, destination);
  }
}

/** 코스 장소 순서대로 인접 구간마다 Tmap 보행자 경로를 요청해 하나의 path로 이어붙임. */
async function buildCourseWalkPathFromTmap(stops: LatLng[]): Promise<LatLng[]> {
  if (stops.length < 2) return stops;
  const merged: LatLng[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const segment = await fetchWalkDirectionsSegmentPath(stops[i]!, stops[i + 1]!);
    if (merged.length === 0) merged.push(...segment);
    else merged.push(...segment.slice(1));
  }
  return merged.length >= 2 ? merged : stops;
}

// 좌표가 있는 장소들에서 가까운 순으로 코스 짜기 (Nearest Neighbor 알고리즘)
type CoursePlace = Place & { lat: number; lng: number };

function coursePlaceToSavedItem(p: CoursePlace): SavedCourseItem {
  return { id: p.id, name: p.name, address: p.address, category: p.category, lat: p.lat, lng: p.lng };
}

function savedItemToCoursePlace(it: SavedCourseItem): CoursePlace {
  return {
    id: it.id,
    name: it.name,
    address: it.address,
    category: it.category as Category,
    lat: it.lat,
    lng: it.lng,
  };
}

function placeToSavedItemIfCoords(place: Place): SavedCourseItem | null {
  const coords = latLngFromRow(place);
  if (!coords) return null;
  return {
    id: place.id,
    name: place.name,
    address: place.address,
    category: place.category,
    lat: coords.lat,
    lng: coords.lng,
  };
}

function buildCourse(
  origin: { lat: number; lng: number },
  candidates: CoursePlace[],
  options?: { avoidConsecutiveCategories?: Category[] },
): CoursePlace[] {
  const remaining = [...candidates];
  const result: CoursePlace[] = [];
  let currentLat = origin.lat;
  let currentLng = origin.lng;
  const avoidCategories = options?.avoidConsecutiveCategories ?? DEFAULT_AVOID_CONSECUTIVE_CATEGORIES;
  const shouldAvoidConsecutive = (cat: Category) => avoidCategories.includes(cat);

  while (remaining.length > 0) {
    const prevCategory = result[result.length - 1]?.category ?? null;
    const scored = remaining
      .map((p, i) => ({ i, p, d: getDistance(currentLat, currentLng, p.lat, p.lng) }))
      .sort((a, b) => a.d - b.d);

    let pick = scored[0]!;

    if (prevCategory && shouldAvoidConsecutive(prevCategory)) {
      const alternate = scored.find(({ p }) => p.category !== prevCategory);
      if (alternate) pick = alternate;
    }

    result.push(pick.p);
    currentLat = pick.p.lat;
    currentLng = pick.p.lng;
    remaining.splice(pick.i, 1);
  }

  return result;
}

function shufflePick<T>(items: T[], count: number): T[] {
  if (count <= 0) return [];
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = temp;
  }
  return copy.slice(0, count);
}

function parseDetailReturnTo(
  sp: { get: (key: string) => string | null } | null | undefined,
): { type: "mypage" } | { type: "profile"; username: string } | null {
  const from = sp?.get("from");
  const username = sp?.get("username");
  if (from === "profile" && username) {
    return { type: "profile", username: decodeURIComponent(username) };
  }
  if (from === "mypage") return { type: "mypage" };
  return null;
}

export default function HomePage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa" }}><p style={{ fontSize: "13px", color: "#888" }}>불러오는 중...</p></main>}>
      <HomePageContent />
    </Suspense>
  );
}

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: userLoading, sessionChecked, loggingOut, logout, reloadUserFromSession, verifySessionQuick, patchUser } =
    useUser();

  const AUTH_RELOAD_USER_TIMEOUT_MS = 5000;
  const [authRetryPending, setAuthRetryPending] = useState(false);
  const authStallRetryRef = useRef(0);

  const reloadUserWithTimeout = useCallback(async (): Promise<boolean> => {
    try {
      await Promise.race([
        reloadUserFromSession(),
        new Promise<void>((_, reject) => {
          window.setTimeout(() => reject(new Error("reloadUserFromSession:timeout")), AUTH_RELOAD_USER_TIMEOUT_MS);
        }),
      ]);
      return true;
    } catch {
      return false;
    }
  }, [reloadUserFromSession]);

  useEffect(() => {
    if (user) authStallRetryRef.current = 0;
  }, [user]);

  useEffect(() => {
    if (typeof history.scrollRestoration === "string") {
      history.scrollRestoration = "manual";
    }
  }, []);

  const handleLogoutClick = async () => {
    if (!confirm("정말 로그아웃하시겠어요?")) return;
    try {
      await logout();
    } catch (err) {
      console.error("[PindMap:home][auth] logout handler failed", err);
    }
  };
  usePushNotifications(user?.id);
  const MY_USER = user?.id || "";
  const MY_USERNAME = user?.username || "";
  const userSendRef = useRef(user);
  userSendRef.current = user;
  const userIdRef = useRef<string>("");
  userIdRef.current = user?.id || "";
  type Notification = {
    id: string;
    user_id: string;
    type: "like" | "comment" | "follow" | "message";
    actor_id: string;
    actor_username: string;
    actorAvatarUrl?: string;
    target_id: string | null;
    target_text: string | null;
    read: boolean;
    created_at: string;
  };

  const syncCurrentUserToAvatarCache = useCallback(() => {
    if (!user?.id) return;
    userAvatarCacheRef.current.setFromRow({
      id: user.id,
      username: user.username,
      avatar_url: user.avatar_url,
    });
  }, [user?.id, user?.username, user?.avatar_url]);

  const hydrateFeedPostsWithAvatars = useCallback((posts: FeedPost[]): FeedPost[] => {
    const cache = userAvatarCacheRef.current;
    return posts.map((p) => ({
      ...p,
      userAvatarUrl: cache.resolve(p.userId, p.user),
      comments: p.comments.map((c) => ({
        ...c,
        avatarUrl: cache.resolve(c.userId, c.user),
      })),
    }));
  }, []);

  const hydrateNotificationsWithAvatars = useCallback((items: Notification[]): Notification[] => {
    const cache = userAvatarCacheRef.current;
    return items.map((n) => ({
      ...n,
      actorAvatarUrl: cache.getByUserId(n.actor_id),
    }));
  }, []);

  const prefetchAvatarsForFeedPosts = useCallback(async (posts: FeedPost[]) => {
    const { userIds, usernames } = collectFeedPostAvatarKeys(posts);
    const cache = userAvatarCacheRef.current;
    await Promise.all([cache.prefetchByIds(userIds), cache.prefetchByUsernames(usernames)]);
  }, []);

  const prefetchAvatarsForNotifications = useCallback(async (items: Notification[]) => {
    const actorIds = [...new Set(items.map((n) => n.actor_id).filter(Boolean))];
    await userAvatarCacheRef.current.prefetchByIds(actorIds);
  }, []);

  const userAvatarCacheRef = useRef(new UserAvatarCache());
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const {
    current: inAppNotificationCurrent,
    enqueue: enqueueInAppNotification,
    handleDismiss: handleInAppNotificationDismiss,
  } = useInAppNotifications();
  const enqueueInAppNotificationRef = useRef<(item: InAppNotificationItem) => void>(() => {});
  enqueueInAppNotificationRef.current = enqueueInAppNotification;
  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [friendRooms, setFriendRooms] = useState<FriendRoom[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [showCourseShareModal, setShowCourseShareModal] = useState(false);
  const [sharingCourse, setSharingCourse] = useState<SavedCourse | null>(null);
  const [courseShareFriendRooms, setCourseShareFriendRooms] = useState<FriendRoom[]>([]);
  const [courseShareLoading, setCourseShareLoading] = useState(false);
  const [courseShareSendingRoomId, setCourseShareSendingRoomId] = useState<string | null>(null);
  const [courseShareSearchQuery, setCourseShareSearchQuery] = useState("");
  const [courseShareSentRoomIds, setCourseShareSentRoomIds] = useState<string[]>([]);
  const [showProfileEditModal, setShowProfileEditModal] = useState(false);
  const [profileEditName, setProfileEditName] = useState("");
  const [profileEditBio, setProfileEditBio] = useState("");
  const [profileEditSaving, setProfileEditSaving] = useState(false);
  const [profileEditAvatarPreview, setProfileEditAvatarPreview] = useState<string | null>(null);
  const [profileEditPendingFile, setProfileEditPendingFile] = useState<File | null>(null);
  const profileEditAvatarBlobRef = useRef<string | null>(null);
  const profileAvatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const [showMypageSettingsSheet, setShowMypageSettingsSheet] = useState(false);
  const [mypageFollowerCount, setMypageFollowerCount] = useState(0);
  const [mypageFollowingCount, setMypageFollowingCount] = useState(0);
  const [showFollowList, setShowFollowList] = useState<FollowListType | null>(null);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showDeleteAccountFinalModal, setShowDeleteAccountFinalModal] = useState(false);
  const [deleteAccountPhraseInput, setDeleteAccountPhraseInput] = useState("");
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const tab = searchParams?.get("tab");
    if (tab === "home") return "home";
    if (tab === "messages") return "messages";
    if (tab === "mypage" || searchParams?.get("from") === "mypage") return "mypage";
    return "map";
  });
  const [instagramUrl, setInstagramUrl] = useState("");
  const [savedPlaces, setSavedPlaces] = useState<Place[]>([]);
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [homeLoadError, setHomeLoadError] = useState<string | null>(null);
  const [homeRetrying, setHomeRetrying] = useState(false);
  const [kakaoStatus, setKakaoStatus] = useState<KakaoStatus>("idle");
  /** 카카오맵 JS SDK 객체 사용 가능 (`kakao.maps.load` 콜백 이후 true) */
  const [isKakaoMapLoaded, setIsKakaoMapLoaded] = useState(false);
  /** 지도 탭 작은 지도 패널에 Map 인스턴스 생성까지 완료 */
  const [compactMapReady, setCompactMapReady] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  /** V-7-1: 확장 지도 상단 50% Kakao Native 오버레이 (iOS만, JS API와 병행) */
  const [expandedNativeMapEnabled, setExpandedNativeMapEnabled] = useState(false);
  const fullscreenSearchListenerRegisteredRef = useRef(false);
  const fullscreenResearchListenerRegisteredRef = useRef(false);
  const fullscreenPlaceDetailListenerRegisteredRef = useRef(false);
  const fullscreenDirectionsListenerRegisteredRef = useRef(false);
  const fullscreenToggleSaveListenerRegisteredRef = useRef(false);
  const fullscreenCurationListenerRegisteredRef = useRef(false);
  const fullscreenOpenExternalListenerRegisteredRef = useRef(false);
  const fullscreenImageLightboxListenerRegisteredRef = useRef(false);
  const fullscreenDismissListenerRegisteredRef = useRef(false);
  const fullscreenAutoOpenedRef = useRef(false);
  const fullscreenGeocodeRunRef = useRef(0);
  /** iOS 전체화면 Native 코스 모드 — showCourseOnMap에서 설정, 닫을 때 null */
  const fullscreenCourseRef = useRef<CoursePlace[] | null>(null);
  const [expandedNativeMapId, setExpandedNativeMapId] = useState<string | null>(null);
  /** 확장 지도 인스턴스가 생길 때마다 증가 — 핀만 별도 effect에서 단일 경로로 그리기 */
  const [expandedMapPinsTick, setExpandedMapPinsTick] = useState(0);
  const [showJobsModal, setShowJobsModal] = useState(false);
  const [activeJobs, setActiveJobs] = useState<ActiveExtractJob[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);
  const selectedPlaceRef = useRef<any>(null);
  selectedPlaceRef.current = selectedPlace;
  const [searchQuery, setSearchQuery] = useState("");
  const [mapSearchResults, setMapSearchResults] = useState<MapSearchPlaceResult[]>([]);
  const mapSearchResultsRef = useRef<MapSearchPlaceResult[]>([]);
  mapSearchResultsRef.current = mapSearchResults;
  const [mapSearchLabel, setMapSearchLabel] = useState("");
  const [isMapSearchSheetOpen, setIsMapSearchSheetOpen] = useState(false);
  const [showMapResearchButton, setShowMapResearchButton] = useState(false);
  const lastSearchCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const mapSearchKeywordRef = useRef("");
  const lastFullscreenQueryRef = useRef("");
  const pendingSearchCenterSyncRef = useRef(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [detailPostId, setDetailPostId] = useState<string | null>(
    () => searchParams?.get("postId") ?? null,
  );
  const detailPostIdRef = useRef<string | null>(null);
  detailPostIdRef.current = detailPostId;
  const [detailReturnTo, setDetailReturnTo] = useState<
    { type: "mypage" } | { type: "profile"; username: string } | null
  >(() => parseDetailReturnTo(searchParams));
  const [newComment, setNewComment] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<FeedPost | null>(null);
  const [editComment, setEditComment] = useState("");
  const [showPostModal, setShowPostModal] = useState(false);
  const [selectedCompanionTag, setSelectedCompanionTag] = useState<CompanionTagFilter>("all");
  const [selectedHomeCategory, setSelectedHomeCategory] = useState<HomeCategoryFilter>("all");
  const [homeSearchQuery, setHomeSearchQuery] = useState("");
  const [debouncedHomeSearchQuery, setDebouncedHomeSearchQuery] = useState("");
  const [isHomeSearchOpen, setIsHomeSearchOpen] = useState(false);
  const [homePlaceSheet, setHomePlaceSheet] = useState<PlaceSheetData | null>(null);
  const [postTitle, setPostTitle] = useState(""); const [postPlaceName, setPostPlaceName] = useState("");
  const [postAddress, setPostAddress] = useState("");
  const [postCategory, setPostCategory] = useState<Category>("카페");
  const [postCategories, setPostCategories] = useState<Category[]>([]);
  const [postPlaceLat, setPostPlaceLat] = useState<number | undefined>(undefined);
  const [postPlaceLng, setPostPlaceLng] = useState<number | undefined>(undefined);
  const [postComment, setPostComment] = useState("");
  const [postCompanionTag, setPostCompanionTag] = useState<CompanionTag | null>(null);
  const [postPhotoPlaceTags, setPostPhotoPlaceTags] = useState<PhotoPlaceTag[]>([]);
  const [postSaveCourseChecked, setPostSaveCourseChecked] = useState(false);
  const [postCourseTitle, setPostCourseTitle] = useState("");
  const [postImages, setPostImages] = useState<PostImageItem[]>([]);
  const postImagesRef = useRef<PostImageItem[]>([]);
  postImagesRef.current = postImages;
  useEffect(() => {
    return () => {
      postImagesRef.current.forEach((img) => {
        if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
      });
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const chatRoomsRef = useRef<ChatRoom[]>([]);
  chatRoomsRef.current = chatRooms;
  const messageUnreadTotal = useMemo(
    () => chatRooms.reduce((sum, r) => sum + (r.unreadCount ?? 0), 0),
    [chatRooms],
  );
  const [activeChatRoom, setActiveChatRoom] = useState<ChatRoom | null>(null);
  const activeChatRoomRef = useRef<ChatRoom | null>(null);
  activeChatRoomRef.current = activeChatRoom;
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatOlderHasMore, setChatOlderHasMore] = useState(false);
  const [chatLoadingOlder, setChatLoadingOlder] = useState(false);
  const [chatRoomLoading, setChatRoomLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [messageUserSearchQuery, setMessageUserSearchQuery] = useState("");
  const [messageUserSearchResults, setMessageUserSearchResults] = useState<UserSearchHit[]>([]);
  const [messageUserSearchLoading, setMessageUserSearchLoading] = useState(false);
  const [messageUserSearchFollowLoadingId, setMessageUserSearchFollowLoadingId] = useState<string | null>(null);
  const { isVisible: keyboardVisible, willShow: keyboardWillShow, height: keyboardHeight } = useNativeKeyboard();
  const tabBarHiddenByKeyboard = keyboardVisible || keyboardWillShow;
  const messageUserSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedMapPlace, setSelectedMapPlace] = useState<Place | null>(null);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [directionsInfo, setDirectionsInfo] = useState<{duration: number; distance: number} | null>(null);
  const [directionsMode, setDirectionsMode] = useState<"car" | "walk">("car");
  const [savedSearchQuery, setSavedSearchQuery] = useState("");
  const isIOSLike = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // 코스 만들기 관련 state
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [courseCounts, setCourseCounts] = useState<Record<Category, number>>({
    카페: 0,
    맛집: 0,
    쇼핑: 0,
    숙소: 0,
    놀거리: 0,
    여행지: 0,
  });
  const [courseOriginMode, setCourseOriginMode] = useState<"current" | "manual">("current");
  const [courseOriginAddress, setCourseOriginAddress] = useState("");
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseResult, setCourseResult] = useState<CoursePlace[] | null>(null);
  const [showCourseRoute, setShowCourseRoute] = useState(false);
  const [courseCurrentLocation, setCourseCurrentLocation] = useState<LatLng | null>(null);
  const [courseLocationLoading, setCourseLocationLoading] = useState(false);
  const [coursePlaceCoords, setCoursePlaceCoords] = useState<Record<string, LatLng>>({});
  const [showCourseSaveModal, setShowCourseSaveModal] = useState(false);
  const [courseSaveTitle, setCourseSaveTitle] = useState("");
  const [courseSaving, setCourseSaving] = useState(false);
  const [savedCourseId, setSavedCourseId] = useState<string | null>(null);
  const [isReadOnlyCourse, setIsReadOnlyCourse] = useState(false);
  const [viewedCourseUserId, setViewedCourseUserId] = useState<string | null>(null);
  const [courseImporting, setCourseImporting] = useState(false);
  const [courseCache, setCourseCache] = useState<Record<string, SavedCourse>>({});
  const courseCacheRef = useRef<Record<string, SavedCourse>>({});
  courseCacheRef.current = courseCache;
  const [editingCourseTitle, setEditingCourseTitle] = useState("");
  const [isEditingCourseTitleInline, setIsEditingCourseTitleInline] = useState(false);
  const [courseTitleSaving, setCourseTitleSaving] = useState(false);
  const [myCourses, setMyCourses] = useState<SavedCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [courseActionTarget, setCourseActionTarget] = useState<SavedCourse | null>(null);
  const [showCourseDeleteConfirm, setShowCourseDeleteConfirm] = useState(false);
  const [courseDeleting, setCourseDeleting] = useState(false);
  const [showCourseEditScreen, setShowCourseEditScreen] = useState(false);
  const [editingCourseDraft, setEditingCourseDraft] = useState<{
    id: string;
    title: string;
    items: SavedCourseItem[];
  } | null>(null);
  const [showAddPlaceSheet, setShowAddPlaceSheet] = useState(false);
  const [courseEditSaving, setCourseEditSaving] = useState(false);
  const courseSaveInputRef = useRef<HTMLInputElement>(null);
  const courseEditOriginalRef = useRef<{ title: string; items: SavedCourseItem[] } | null>(null);
  /** DB에 저장된 코스를 모달로 볼 때 id — courseResult 변경으로 savedCourseId가 지워지지 않게 */
  const viewingSavedCourseIdRef = useRef<string | null>(null);
  const returnToCourseSheetRef = useRef(false);
  const drawCourseRouteRetryRef = useRef(0);
  const courseTitleOriginalRef = useRef("");
  const courseTitleInlineInputRef = useRef<HTMLInputElement>(null);
  const pollAttemptsRef = useRef<Record<string, number>>({});
  const pollInFlightRef = useRef<Set<string>>(new Set());
  const handleAddSubmittingRef = useRef(false);
  const completedJobIdsRef = useRef<Set<string>>(new Set());
  const chatMessagesContainerRef = useRef<HTMLDivElement | null>(null);
  const chatComposerInputRef = useRef<HTMLInputElement | null>(null);
  const prevKeyboardVisibleForChatRef = useRef(false);
  const lastKbResetAtRef = useRef(0);
  /** 사용자가 위로 스크롤해 과거 메시지를 보면 false — 새 수신 시 자동 스크롤 안 함 */
  const chatStickToBottomRef = useRef(true);
  const commentInputRef = useRef<HTMLInputElement | null>(null);
  const commentSectionRef = useRef<HTMLDivElement | null>(null);
  const detailPostScrollRef = useRef<HTMLDivElement | null>(null);
  const commentInputFocusedRef = useRef(false);
  const [scrollToComment, setScrollToComment] = useState(false);

  const scrollToCommentSection = useCallback(() => {
    const scrollContainer = detailPostScrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
  }, []);

  const scheduleScrollToCommentSection = useCallback(() => {
    window.setTimeout(() => scrollToCommentSection(), 100);
    window.setTimeout(() => scrollToCommentSection(), 280);
  }, [scrollToCommentSection]);
  const mapContainerRef = useRef<HTMLDivElement | null>(null); const mapExpandedRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null); const expandedMapRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null); const markersRef = useRef<any[]>([]);
  const expandedMarkersRef = useRef<any[]>([]); const feedMarkersRef = useRef<any[]>([]);
  const searchMarkersRef = useRef<any[]>([]);
  /** 확장 지도 키워드 검색 결과 핀 전용 — 코스 마커(searchMarkersRef)와 분리 */
  const mapSearchResultPinsRef = useRef<any[]>([]);
  /** Native 검색 핀 id → place (markerClick 복원용) */
  const searchPinPlaceByIdRef = useRef<Map<string, any>>(new Map());
  /** Native 검색 핀 id 목록 — clear 시 추적용 */
  const searchResultNativePinIdsRef = useRef<string[]>([]);
  /** Native 저장 장소 핀 id → place (markerClick 복원용) */
  const placePinByIdRef = useRef<Map<string, Place>>(new Map());
  const routePolylineRef = useRef<any>(null); const mapKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
  const placePinsRunIdRef = useRef<{ main: number; expanded: number }>({ main: 0, expanded: 0 });
  const locationRenderTokenRef = useRef<{ main: number; expanded: number }>({ main: 0, expanded: 0 });
  /** 확장 지도 직접 검색 시 Location bias — addMyLocation 성공 시 저장, 없으면 지도 center */
  const myLocationLatLngRef = useRef<{ lat: number; lng: number } | null>(null);
  const myLocationMarkerRef = useRef<{ main: any | null; expanded: any | null }>({ main: null, expanded: null });
  const savedPlaceCoordsRef = useRef<Record<string, LatLng>>({});
  const selectedPlaceTokenRef = useRef(0);
  const homeAutoRetryCountRef = useRef(0);
  const initialPinTriggeredRef = useRef(false);
  const prevSavedPlacesKeyRef = useRef("");
  const relayoutTriggeredRef = useRef(false);
  const mapInstanceIdRef = useRef(0);
  const orchestratorSuccessKeyRef = useRef("");
  const orchestratorCycleRef = useRef(0);
  /** 터치/클릭 디듀프 — 같은 장소 카드 반복 오픈 방지 */
  const expandedSearchOpenDedupeRef = useRef<{ t: number; key: string }>({ t: 0, key: "" });
  /** 확장 지도 저장 핀 touchend 보조 — 중복 touchend만 억제(마커 click과는 별도) */
  const expandedSavedTouchAssistDedupeRef = useRef<{ t: number; id: string }>({ t: 0, id: "" });
  /** 확장 지도 최근 검색 결과 좌표(픽셀 근접 매칭·마커 click 보조) */
  const lastExpandedSearchPlacesRef = useRef<any[]>([]);
  /** effect 정리 시 DOM/카카오 리스너 제거 */
  const expandedMapInteractionCleanupRef = useRef<(() => void) | null>(null);
  const expandedNativeMapIdRef = useRef<string | null>(null);
  expandedNativeMapIdRef.current = expandedNativeMapId;
  const feedPostsRef = useRef<FeedPost[]>(feedPosts);
  feedPostsRef.current = feedPosts;
  const savedPlacesRef = useRef<Place[]>(savedPlaces);
  savedPlacesRef.current = savedPlaces;
  const hiddenIdsRef = useRef<Set<string>>(hiddenIds);
  hiddenIdsRef.current = hiddenIds;
  const activeTabRef = useRef<TabId>(activeTab);
  activeTabRef.current = activeTab;
  const prevActiveTabRef = useRef<TabId>(activeTab);
  /** M-1: 오케스트레이터 3회 실패 후 지연 재시도 (WKWebView 지오코딩 지연) */
  const mainPinFallbackTimerRef = useRef<number | null>(null);
  const mainPinFallbackVerifyIntervalRef = useRef<number | null>(null);
  const prevMapExpandedForFallbackRef = useRef<boolean | null>(null);
  const clearMainPinFallbackVerify = () => {
    if (mainPinFallbackVerifyIntervalRef.current !== null) {
      window.clearInterval(mainPinFallbackVerifyIntervalRef.current);
      mainPinFallbackVerifyIntervalRef.current = null;
    }
  };
  const clearMainPinFallbackTimer = () => {
    if (mainPinFallbackTimerRef.current !== null) {
      window.clearTimeout(mainPinFallbackTimerRef.current);
      mainPinFallbackTimerRef.current = null;
    }
    clearMainPinFallbackVerify();
  };
  const roomChannelRef = useRef<any>(null);
  /** Realtime INSERT 시 read 처리: 이 방을 실제로 보고 있을 때만 true (구독만 붙은 백그라운드와 구분) */
  const activeChatRoomIdRef = useRef<string | null>(null);
  const openChatRequestRef = useRef(0);
  const globalMessagesChannelRef = useRef<any>(null);
  const sendingIdsRef = useRef<Set<string>>(new Set());
  const chatOlderLoadInFlightRef = useRef(false);
  const oldestMessageCreatedAtRef = useRef<string | null>(null);
  const chatOlderHasMoreRef = useRef(false);
  const realtimeResubTimerRef = useRef<number | null>(null);
  const lastVisibilityHiddenAtRef = useRef<number | null>(null);
  const notificationsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const realtimeRemountRetryCountRef = useRef<Map<string, number>>(new Map());
  const realtimeRemountDebounceRef = useRef<Map<string, number>>(new Map());
  const realtimeRemountBackoffRef = useRef<Map<string, number>>(new Map());
  const placeExtractionToastTimerRef = useRef<number | null>(null);
  const [showPlaceExtractionToast, setShowPlaceExtractionToast] = useState(false);

  const hideFromMap = (id: string) => setHiddenIds(prev => new Set([...prev, id]));
  const showPlaceExtractionGuideToast = useCallback(() => {
    if (placeExtractionToastTimerRef.current) {
      window.clearTimeout(placeExtractionToastTimerRef.current);
    }
    setShowPlaceExtractionToast(true);
    placeExtractionToastTimerRef.current = window.setTimeout(() => {
      setShowPlaceExtractionToast(false);
      placeExtractionToastTimerRef.current = null;
    }, 4000);
  }, []);

  /** 확장 지도 검색 결과 핀·픽셀 매칭 후보 제거 — 검색 초기화·새 검색 시에만 호출 */
  const clearSearchResultPins = useCallback(() => {
    mapSearchResultPinsRef.current.forEach((m) => {
      try {
        m.setMap(null);
      } catch {
        /* noop */
      }
    });
    mapSearchResultPinsRef.current = [];
    lastExpandedSearchPlacesRef.current = [];
    searchPinPlaceByIdRef.current.clear();
    searchResultNativePinIdsRef.current = [];
    void clearNativeMarkers("search-");
    clearNativeMarkerClickHandlers("search-");
  }, []);

  const addSearchResultPins = useCallback(
    (places: any[], onMarkerClick: (place: any) => void) => {
      if (isNativeMapAvailable() && expandedNativeMapEnabled) {
        const nativeMarkers = places.map((place, index) => ({
          id: `search-${index}`,
          lat: Number(place.y),
          lng: Number(place.x),
        }));
        searchPinPlaceByIdRef.current.clear();
        clearNativeMarkerClickHandlers("search-");
        nativeMarkers.forEach(({ id }, index) => {
          searchPinPlaceByIdRef.current.set(id, places[index]);
          setNativeMarkerClickHandler(id, () => {
            const place = searchPinPlaceByIdRef.current.get(id);
            if (place) onMarkerClick(place);
          });
        });
        searchResultNativePinIdsRef.current = nativeMarkers.map((m) => m.id);
        lastExpandedSearchPlacesRef.current = places.slice();
        void addNativeMarkers(nativeMarkers);
        return;
      }

      if (!expandedMapRef.current || !window.kakao?.maps) return;
      places.forEach((place) => {
        const marker = new window.kakao.maps.Marker({
          map: expandedMapRef.current,
          position: new window.kakao.maps.LatLng(place.y, place.x),
          clickable: true,
        });
        if (marker.setClickable) marker.setClickable(true);
        window.kakao.maps.event.addListener(marker, "click", () => onMarkerClick(place));
        mapSearchResultPinsRef.current.push(marker);
      });
      lastExpandedSearchPlacesRef.current = places.slice();
    },
    [expandedNativeMapEnabled],
  );

  const handleClearMapSearch = useCallback(() => {
    setSearchQuery("");
    clearSearchResultPins();
    setMapSearchResults([]);
    setMapSearchLabel("");
    setIsMapSearchSheetOpen(false);
    lastSearchCenterRef.current = null;
    mapSearchKeywordRef.current = "";
    pendingSearchCenterSyncRef.current = false;
    setShowMapResearchButton(false);
  }, [clearSearchResultPins]);

  /** 확장 지도 카메라: panTo 우선(부드러운 이동), SDK 미지원 시 setCenter 폴백 */
  const applyExpandedMapCameraLatLng = (lat: number, lng: number, level: number = 3) => {
    try {
      const map = expandedMapRef.current;
      if (!map || !window.kakao?.maps) return;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const latlng = new window.kakao.maps.LatLng(lat, lng);
      if (typeof map.panTo === "function") {
        map.panTo(latlng);
      } else {
        map.setCenter(latlng);
      }
      map.setLevel(level);
    } catch {
      /* noop */
    }
  };

  /** React·핀 갱신 한 사이클 뒤 적용해 다른 경로의 setCenter와 겹침 완화 */
  const scheduleExpandedMapCamera = (fn: () => void) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(fn);
    });
  };

  /** 확장 지도만: 저장 직후·URL 추출 완료 등에서 마지막 핀을 잃지 않도록 카메라 이동 (컴팩트 지도는 미사용) */
  const focusExpandedMapOnLatLng = (lat: number, lng: number, level: number = 3) => {
    scheduleExpandedMapCamera(() => {
      applyExpandedMapCameraLatLng(lat, lng, level);
    });
  };

  const focusExpandedMapOnAddress = (address: string, level: number = 3) => {
    const trimmedAddr = String(address ?? "").trim();
    if (!trimmedAddr || !expandedMapRef.current || !geocoderRef.current || !window.kakao?.maps) return;
    try {
      geocoderRef.current.addressSearch(trimmedAddr, (result: any[], st: string) => {
        if (st !== window.kakao.maps.services.Status.OK || !result[0]) return;
        const y = parseFloat(result[0].y);
        const x = parseFloat(result[0].x);
        scheduleExpandedMapCamera(() => {
          applyExpandedMapCameraLatLng(y, x, level);
        });
      });
    } catch {
      /* noop */
    }
  };

  const runFullscreenNativeSearch = useCallback(async (
    query: string,
    biasCenter?: { lat: number; lng: number },
  ) => {
    try {
      const trimmed = query.trim();
      if (!trimmed) {
        lastFullscreenQueryRef.current = "";
        searchPinPlaceByIdRef.current.clear();
        await updateFullscreenNativeMarkers(
          { markers: [], clearPrefix: "search-" },
          { silent: false },
        );
        await clearFullscreenNativeSearchResults({ silent: false });
        return;
      }
      lastFullscreenQueryRef.current = trimmed;
      if (!window.kakao?.maps) return;

      const isResearchSearch = Boolean(
        biasCenter &&
        Number.isFinite(biasCenter.lat) &&
        Number.isFinite(biasCenter.lng),
      );

      let biasLat = 37.5665;
      let biasLng = 126.978;
      if (
        biasCenter &&
        Number.isFinite(biasCenter.lat) &&
        Number.isFinite(biasCenter.lng)
      ) {
        biasLat = biasCenter.lat;
        biasLng = biasCenter.lng;
      } else {
        try {
          const map = expandedMapRef.current;
          if (map?.getCenter) {
            const center = map.getCenter();
            biasLat = center.getLat();
            biasLng = center.getLng();
          } else if (myLocationLatLngRef.current) {
            biasLat = myLocationLatLngRef.current.lat;
            biasLng = myLocationLatLngRef.current.lng;
          }
        } catch {
          /* noop */
        }
      }

      const ps = new window.kakao.maps.services.Places();
      const bias = new window.kakao.maps.LatLng(biasLat, biasLng);
      const SortBy = window.kakao.maps.services.SortBy;
      const keywordOpts: Record<string, unknown> = { location: bias };
      if (SortBy?.DISTANCE != null) {
        keywordOpts.sort = SortBy.DISTANCE;
      }

      await new Promise<void>((resolve) => {
        ps.keywordSearch(trimmed, (data: any[], st: string) => {
          void (async () => {
            try {
              if (st !== window.kakao.maps.services.Status.OK || !data?.length) {
                searchPinPlaceByIdRef.current.clear();
                await updateFullscreenNativeMarkers(
                  { markers: [], clearPrefix: "search-" },
                  { silent: false },
                );
                await clearFullscreenNativeSearchResults({ silent: false });
                resolve();
                return;
              }

              searchPinPlaceByIdRef.current.clear();
              const markers = data.slice(0, 15).flatMap((place, index) => {
                const lat = Number(place.y);
                const lng = Number(place.x);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
                searchPinPlaceByIdRef.current.set(`search-${index}`, place);
                const sheetCandidate = {
                  place_name: String(place.place_name ?? ""),
                  road_address_name: String(place.road_address_name || place.address_name || ""),
                  address_name: String(place.address_name || ""),
                  y: place.y,
                  x: place.x,
                };
                const isSaved = savedPlacesRef.current.some(
                  (p) =>
                    p.name.trim() === sheetCandidate.place_name.trim() &&
                    p.address.trim() === sheetCandidate.road_address_name.trim(),
                );
                return [{
                  id: `search-${index}`,
                  lat,
                  lng,
                  title: String(place.place_name ?? ""),
                  address: String(place.road_address_name || place.address_name || ""),
                  isSaved,
                }];
              });

              const searchResults = markers.map((marker) => ({
                id: marker.id,
                name: marker.title ?? "",
                address: marker.address ?? "",
                lat: marker.lat,
                lng: marker.lng,
                category: undefined as string | undefined,
              }));

              if (markers.length === 0) {
                searchPinPlaceByIdRef.current.clear();
                await updateFullscreenNativeMarkers(
                  { markers: [], clearPrefix: "search-" },
                  { silent: false },
                );
                await clearFullscreenNativeSearchResults({ silent: false });
                resolve();
                return;
              }

              await updateFullscreenNativeMarkers(
                { markers, clearPrefix: "search-" },
                { silent: false },
              );

              await setFullscreenNativeSearchResults(
                { results: searchResults },
                { silent: false },
              );

              const searchCamera = computeFullscreenNativeSearchCamera(
                markers.map((marker) => ({ lat: marker.lat, lng: marker.lng })),
                { preserveView: isResearchSearch },
              );
              if (searchCamera) {
                await setFullscreenNativeCamera({
                  lat: searchCamera.lat,
                  lng: searchCamera.lng,
                  zoom: searchCamera.zoom,
                  animated: true,
                });
              }
            } catch (err) {
              console.error("[fullscreen] search post-process failed", err);
            }
            resolve();
          })();
        }, keywordOpts);
      });
    } catch (err) {
      console.error("[fullscreen] search failed", err);
    }
  }, []);

  const runFullscreenNativeDirections = useCallback(async (destination: {
    id: string;
    lat: number;
    lng: number;
    mode?: "car" | "walk";
  }) => {
    try {
      const destLat = Number(destination.lat);
      const destLng = Number(destination.lng);
      const mode = destination.mode === "walk" ? "walk" : "car";
      if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
        return;
      }

      const fetchAndDrawCarRoute = async (origin: { lat: number; lng: number }) => {
        const res = await fetch("/api/directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin,
            destination: { lat: destLat, lng: destLng },
            mode: "car",
          }),
        });
        const data = await res.json();
        if (!data.routes?.[0]) {
          showToast("경로를 찾을 수 없어요", "error");
          return;
        }
        const route = data.routes[0];
        const path: { lat: number; lng: number }[] = [];
        route.sections.forEach((section: { roads?: { vertexes?: number[] }[] }) => {
          section.roads?.forEach((road) => {
            const vertexes = road.vertexes ?? [];
            for (let i = 0; i < vertexes.length; i += 2) {
              const lng = Number(vertexes[i]);
              const lat = Number(vertexes[i + 1]);
              if (Number.isFinite(lat) && Number.isFinite(lng)) {
                path.push({ lat, lng });
              }
            }
          });
        });
        if (path.length < 2) {
          showToast("경로를 찾을 수 없어요", "error");
          return;
        }
        await setFullscreenNativeRoute({ path, mode: "car" }, { silent: false });
        const summary = route.summary;
        if (summary?.duration != null && summary?.distance != null) {
          await setFullscreenNativeDirectionsInfo(
            {
              id: destination.id,
              duration: Math.round(Number(summary.duration)),
              distance: Math.round(Number(summary.distance)),
            },
            { silent: false },
          );
        }
      };

      const fetchAndDrawWalkRoute = async (origin: { lat: number; lng: number }) => {
        const res = await fetch("/api/walk-directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin, destination: { lat: destLat, lng: destLng } }),
        });
        if (!res.ok) {
          showToast("경로를 찾을 수 없어요", "error");
          return;
        }
        const data = (await res.json()) as {
          features?: { geometry?: { type?: string; coordinates?: number[][] } }[];
          properties?: { totalTime?: number; totalDistance?: number };
        };
        const path = parseTmapWalkGeoJsonToPath(data);
        if (path.length < 2) {
          showToast("경로를 찾을 수 없어요", "error");
          return;
        }
        await setFullscreenNativeRoute({ path, mode: "walk" }, { silent: false });
        const duration = Number(data.properties?.totalTime);
        const distance = Number(data.properties?.totalDistance);
        if (Number.isFinite(duration) && Number.isFinite(distance) && duration > 0 && distance > 0) {
          await setFullscreenNativeDirectionsInfo(
            { id: destination.id, duration: Math.round(duration), distance: Math.round(distance) },
            { silent: false },
          );
        }
      };

      const fetchAndDrawRoute = mode === "walk" ? fetchAndDrawWalkRoute : fetchAndDrawCarRoute;

      const stored = myLocationLatLngRef.current;
      if (
        stored &&
        Number.isFinite(stored.lat) &&
        Number.isFinite(stored.lng)
      ) {
        try {
          await fetchAndDrawRoute({ lat: stored.lat, lng: stored.lng });
        } catch (err) {
          console.error("[fullscreen] directions failed", err);
          showToast("길찾기에 실패했어요", "error");
        }
        return;
      }

      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              await fetchAndDrawRoute({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
              });
            } catch (err) {
              console.error("[fullscreen] directions failed", err);
              showToast("길찾기에 실패했어요", "error");
            }
            resolve();
          },
          (err) => {
            console.error("[fullscreen] geolocation failed", err);
            showToast("현재 위치를 가져올 수 없어요", "error");
            resolve();
          },
        );
      });
    } catch (err) {
      console.error("[fullscreen] directions failed", err);
    }
  }, [showToast]);

  const handleOpenFullscreenNativeMap = useCallback(async () => {
    try {
      const resolvePlaceCoords = (place: Place): LatLng | null => {
        const stored = latLngFromRow(place);
        if (stored) return stored;
        const cached = savedPlaceCoordsRef.current[place.id];
        if (
          cached &&
          typeof cached.lat === "number" &&
          typeof cached.lng === "number" &&
          Number.isFinite(cached.lat) &&
          Number.isFinite(cached.lng)
        ) {
          return cached;
        }
        return null;
      };

      const placeToMarker = (place: Place, coords: LatLng) => {
        const { photos, postCount, photoPostIds } = getMarkerPhotoMetaForPlace(feedPostsRef.current, place, coords);
        return {
          id: `place-${place.id}`,
          lat: coords.lat,
          lng: coords.lng,
          category: place.category,
          title: place.name,
          address: place.address,
          isSaved: true,
          ...(photos.length > 0 ? { photos } : {}),
          ...(postCount > 0 ? { postCount } : {}),
          ...(photoPostIds.length > 0 ? { photoPostIds } : {}),
        };
      };

      const coursePlaces = fullscreenCourseRef.current;
      const isFullscreenCourseMode = Boolean(coursePlaces?.length);

      const courseToMarker = (place: CoursePlace, index: number, coords: LatLng) => ({
        id: `course-${index}`,
        lat: coords.lat,
        lng: coords.lng,
        category: place.category,
        title: place.name,
        address: place.address,
      });

      let courseRoutePath: { lat: number; lng: number }[] = [];
      let initialMarkers: Array<{
        id: string;
        lat: number;
        lng: number;
        category?: string;
        title?: string;
        address?: string;
        photos?: string[];
        postCount?: number;
      }>;

      if (isFullscreenCourseMode && coursePlaces) {
        const courseEntries = coursePlaces.flatMap((place, index) => {
          let coords: LatLng | null = null;
          if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
            coords = { lat: place.lat, lng: place.lng };
          } else {
            const cached = savedPlaceCoordsRef.current[place.id];
            if (
              cached &&
              Number.isFinite(cached.lat) &&
              Number.isFinite(cached.lng)
            ) {
              coords = cached;
            }
          }
          if (!coords) return [];
          return [{ marker: courseToMarker(place, index, coords), coords }];
        });
        initialMarkers = courseEntries.map((entry) => entry.marker);
        courseRoutePath = courseEntries.map((entry) => entry.coords);
      } else {
        initialMarkers = savedPlaces.flatMap((place) => {
          const coords = resolvePlaceCoords(place);
          if (!coords) return [];
          placePinByIdRef.current.set(`place-${place.id}`, place);
          savedPlaceCoordsRef.current[place.id] = coords;
          return [placeToMarker(place, coords)];
        });
      }

      let lat = 37.5665;
      let lng = 126.978;
      const map = expandedMapRef.current;
      try {
        if (map?.getCenter) {
          const center = map.getCenter();
          lat = center.getLat();
          lng = center.getLng();
        } else if (initialMarkers.length > 0) {
          lat = initialMarkers[0].lat;
          lng = initialMarkers[0].lng;
        }
      } catch {
        if (initialMarkers.length > 0) {
          lat = initialMarkers[0].lat;
          lng = initialMarkers[0].lng;
        }
      }

      if (!fullscreenSearchListenerRegisteredRef.current) {
        fullscreenSearchListenerRegisteredRef.current = true;
        void PindmapNativeMap.addListener("fullscreenSearch", (e) => {
          void runFullscreenNativeSearch(e.query);
        }).catch((err) => {
          fullscreenSearchListenerRegisteredRef.current = false;
          console.error("[fullscreen] fullscreenSearch listener failed", err);
        });
      }

      if (!fullscreenResearchListenerRegisteredRef.current) {
        fullscreenResearchListenerRegisteredRef.current = true;
        void PindmapNativeMap.addListener("fullscreenResearchArea", (e) => {
          const keyword = lastFullscreenQueryRef.current.trim();
          if (!keyword) return;
          const lat = Number(e.lat);
          const lng = Number(e.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          void runFullscreenNativeSearch(keyword, { lat, lng });
        }).catch((err) => {
          fullscreenResearchListenerRegisteredRef.current = false;
          console.error("[fullscreen] fullscreenResearchArea listener failed", err);
        });
      }

      if (!fullscreenDirectionsListenerRegisteredRef.current) {
        fullscreenDirectionsListenerRegisteredRef.current = true;
        void PindmapNativeMap.addListener("fullscreenDirections", (e) => {
          const mode = e.mode === "walk" ? "walk" : "car";
          void runFullscreenNativeDirections({ id: e.id, lat: e.lat, lng: e.lng, mode });
        }).catch((err) => {
          fullscreenDirectionsListenerRegisteredRef.current = false;
          console.error("[fullscreen] fullscreenDirections listener failed", err);
        });
      }

      const geocodeRunId = ++fullscreenGeocodeRunRef.current;
      const accumulatedMarkers = [...initialMarkers];

      const storedMyLocation = myLocationLatLngRef.current;
      const entryCamera = computeFullscreenNativeEntryCamera(
        initialMarkers,
        { lat, lng },
        {
          useMyLocation: !isFullscreenCourseMode,
          myLocation:
            storedMyLocation &&
            Number.isFinite(storedMyLocation.lat) &&
            Number.isFinite(storedMyLocation.lng)
              ? storedMyLocation
              : null,
        },
      );
      await presentFullscreenNativeMap(
        { lat: entryCamera.lat, lng: entryCamera.lng, zoom: entryCamera.zoom, markers: initialMarkers },
        { silent: false },
      );

      if (isFullscreenCourseMode && courseRoutePath.length >= 2) {
        setDirectionsLoading(true);
        try {
          if (courseRoutePath.length > FULLSCREEN_COURSE_DIRECTIONS_WARN_STOPS) {
            console.warn(
              "[fullscreen] course has many stops; directions requests may be slow",
              courseRoutePath.length,
            );
            showToast(
              `코스 장소가 ${courseRoutePath.length}곳입니다. 경로 계산에 시간이 걸릴 수 있어요.`,
              "info",
            );
          }
          const walkPath = await buildCourseWalkPathFromTmap(courseRoutePath);
          await setFullscreenNativeRoute(
            { path: walkPath.length >= 2 ? walkPath : courseRoutePath, mode: "walk" },
            { silent: false },
          );
        } catch (err) {
          console.error("[course] failed", err);
          await setFullscreenNativeRoute(
            { path: courseRoutePath, mode: "walk" },
            { silent: false },
          );
        } finally {
          setDirectionsLoading(false);
        }
      }

      void (async () => {
        const stored = myLocationLatLngRef.current;
        if (
          stored &&
          Number.isFinite(stored.lat) &&
          Number.isFinite(stored.lng)
        ) {
          await setFullscreenNativeMyLocation(
            { lat: stored.lat, lng: stored.lng },
            { silent: false },
          );
          return;
        }

        try {
          const pos = await getCurrentPositionForMapStage1();
          const myLat = Number(pos.latitude);
          const myLng = Number(pos.longitude);
          if (!Number.isFinite(myLat) || !Number.isFinite(myLng)) return;
          myLocationLatLngRef.current = { lat: myLat, lng: myLng };
          await setFullscreenNativeMyLocation({ lat: myLat, lng: myLng }, { silent: false });
        } catch {
          /* location unavailable — skip silently */
        }
      })();

      if (isFullscreenCourseMode) return;

      const missingPlaces = savedPlaces.filter((place) => {
        if (resolvePlaceCoords(place)) return false;
        return Boolean(String(place.address ?? "").trim());
      });

      if (missingPlaces.length === 0) return;

      if (missingPlaces.length > 25) {
        console.warn(
          "[fullscreen] geocoding many places without coords:",
          missingPlaces.length,
          "— may be slow / rate-limited",
        );
      }

      if (!geocoderRef.current || !window.kakao?.maps) {
        console.warn("[fullscreen] geocoder unavailable — skipping address-only pins");
        return;
      }

      for (const place of missingPlaces) {
        if (geocodeRunId !== fullscreenGeocodeRunRef.current) return;

        await new Promise<void>((resolve) => {
          const address = String(place.address ?? "").trim();
          if (!address) {
            resolve();
            return;
          }

          geocoderRef.current.addressSearch(address, (result: any[], status: string) => {
            if (geocodeRunId !== fullscreenGeocodeRunRef.current) {
              resolve();
              return;
            }
            if (status !== window.kakao.maps.services.Status.OK || !result[0]) {
              resolve();
              return;
            }
            const markerLat = parseFloat(result[0].y);
            const markerLng = parseFloat(result[0].x);
            if (!Number.isFinite(markerLat) || !Number.isFinite(markerLng)) {
              resolve();
              return;
            }

            savedPlaceCoordsRef.current[place.id] = { lat: markerLat, lng: markerLng };
            const marker = placeToMarker(place, { lat: markerLat, lng: markerLng });
            const existingIdx = accumulatedMarkers.findIndex((m) => m.id === marker.id);
            if (existingIdx >= 0) {
              accumulatedMarkers[existingIdx] = marker;
            } else {
              accumulatedMarkers.push(marker);
            }

            void updateFullscreenNativeMarkers(
              { markers: [...accumulatedMarkers] },
              { silent: true },
            ).catch((err) => {
              console.warn("[fullscreen] updateFullscreenNativeMarkers failed", err);
            });
            resolve();
          });
        });
      }
    } catch (err) {
      if (fullscreenCourseRef.current?.length) {
        console.error("[course] failed", err);
      }
      console.error("[fullscreen] presentFullscreenMap failed", err);
    }
  }, [savedPlaces, runFullscreenNativeSearch, runFullscreenNativeDirections, showToast]);

  useEffect(() => {
    if (!isNativeMapAvailable()) return;

    if (mapExpanded) {
      if (fullscreenAutoOpenedRef.current) return;
      fullscreenAutoOpenedRef.current = true;
      void handleOpenFullscreenNativeMap();
      return;
    }

    fullscreenAutoOpenedRef.current = false;
    fullscreenCourseRef.current = null;
    void dismissFullscreenNativeMap({ silent: true });
  }, [mapExpanded, handleOpenFullscreenNativeMap]);

  useEffect(() => {
    if (!isNativeMapAvailable()) return;
    if (fullscreenDismissListenerRegisteredRef.current) return;
    fullscreenDismissListenerRegisteredRef.current = true;
    void PindmapNativeMap.addListener("fullscreenMapDismissed", () => {
      fullscreenAutoOpenedRef.current = false;
      fullscreenCourseRef.current = null;
      if (returnToCourseSheetRef.current) {
        returnToCourseSheetRef.current = false;
        setMapExpanded(false);
        clearRoute();
        setShowCourseRoute(false);
        setShowCourseModal(true);
        return;
      }
      setMapExpanded(false);
    }).catch((err) => {
      fullscreenDismissListenerRegisteredRef.current = false;
      console.error("[fullscreen] fullscreenMapDismissed listener failed", err);
    });
  }, []);

  const resetHiddenPlaces = () => {
    console.log("[PindMap:pin] reset hidden places");
    setHiddenIds(new Set());
    if (mapRef.current) addPlacePins(mapRef.current, markersRef.current, feedPostsRef.current, savedPlaces, "main");
    if (mapExpanded && expandedMapRef.current) addPlacePins(expandedMapRef.current, expandedMarkersRef.current, feedPostsRef.current, savedPlaces, "expanded");
  };
  const toSelectedFromSavedPlace = useCallback((place: Place, relatedPosts: FeedPost[], lat?: number, lng?: number) => ({
    place_name: place.name,
    category_name: place.category,
    road_address_name: place.address,
    address_name: place.address,
    phone: "",
    place_url: "",
    y: typeof lat === "number" ? String(lat) : undefined,
    x: typeof lng === "number" ? String(lng) : undefined,
    _feedPosts: relatedPosts,
    _savedPlaceId: place.id,
    _placeRef: placeRefFromPlace(place, lat, lng),
  }), []);

  const resolveSavedMatch = useCallback((candidate: any): Place | undefined => {
    if (!candidate) return undefined;
    const candidateId = String(candidate._savedPlaceId || "").trim();
    if (candidateId) {
      const byId = savedPlaces.find((p) => p.id === candidateId);
      if (byId) return byId;
    }
    const cy = Number(candidate.y);
    const cx = Number(candidate.x);
    if (Number.isFinite(cy) && Number.isFinite(cx)) {
      const byDistance = savedPlaces.find((p) => {
        const c = savedPlaceCoordsRef.current[p.id];
        if (!c) return false;
        if (!namesAreSimilar(p.name, String(candidate.place_name ?? ""))) return false;
        return distanceMeters(c.lat, c.lng, cy, cx) <= 50;
      });
      if (byDistance) return byDistance;
    }
    const candName = String(candidate.place_name ?? "");
    const candRoad = String(candidate.road_address_name ?? "");
    const candAddr = String(candidate.address_name ?? "");
    const nRoad = normalizeAddress(candRoad);
    const nAddr = normalizeAddress(candAddr);
    return savedPlaces.find((p) => {
      if (!namesAreSimilar(p.name, candName)) return false;
      const np = normalizeAddress(p.address);
      if (!np) return true;
      if (!nRoad && !nAddr) return true;
      return np === nRoad || np === nAddr || np.includes(nRoad) || nRoad.includes(np) || np.includes(nAddr) || nAddr.includes(np);
    });
  }, [savedPlaces]);

  const canSubmit = useMemo(() => instagramUrl.trim().length > 0 && !isSubmitting, [instagramUrl, isSubmitting]);
  const postImagesAllUploaded = postImages.length > 0 && postImages.every((img) => img.status === "uploaded");
  const canPost =
    postTitle.trim().length > 0 &&
    postImagesAllUploaded &&
    postCompanionTag !== null &&
    (!postSaveCourseChecked || postCourseTitle.trim().length > 0);
  const postValidationHint = useMemo(() => {
    if (canPost) return null;
    if (!postTitle.trim()) return "제목을 입력해주세요";
    if (postImages.length === 0) return "사진을 최소 1장 추가해주세요";
    if (postImages.some((i) => i.status === "uploading")) return "사진 업로드가 완료될 때까지 기다려주세요";
    if (postImages.some((i) => i.status === "failed")) return "실패한 사진을 제거하거나 재시도해주세요";
    if (postCompanionTag === null) return "누구랑 갔는지 선택해주세요";
    if (postSaveCourseChecked && !postCourseTitle.trim()) return "코스 제목을 입력해주세요";
    return "모든 사진 업로드가 끝나야 등록할 수 있어요";
  }, [canPost, postTitle, postImages, postCompanionTag, postSaveCourseChecked, postCourseTitle]);

  const courseShareFilteredRooms = useMemo(() => {
    const q = courseShareSearchQuery.trim().toLowerCase();
    if (!q) return courseShareFriendRooms;
    return courseShareFriendRooms.filter((r) => r.friendName.toLowerCase().includes(q));
  }, [courseShareFriendRooms, courseShareSearchQuery]);

  const detailPost = detailPostId ? feedPosts.find(p => p.id === detailPostId) ?? null : null;

  const closeDetailPost = useCallback(() => {
    const ret = detailReturnTo;
    setDetailPostId(null);
    setScrollToComment(false);
    setDetailReturnTo(null);
    if (ret?.type === "profile") {
      router.push(`/profile/${encodeURIComponent(ret.username)}`);
      return;
    }
    if (ret?.type === "mypage") {
      setActiveTab("mypage");
    }
  }, [detailReturnTo, router]);
  const isAnalyzing = activeJobs.length > 0;
  const analyzingMainText = isAnalyzing
    ? activeJobs.length > 1
      ? `${activeJobs.length}개 작업을 분석하고 있어요`
      : "정확한 장소를 파악하고 있어요"
    : "";
  const analyzingSubText = isAnalyzing ? "잠시 후 핀이 추가될 거예요" : "";
  const courseRegionKeyword = courseOriginAddress.trim();
  const courseBasePlaces = useMemo(() => {
    if (courseOriginMode === "manual" && courseRegionKeyword) {
      return savedPlaces.filter((p) => p.address.includes(courseRegionKeyword));
    }
    if (courseOriginMode === "current" && courseCurrentLocation) {
      return savedPlaces.filter((p) => {
        const coord = coursePlaceCoords[p.id];
        if (!coord) return false;
        return getDistance(courseCurrentLocation.lat, courseCurrentLocation.lng, coord.lat, coord.lng) <= COURSE_WALK_RADIUS_KM;
      });
    }
    return savedPlaces;
  }, [courseOriginMode, courseRegionKeyword, savedPlaces, courseCurrentLocation, coursePlaceCoords]);
  const courseAvailableByCategory = useMemo(
    () => ({
      카페: courseBasePlaces.filter((p) => p.category === "카페").length,
      맛집: courseBasePlaces.filter((p) => p.category === "맛집").length,
      쇼핑: courseBasePlaces.filter((p) => p.category === "쇼핑").length,
      숙소: courseBasePlaces.filter((p) => p.category === "숙소").length,
      놀거리: courseBasePlaces.filter((p) => p.category === "놀거리").length,
      여행지: courseBasePlaces.filter((p) => p.category === "여행지").length,
    }),
    [courseBasePlaces],
  );

  useEffect(() => {
    if (!showCourseModal || courseOriginMode !== "current") return;
    if (!navigator.geolocation) return;
    setCourseLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCourseCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setCourseLocationLoading(false);
      },
      () => {
        setCourseCurrentLocation(null);
        setCourseLocationLoading(false);
      },
      { timeout: 5000 },
    );
  }, [showCourseModal, courseOriginMode]);

  useEffect(() => {
    if (!showCourseModal || courseOriginMode !== "current" || !geocoderRef.current || savedPlaces.length === 0) return;
    const missing = savedPlaces.filter((p) => !coursePlaceCoords[p.id]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map(
        (place) =>
          new Promise<{ id: string; coord: LatLng | null }>((resolve) => {
            geocoderRef.current.addressSearch(place.address, (result: any[], st: string) => {
              if (st === window.kakao.maps.services.Status.OK && result[0]) {
                resolve({ id: place.id, coord: { lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) } });
              } else {
                resolve({ id: place.id, coord: null });
              }
            });
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      setCoursePlaceCoords((prev) => {
        const next = { ...prev };
        results.forEach(({ id, coord }) => {
          if (coord) next[id] = coord;
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [showCourseModal, courseOriginMode, savedPlaces, coursePlaceCoords]);

  useEffect(() => {
    if (viewingSavedCourseIdRef.current) return;
    setSavedCourseId(null);
  }, [courseResult]);

  useEffect(() => {
    if (!showCourseSaveModal) return;
    const t = window.setTimeout(() => courseSaveInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [showCourseSaveModal]);

  useEffect(() => {
    if (!isEditingCourseTitleInline) return;
    const t = window.setTimeout(() => courseTitleInlineInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [isEditingCourseTitleInline]);

  const closeCourseSaveModal = () => {
    setShowCourseSaveModal(false);
    setCourseSaveTitle("");
  };

  const handleSaveCourse = async () => {
    if (!user?.id) {
      showToast("로그인이 필요해요", "error");
      return;
    }
    if (!courseResult || courseResult.length === 0) {
      showToast("코스가 비어있어요", "error");
      return;
    }
    const items: SavedCourseItem[] = courseResult.map(({ id, name, address, category, lat, lng }) => ({
      id,
      name,
      address,
      category,
      lat,
      lng,
    }));
    setCourseSaving(true);
    try {
      const { data, error } = await saveCourse(user.id, courseSaveTitle, items);
      if (error) {
        showToast(error, "error");
        return;
      }
      closeCourseSaveModal();
      showToast("코스를 저장했어요", "success");
      if (data?.id) {
        viewingSavedCourseIdRef.current = data.id;
        setSavedCourseId(data.id);
        setViewedCourseUserId(user.id);
        setCourseCache((prev) => ({ ...prev, [data.id]: data }));
      }
      void refreshMyCourses();
    } finally {
      setCourseSaving(false);
    }
  };

  const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        window.setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  };

  const loadData = async (isRetry = false) => {
    const perfScreen = "home:initial";
    dlog.perf.start(perfScreen);
    dlog.perf.fetchStart(perfScreen);
    console.log("[PindMap:home] 로딩 시작", { isRetry });
    setLoading(true);
    setHomeLoadError(null);
    try {
      const uid = user?.id ?? "";
      const [placesRes, postsRes, roomsRes, followsRes, notificationsRes, myLikesRes] = await withTimeout(Promise.all([
        supabase.from("places").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
        supabase.from("feed_posts").select("*, comments(*)").order("created_at", { ascending: false }),
        supabase.from("chat_rooms").select("*").or(`user1_id.eq.${MY_USER},user2_id.eq.${MY_USER}`),
        supabase.from("follows").select("following_id").eq("follower_id", uid),
        supabase.from("notifications").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(50),
        uid
          ? supabase.from("likes").select("post_id").eq("user_id", uid)
          : Promise.resolve({ data: [] as { post_id: string }[], error: null }),
      ]), 8000);

      const myLikedSet = new Set((myLikesRes.data ?? []).map((l: { post_id: string }) => l.post_id));

      setFollowingIds((followsRes.data || []).map((f: any) => f.following_id));
      syncCurrentUserToAvatarCache();

      const rawNotifications = (notificationsRes.data || []) as Notification[];
      await prefetchAvatarsForNotifications(rawNotifications);
      setNotifications(hydrateNotificationsWithAvatars(rawNotifications));

      if (placesRes.data) {
        const mappedPlaces = placesRes.data.map((p) => mapPlaceRow(p));
        mappedPlaces.forEach((place) => {
          const coords = latLngFromRow(place);
          if (coords) savedPlaceCoordsRef.current[place.id] = coords;
        });
        setSavedPlaces(mappedPlaces);
      }
      if (postsRes.data) {
        const rawPosts: FeedPost[] = postsRes.data.map((p: any) =>
          parseFeedPostFromRow(p, { likedByMe: myLikedSet.has(p.id) }),
        );
        await prefetchAvatarsForFeedPosts(rawPosts);
        setFeedPosts(hydrateFeedPostsWithAvatars(rawPosts));
      } else {
        setFeedPosts([]);
      }

      const roomsData = roomsRes.data;
      if (roomsData && roomsData.length > 0) {
        const rooms: ChatRoom[] = await withTimeout(Promise.all(
          roomsData.map(async (r: any) => {
            const friendId = r.user1_id === MY_USER ? r.user2_id : r.user1_id;
            const { data: friendData } = await supabase.from("users").select("username, avatar_url").eq("id", friendId).maybeSingle();
            if (friendData) userAvatarCacheRef.current.setFromRow({ id: friendId, username: friendData.username, avatar_url: friendData.avatar_url });
            const [msgsRes, unreadRes] = await Promise.all([
              supabase.from("messages").select("*").eq("room_id", r.id).order("created_at", { ascending: false }).limit(1),
              supabase.from("messages").select("*", { count: "exact", head: true }).eq("room_id", r.id).neq("sender_id", MY_USER).eq("read", false),
            ]);
            const unread = typeof unreadRes.count === "number" ? unreadRes.count : 0;
            return {
              id: r.id,
              friendId,
              friendName: friendData?.username || friendId,
              friendAvatarUrl: normalizeAvatarUrl(friendData?.avatar_url),
              lastMessage: msgsRes.data?.[0]?.text ?? "",
              lastTime: msgsRes.data?.[0]?.created_at ?? r.created_at,
              unreadCount: unread,
            };
          }),
        ), 8000);
        setChatRooms(sortChatRoomsByRecency(rooms));
      } else {
        setChatRooms([]);
      }
      homeAutoRetryCountRef.current = 0;
      dlog.perf.fetchEnd(perfScreen);
      console.log("[PindMap:home] 로딩 완료");
    } catch (err) {
      dlog.perf.fetchEnd(perfScreen);
      console.error("[PindMap:home] 로딩 실패", err);
      const friendlyMessage = "연결이 불안정해요. 다시 시도해주세요 🌐";
      setHomeLoadError(friendlyMessage);
      if (!isRetry && homeAutoRetryCountRef.current < 1) {
        homeAutoRetryCountRef.current += 1;
        console.log("[PindMap:home] 자동 재시도 시작 (1회)");
        setHomeRetrying(true);
        window.setTimeout(() => {
          void loadData(true).finally(() => setHomeRetrying(false));
        }, 350);
      }
    } finally {
      setLoading(false);
    }
  };

  const retryHomeLoad = () => {
    setHomeRetrying(true);
    void loadData(true).finally(() => setHomeRetrying(false));
  };

  useEffect(() => {
    if (!sessionChecked) return;
    if (userLoading) return;
    if (user) {
      void loadData();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        let session = await verifySessionQuick();
        if (cancelled) return;
        if (session?.user) {
          const ok = await reloadUserWithTimeout();
          if (cancelled) return;
          if (!ok) router.push("/login");
          return;
        }
        const ok = await reloadUserWithTimeout();
        if (cancelled) return;
        if (!ok) {
          router.push("/login");
          return;
        }
        session = await verifySessionQuick();
        if (cancelled) return;
        if (!session?.user) {
          router.push("/login");
        }
      } catch (e) {
        console.error("[PindMap:home][auth] login gate failed", e);
        if (!cancelled) router.push("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, userLoading, sessionChecked, router, verifySessionQuick, reloadUserWithTimeout]);

  useEffect(() => {
    if (!sessionChecked || userLoading || !user || loading) return;
    dlog.perf.markRender("home:initial");
  }, [sessionChecked, userLoading, user, loading]);

  useEffect(() => {
    const screen = `tab:${activeTab}`;
    dlog.perf.start(screen);
  }, [activeTab]);

  useEffect(() => {
    const screen = `tab:${activeTab}`;
    dlog.perf.markRender(screen);
  }, [activeTab, loading, chatRoomLoading, coursesLoading, compactMapReady, activeChatRoom?.id]);

  useEffect(() => {
    if (!sessionChecked || userLoading || user) return;
    if (authStallRetryRef.current >= 1) {
      router.push("/login");
      return;
    }
    const timer = window.setTimeout(() => {
      authStallRetryRef.current += 1;
      setAuthRetryPending(true);
      void (async () => {
        try {
          const ok = await reloadUserWithTimeout();
          if (!ok) router.push("/login");
        } finally {
          setAuthRetryPending(false);
        }
      })();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [sessionChecked, userLoading, user, router, reloadUserWithTimeout]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!user || userLoading || !sessionChecked) return;
      if (!homeLoadError) return;
      console.log("[PindMap:home] 포그라운드 복귀 - 자동 재시도");
      void loadData(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [homeLoadError, user, userLoading, sessionChecked]);

  useEffect(() => {
    syncCurrentUserToAvatarCache();
    if (!user?.id) return;
    const avatarUrl = user.avatar_url;
    setFeedPosts((prev) =>
      hydrateFeedPostsWithAvatars(
        prev.map((p) =>
          p.userId === user.id
            ? { ...p, userAvatarUrl: avatarUrl }
            : {
                ...p,
                comments: p.comments.map((c) =>
                  c.userId === user.id ? { ...c, avatarUrl } : c,
                ),
              },
        ),
      ),
    );
    setNotifications((prev) =>
      prev.map((n) => (n.actor_id === user.id ? { ...n, actorAvatarUrl: avatarUrl } : n)),
    );
  }, [user?.id, user?.avatar_url, user?.username, syncCurrentUserToAvatarCache, hydrateFeedPostsWithAvatars]);

  useEffect(() => {
    if (!detailPostId || !user) return;
    void (async () => {
      try {
        await supabase
          .from("notifications")
          .update({ read: true })
          .eq("user_id", user.id)
          .in("type", ["like", "comment"])
          .eq("target_id", detailPostId)
          .eq("read", false);
        setNotifications((prev) =>
          prev.map((n) =>
            (n.type === "like" || n.type === "comment") && n.target_id === detailPostId ? { ...n, read: true } : n,
          ),
        );
      } catch (err) {
        console.error("[PindMap:notify] mark like/comment notifications read failed", err);
      }
    })();
  }, [detailPostId, user]);

  useEffect(() => {
    if (!showNotifications || !user) return;
    void (async () => {
      try {
        await supabase
          .from("notifications")
          .update({ read: true })
          .eq("user_id", user.id)
          .eq("type", "follow")
          .eq("read", false);
        setNotifications((prev) => prev.map((n) => (n.type === "follow" ? { ...n, read: true } : n)));
      } catch (err) {
        console.error("[PindMap:notify] mark follow notifications read failed", err);
      }
    })();
  }, [showNotifications, user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(HIDDEN_PLACE_IDS_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as string[];
      if (!Array.isArray(parsed)) return;
      setHiddenIds(new Set(parsed.filter((id) => typeof id === "string")));
    } catch {
      // ignore invalid storage value
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HIDDEN_PLACE_IDS_STORAGE_KEY, JSON.stringify([...hiddenIds]));
  }, [hiddenIds]);

  useEffect(() => {
    if (savedPlaces.length === 0) return;
    setHiddenIds((prev) => {
      const valid = new Set(savedPlaces.map((p) => p.id));
      const next = [...prev].filter((id) => valid.has(id));
      if (next.length !== prev.size) {
        console.log("[PindMap:pin] pruned stale hidden ids", { before: prev.size, after: next.length });
      }
      return new Set(next);
    });
  }, [savedPlaces]);

  useEffect(() => {
    if (typeof window === "undefined" || !sessionChecked || userLoading || !user) return;
    try {
      const raw = window.localStorage.getItem(ACTIVE_JOBS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ActiveExtractJob[];
      if (!Array.isArray(parsed)) return;
      const normalized = parsed.filter((item) => item && typeof item.jobId === "string" && item.jobId.length > 0);
      if (normalized.length > 0) {
        setActiveJobs((prev) => {
          const merged = [...normalized, ...prev];
          const map = new Map<string, ActiveExtractJob>();
          merged.forEach((job) => map.set(job.jobId, job));
          return Array.from(map.values());
        });
      }
    } catch {
      // ignore invalid storage value
    }
  }, [user, userLoading, sessionChecked]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const incomplete = activeJobs.filter((job) => job.status !== "completed" && job.status !== "failed");
    if (incomplete.length === 0) {
      window.localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACTIVE_JOBS_STORAGE_KEY, JSON.stringify(incomplete));
  }, [activeJobs]);

  useEffect(() => {
    return () => {
      if (placeExtractionToastTimerRef.current) {
        window.clearTimeout(placeExtractionToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const pollingTargets = activeJobs.filter((job) => job.status === "pending" || job.status === "processing");
    if (pollingTargets.length === 0) return;

    const removeJob = (jobId: string) => {
      delete pollAttemptsRef.current[jobId];
      pollInFlightRef.current.delete(jobId);
      setActiveJobs((prev) => prev.filter((job) => job.jobId !== jobId));
    };

    const pollJob = async (jobId: string) => {
      if (pollInFlightRef.current.has(jobId)) return;

      const attempts = (pollAttemptsRef.current[jobId] ?? 0) + 1;
      pollAttemptsRef.current[jobId] = attempts;
      if (attempts > 30) {
        showToast("작업 상태 확인 시간이 초과되어 자동 중단했어요.", "info");
        setStatus("");
        removeJob(jobId);
        return;
      }

      pollInFlightRef.current.add(jobId);
      try {
        const cacheBust = Date.now();
        const res = await fetch(
          `/api/extract/status?jobId=${encodeURIComponent(jobId)}&userId=${encodeURIComponent(user.id)}&_t=${cacheBust}`,
          {
            credentials: "include",
            cache: "no-store",
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate",
              Pragma: "no-cache",
            },
          },
        );
        const data = await res.json() as ExtractStatusResponse;
        console.log("[poll]", jobId.slice(0, 8), {
          status: data.status,
          step: data.progress_step,
          placesCount: data.result_places?.length ?? "no_array",
        });
        if (!res.ok) {
          throw new Error(data.error || data.error_message || "작업 상태를 확인할 수 없어요.");
        }

        const nextStatus = data.status;
        const nextStep = data.progress_step ?? "";
        setActiveJobs((prev) => prev.map((job) => job.jobId === jobId ? { ...job, status: nextStatus, progressStep: nextStep } : job));

        const shouldHandleCompleted = nextStatus === "completed"
          || (!!nextStep && nextStep.includes("완료") && Array.isArray(data.result_places));
        if (shouldHandleCompleted) {
          if (completedJobIdsRef.current.has(jobId)) {
            return;
          }
          completedJobIdsRef.current.add(jobId);
          removeJob(jobId);
          const places = data.result_places ?? [];
          if (places.length === 0) {
            if (nextStep.includes("all_saved_already")) {
              showToast("이미 저장된 장소만 추출됐어요", "info");
            } else {
              showPlaceExtractionGuideToast();
              showToast("장소를 찾지 못했어요.", "info");
              setError("릴스 또는 게시물 캡션에 장소 정보가 기재되어있는지 확인해주세요");
            }
            setStatus("");
            console.log("[PindMap:url] extraction message hidden (failed)");
            return;
          }
          const existingSet = new Set(
            savedPlaces.map((p) => `${String(p.name).trim()}::${String(p.address).trim()}`),
          );
          const uniquePlaces = places.filter((p) => {
            const key = `${p.name.trim()}::${p.address.trim()}`;
            if (existingSet.has(key)) return false;
            existingSet.add(key);
            return true;
          });
          const duplicateCount = places.length - uniquePlaces.length;
          if (uniquePlaces.length === 0) {
            showToast(
              places.length > 0 ? "추출된 장소는 이미 저장 목록에 있어요" : "추가할 새 장소가 없어요",
              "info",
            );
            setStatus("");
            console.log("[PindMap:url] extraction completed — all duplicates vs savedPlaces");
            return;
          }
          const merged: Place[] = uniquePlaces.map((p) => {
            const coords = latLngFromRow(p);
            return {
              id:
                typeof p.id === "string" && p.id.trim().length > 0
                  ? p.id.trim()
                  : `${Math.random().toString(36).substring(2)}${Date.now().toString(36)}`,
              name: p.name,
              address: p.address,
              category: p.category as Category,
              ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
            };
          });
          const mergedIds = new Set(merged.map((m) => m.id));
          setSavedPlaces((prev) => [...merged, ...prev.filter((p) => !mergedIds.has(p.id))]);
          merged.forEach((place) => {
            const coords = latLngFromRow(place);
            if (coords) savedPlaceCoordsRef.current[place.id] = coords;
          });
          const lastAdded = merged[merged.length - 1];
          const lastCoords = lastAdded ? latLngFromRow(lastAdded) : null;
          if (lastCoords) {
            focusExpandedMapOnLatLng(lastCoords.lat, lastCoords.lng, 3);
          } else if (lastAdded?.address) {
            focusExpandedMapOnAddress(lastAdded.address, 3);
          }
          showToast(`✨ ${uniquePlaces.length}개 장소를 추가했어요${duplicateCount > 0 ? ` (중복 ${duplicateCount}개 제외)` : ""}`, "success");
          setStatus("");
          console.log("[PindMap:url] extraction message hidden (success)");
          return;
        }

        if (nextStatus === "failed") {
          const message = data.error_message || "장소 분석 작업에 실패했어요.";
          showToast(message, "error");
          showPlaceExtractionGuideToast();
          setStatus("");
          console.log("[PindMap:url] extraction message hidden (failed)");
          setError("릴스 또는 게시물 캡션에 장소 정보가 기재되어있는지 확인해주세요");
          removeJob(jobId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "작업 상태 확인 중 오류가 발생했어요.";
        showToast(message, "error");
        showPlaceExtractionGuideToast();
        setStatus("");
        console.log("[PindMap:url] extraction message hidden (failed)");
        removeJob(jobId);
      } finally {
        pollInFlightRef.current.delete(jobId);
      }
    };

    const interval = window.setInterval(() => {
      pollingTargets.forEach((job) => { void pollJob(job.jobId); });
    }, 2000);

    pollingTargets.forEach((job) => { void pollJob(job.jobId); });

    return () => window.clearInterval(interval);
  }, [activeJobs, user?.id, showPlaceExtractionGuideToast, showToast]);

  const addPlace = async (place: Place) => {
    if (!user?.id) {
      showToast("로그인 후 이용해주세요", "info");
      return;
    }

    const optimisticPlace = { ...place };
    setSavedPlaces((prev) => [optimisticPlace, ...prev.filter((p) => p.id !== place.id)]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("세션 만료");

      const res = await fetch("/api/places/upsert", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(place),
      });

      if (!res.ok) {
        setSavedPlaces((prev) => prev.filter((p) => p.id !== place.id));
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `저장 실패 (${res.status})`);
      }
    } catch (err) {
      setSavedPlaces((prev) => prev.filter((p) => p.id !== place.id));
      showToast(err instanceof Error ? err.message : "저장에 실패했어요", "error");
    }
  };
  const deletePlace = async (id: string) => {
    const previous = savedPlaces.slice();
    setSavedPlaces((prev) => prev.filter((p) => p.id !== id));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("세션 만료");

      const res = await fetch(`/api/places/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        setSavedPlaces(previous);
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `삭제 실패 (${res.status})`);
      }
    } catch (err) {
      setSavedPlaces(previous);
      showToast(err instanceof Error ? err.message : "삭제에 실패했어요", "error");
    }
  };
  const submitPost = async (post: FeedPost): Promise<{ error: string | null }> => {
    if (!isCompanionTag(post.companionTag)) {
      alert("동행 태그를 선택해주세요.");
      return { error: "invalid_companion_tag" };
    }
    const coords = latLngFromRow(post);
    const { error } = await supabase.from("feed_posts").insert({
      id: post.id,
      user_id: user?.id || "",
      user_name: MY_USERNAME,
      title: post.title,
      place_name: post.placeName,
      address: post.address,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      category: post.category,
      categories: post.categories?.length ? post.categories : null,
      comment: post.comment,
      images: post.images,
      companion_tag: post.companionTag,
      photo_place_tags: post.photoPlaceTags ?? null,
      course_id: post.courseId ?? null,
      archived: false,
    });
    if (error) {
      return { error: error.message };
    }
    setFeedPosts((prev) => [post, ...prev]);
    return { error: null };
  };
  const openAppleMapsPlace = (placeName?: string, address?: string, latRaw?: string | number, lngRaw?: string | number) => {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    const hasCoord = Number.isFinite(lat) && Number.isFinite(lng);
    const label = (placeName || address || "장소").trim();
    const mapsSchemeUrl = hasCoord
      ? `maps://?ll=${lat},${lng}&q=${encodeURIComponent(label)}`
      : `maps://?q=${encodeURIComponent(label)}`;
    const webUrl = hasCoord
      ? `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(label)}`
      : `https://maps.apple.com/?q=${encodeURIComponent(label)}`;
    console.log("[PindMap:apple-maps] open place", { label, lat, lng, hasCoord, isIOSLike });
    if (isIOSLike) {
      window.location.href = mapsSchemeUrl;
      window.setTimeout(() => {
        window.open(webUrl, "_blank");
      }, 700);
      return;
    }
    window.open(webUrl, "_blank");
  };

  const openAppleMapsCourseRoute = () => {
    if (!courseResult || courseResult.length === 0) return;
    const coordChain = courseResult
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => `${p.lat},${p.lng}`);
    if (coordChain.length === 0) return;
    const daddr = coordChain.join("+to:");
    const mapsSchemeUrl = `maps://?daddr=${encodeURIComponent(daddr)}&dirflg=d`;
    const webUrl = `https://maps.apple.com/?daddr=${encodeURIComponent(daddr)}&dirflg=d`;
    console.log("[PindMap:apple-maps] open course route", { stops: coordChain.length, isIOSLike });
    if (isIOSLike) {
      window.location.href = mapsSchemeUrl;
      window.setTimeout(() => {
        window.open(webUrl, "_blank");
      }, 700);
      return;
    }
    window.open(webUrl, "_blank");
  };

  const revokeProfileEditAvatarBlob = () => {
    if (profileEditAvatarBlobRef.current) {
      URL.revokeObjectURL(profileEditAvatarBlobRef.current);
      profileEditAvatarBlobRef.current = null;
    }
  };

  const closeProfileEditModal = () => {
    if (profileEditSaving) return;
    revokeProfileEditAvatarBlob();
    setProfileEditPendingFile(null);
    setProfileEditAvatarPreview(null);
    setShowProfileEditModal(false);
  };

  const openProfileEdit = () => {
    console.log("[PindMap:mypage] profile edit button clicked", { uid: user?.id, username: user?.username });
    revokeProfileEditAvatarBlob();
    setProfileEditName(user?.username ?? "");
    setProfileEditBio(user?.bio ?? "");
    setProfileEditAvatarPreview(user?.avatar_url ?? null);
    setProfileEditPendingFile(null);
    setShowProfileEditModal(true);
  };

  const handleProfileAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("이미지 파일만 선택할 수 있어요", "info");
      return;
    }
    revokeProfileEditAvatarBlob();
    const blobUrl = URL.createObjectURL(file);
    profileEditAvatarBlobRef.current = blobUrl;
    setProfileEditAvatarPreview(blobUrl);
    setProfileEditPendingFile(file);
  };

  const openDeleteAccountModal = () => {
    console.log("[PindMap:account] 계정 삭제 버튼 클릭");
    setShowDeleteAccountModal(true);
  };

  const closeDeleteAccountFlow = () => {
    setShowDeleteAccountModal(false);
    setShowDeleteAccountFinalModal(false);
    setDeleteAccountPhraseInput("");
    setDeleteAccountLoading(false);
  };

  const goToFinalDeleteConfirmation = () => {
    console.log("[PindMap:account] 1차 확인 — 삭제 진행");
    setShowDeleteAccountModal(false);
    setDeleteAccountPhraseInput("");
    setShowDeleteAccountFinalModal(true);
  };

  const executePermanentAccountDeletion = async () => {
    if (deleteAccountPhraseInput.trim() !== "삭제") {
      console.log("[PindMap:account] 확인 문구 불일치", deleteAccountPhraseInput);
      return;
    }
    console.log("[PindMap:account] 영구 삭제 API 호출");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      showToast("세션이 만료되었어요. 다시 로그인해 주세요", "error");
      return;
    }
    setDeleteAccountLoading(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        console.error("[PindMap:account] API 오류", res.status, body);
        showToast(body.error || "계정 삭제에 실패했어요", "error");
        return;
      }
      closeDeleteAccountFlow();
      await supabase.auth.signOut();
      showToast("계정이 성공적으로 삭제되었습니다", "success");
      window.setTimeout(() => {
        window.location.href = "/";
      }, 400);
    } catch (e) {
      console.error("[PindMap:account] 영구 삭제 예외", e);
      showToast("계정 삭제 중 오류가 발생했어요", "error");
    } finally {
      setDeleteAccountLoading(false);
    }
  };

  const saveProfileEdit = async () => {
    const nextName = profileEditName.trim();
    const nextBio = profileEditBio.trim();
    if (!user?.id) return;
    if (!nextName) {
      showToast("이름을 입력해 주세요", "info");
      return;
    }
    const oldUsername = user.username;
    const nameChanged = oldUsername !== nextName;
    const avatarChanged = profileEditPendingFile !== null;
    const currentBio = (user.bio ?? "").trim();
    const bioChanged = currentBio !== nextBio;
    if (!nameChanged && !avatarChanged && !bioChanged) {
      closeProfileEditModal();
      return;
    }
    console.log("[PindMap:mypage] saving profile", { uid: user.id, nextName, avatarChanged, bioChanged });
    setProfileEditSaving(true);
    try {
      let nextAvatarUrl = user.avatar_url ?? null;

      if (avatarChanged && profileEditPendingFile) {
        nextAvatarUrl = await uploadAvatar(user.id, profileEditPendingFile);
        const { error: avatarError } = await supabase
          .from("users")
          .update({ avatar_url: nextAvatarUrl })
          .eq("id", user.id);
        if (avatarError) {
          throw avatarError;
        }
      }

      if (bioChanged) {
        const { error: bioError } = await supabase
          .from("users")
          .update({ bio: nextBio.length > 0 ? nextBio : null })
          .eq("id", user.id);
        if (bioError) {
          throw bioError;
        }
      }

      if (nameChanged) {
        const { error: updateError } = await supabase.rpc("rename_user_username", {
          p_user_id: user.id,
          p_old_username: oldUsername,
          p_new_username: nextName,
        });
        if (updateError) {
          const code = (updateError as { code?: string }).code;
          const msg = String((updateError as { message?: string }).message || "");
          if (code === "23505" || /duplicate|unique/i.test(msg)) {
            showToast("이미 사용 중인 닉네임이에요", "error");
            return;
          }
          if (code === "P0001" || msg.includes("does not match")) {
            showToast("닉네임이 바뀌었어요. 새로고침 후 다시 시도해 주세요", "info");
            return;
          }
          if (code === "42501" || msg.includes("not authorized")) {
            showToast("권한이 없어요", "error");
            return;
          }
          console.error("[PindMap:mypage] save profile rpc error", updateError);
          showToast("프로필 저장에 실패했어요", "error");
          return;
        }
      }

      await reloadUserFromSession();
      const uid = user.id;
      if (avatarChanged && nextAvatarUrl) {
        userAvatarCacheRef.current.setByUserId(uid, nextAvatarUrl);
        setFeedPosts((prev) =>
          prev.map((p) =>
            p.userId === uid
              ? { ...p, userAvatarUrl: nextAvatarUrl }
              : {
                  ...p,
                  comments: p.comments.map((c) =>
                    c.userId === uid ? { ...c, avatarUrl: nextAvatarUrl } : c,
                  ),
                },
          ),
        );
        setNotifications((prev) =>
          prev.map((n) => (n.actor_id === uid ? { ...n, actorAvatarUrl: nextAvatarUrl } : n)),
        );
      }
      if (nameChanged) {
        setFeedPosts((prev) =>
          prev.map((p) => ({
            ...p,
            user: p.userId === uid ? nextName : p.user,
            comments: p.comments.map((c) => (c.user === oldUsername ? { ...c, user: nextName } : c)),
          })),
        );
        setNotifications((prev) =>
          prev.map((n) => (n.actor_id === uid ? { ...n, actor_username: nextName } : n)),
        );
        setSharePost((sp) => {
          if (!sp || sp.userId !== uid) return sp;
          return {
            ...sp,
            user: nextName,
            comments: sp.comments.map((c) => (c.user === oldUsername ? { ...c, user: nextName } : c)),
          };
        });
        setEditingPost((ep) => (ep && ep.userId === uid ? { ...ep, user: nextName } : ep));
      }
      showToast("프로필이 저장되었어요", "success");
      revokeProfileEditAvatarBlob();
      setProfileEditPendingFile(null);
      setShowProfileEditModal(false);
    } catch (err) {
      console.error("[PindMap:mypage] save profile failed", err);
      const message = err instanceof Error ? err.message : "프로필 저장에 실패했어요";
      showToast(message, "error");
    } finally {
      setProfileEditSaving(false);
    }
  };
  const refreshMyTotalLikes = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from("users")
        .select("total_likes_received")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        patchUser({ total_likes_received: Math.max(0, Number(data.total_likes_received) || 0) });
      }
    } catch {
      /* keep existing value */
    }
  }, [user?.id, patchUser]);

  const refreshMyCourses = useCallback(async () => {
    if (!user?.id) return;
    setCoursesLoading(true);
    try {
      const { data, error } = await fetchMyCourses(user.id);
      if (!error) setMyCourses(data);
    } catch {
      /* keep existing list */
    } finally {
      setCoursesLoading(false);
    }
  }, [user?.id]);

  const closeCourseModal = () => {
    setShowCourseModal(false);
    setCourseResult(null);
    setSavedCourseId(null);
    setIsEditingCourseTitleInline(false);
    setEditingCourseTitle("");
    setIsReadOnlyCourse(false);
    setViewedCourseUserId(null);
    viewingSavedCourseIdRef.current = null;
    returnToCourseSheetRef.current = false;
  };

  const ensureCourseLoaded = useCallback(async (courseId: string): Promise<SavedCourse | null> => {
    const hit = courseCacheRef.current[courseId];
    if (hit) return hit;
    const { data } = await fetchCourseById(courseId);
    if (data) {
      setCourseCache((prev) => ({ ...prev, [courseId]: data }));
      return data;
    }
    return null;
  }, []);

  const openSavedCourse = (course: SavedCourse, options?: { readOnly?: boolean }) => {
    dlog.perf.start("course:modal");
    const restored: CoursePlace[] = course.items
      .filter((it) => Number.isFinite(it.lat) && Number.isFinite(it.lng))
      .map((it) => ({
        id: it.id,
        name: it.name,
        address: it.address,
        category: it.category as Category,
        lat: it.lat,
        lng: it.lng,
      }));
    if (restored.length === 0) {
      showToast("코스에 표시할 장소가 없어요", "error");
      return;
    }
    const ownerId = (course.user_id ?? "").trim();
    viewingSavedCourseIdRef.current = course.id;
    setIsReadOnlyCourse(options?.readOnly ?? false);
    setViewedCourseUserId(ownerId || null);
    setCourseCache((prev) => ({ ...prev, [course.id]: { ...course, user_id: ownerId } }));
    setCourseResult(restored);
    setSavedCourseId(course.id);
    setEditingCourseTitle(course.title);
    setIsEditingCourseTitleInline(false);
    setShowCourseModal(true);
    dlog.perf.markRender("course:modal");
  };

  const isCourseEditDirty = useCallback(() => {
    const draft = editingCourseDraft;
    const orig = courseEditOriginalRef.current;
    if (!draft || !orig) return false;
    if (draft.title.trim() !== orig.title.trim()) return true;
    return JSON.stringify(draft.items) !== JSON.stringify(orig.items);
  }, [editingCourseDraft]);

  const closeCourseEditScreen = () => {
    setShowCourseEditScreen(false);
    setEditingCourseDraft(null);
    setShowAddPlaceSheet(false);
    courseEditOriginalRef.current = null;
  };

  const requestCloseCourseEditScreen = () => {
    if (isCourseEditDirty() && !window.confirm("변경사항을 버릴까요?")) return;
    closeCourseEditScreen();
  };

  const openCourseEditScreen = () => {
    if (isReadOnlyCourse || !savedCourseId || !courseResult?.length) return;
    const items = courseResult.map(coursePlaceToSavedItem);
    courseEditOriginalRef.current = {
      title: editingCourseTitle,
      items: JSON.parse(JSON.stringify(items)) as SavedCourseItem[],
    };
    setEditingCourseDraft({ id: savedCourseId, title: editingCourseTitle, items });
    setShowCourseEditScreen(true);
  };

  const moveCourseEditItem = (idx: number, direction: "up" | "down") => {
    setEditingCourseDraft((prev) => {
      if (!prev) return prev;
      const swapWith = direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= prev.items.length) return prev;
      const items = [...prev.items];
      [items[idx], items[swapWith]] = [items[swapWith]!, items[idx]!];
      return { ...prev, items };
    });
  };

  const removeCourseEditItem = (idx: number) => {
    if (!window.confirm("이 장소를 코스에서 뺄까요?")) return;
    setEditingCourseDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, items: prev.items.filter((_, i) => i !== idx) };
    });
  };

  const addPlaceToCourseEdit = (place: Place) => {
    const item = placeToSavedItemIfCoords(place);
    if (!item) {
      showToast("이 장소는 좌표 정보가 없어 추가할 수 없어요", "error");
      return;
    }
    setEditingCourseDraft((prev) => (prev ? { ...prev, items: [...prev.items, item] } : prev));
    setShowAddPlaceSheet(false);
  };

  const handleSaveCourseEdit = async () => {
    if (!editingCourseDraft) return;
    const trimmed = editingCourseDraft.title.trim();
    if (!trimmed) {
      showToast("제목을 입력해주세요", "error");
      return;
    }
    if (editingCourseDraft.items.length === 0) {
      showToast("장소를 1개 이상 추가해주세요", "error");
      return;
    }
    setCourseEditSaving(true);
    try {
      const { data, error } = await updateCourseItems(
        editingCourseDraft.id,
        trimmed,
        editingCourseDraft.items,
      );
      if (error) {
        showToast(error, "error");
        return;
      }
      viewingSavedCourseIdRef.current = editingCourseDraft.id;
      setCourseResult(editingCourseDraft.items.map(savedItemToCoursePlace));
      setEditingCourseTitle(trimmed);
      setMyCourses((prev) =>
        prev.map((c) =>
          c.id === editingCourseDraft.id
            ? {
                ...c,
                title: trimmed,
                items: editingCourseDraft.items,
                place_count: editingCourseDraft.items.length,
                updated_at: data?.updated_at ?? new Date().toISOString(),
              }
            : c,
        ),
      );
      showToast("코스를 저장했어요", "success");
      closeCourseEditScreen();
      void refreshMyCourses();
    } finally {
      setCourseEditSaving(false);
    }
  };

  const addableSavedPlacesForCourseEdit = useMemo(() => {
    if (!editingCourseDraft) return [];
    const inDraft = new Set(editingCourseDraft.items.map((it) => it.id));
    return savedPlaces.filter((p) => !inDraft.has(p.id));
  }, [editingCourseDraft, savedPlaces]);

  const handleSaveCourseTitleInline = async () => {
    if (isReadOnlyCourse || !savedCourseId) return;
    const trimmed = editingCourseTitle.trim();
    if (!trimmed) {
      showToast("제목을 입력해주세요", "error");
      return;
    }
    if (trimmed === courseTitleOriginalRef.current.trim()) {
      setIsEditingCourseTitleInline(false);
      return;
    }
    setCourseTitleSaving(true);
    try {
      const { data, error } = await updateCourseTitle(savedCourseId, trimmed);
      if (error) {
        showToast(error, "error");
        return;
      }
      setEditingCourseTitle(trimmed);
      setIsEditingCourseTitleInline(false);
      showToast("제목을 변경했어요", "success");
      setMyCourses((prev) =>
        prev.map((c) =>
          c.id === savedCourseId
            ? { ...c, title: trimmed, updated_at: data?.updated_at ?? new Date().toISOString() }
            : c,
        ),
      );
      void refreshMyCourses();
    } finally {
      setCourseTitleSaving(false);
    }
  };

  const closeCourseActionSheet = () => {
    setCourseActionTarget(null);
    setShowCourseDeleteConfirm(false);
  };

  const handleConfirmDeleteCourse = async () => {
    if (!courseActionTarget) return;
    const targetId = courseActionTarget.id;
    setCourseDeleting(true);
    try {
      const { error } = await deleteCourse(targetId);
      setShowCourseDeleteConfirm(false);
      setCourseActionTarget(null);
      if (error) {
        showToast(error, "error");
        return;
      }
      showToast("코스를 삭제했어요", "success");
      setMyCourses((prev) => prev.filter((c) => c.id !== targetId));
      void refreshMyCourses();
    } finally {
      setCourseDeleting(false);
    }
  };

  const deletePost = async (id: string) => {
    const deleted = feedPosts.find((p) => p.id === id);
    await supabase.from("feed_posts").delete().eq("id", id);
    setFeedPosts(prev => prev.filter(p => p.id !== id)); setOpenMenuId(null);
    if (deleted?.userId === user?.id) {
      void refreshMyTotalLikes();
    }
  };
  const toggleArchive = async (id: string) => {
    const post = feedPosts.find(p => p.id === id); if (!post) return;
    await supabase.from("feed_posts").update({ archived: !post.archived }).eq("id", id);
    setFeedPosts(prev => prev.map(p => p.id === id ? { ...p, archived: !p.archived } : p)); setOpenMenuId(null);
  };
  const openEdit = (post: FeedPost) => { setEditingPost(post); setEditComment(post.comment); setOpenMenuId(null); };
  const submitEdit = async () => {
    if (!editingPost || !editComment.trim()) return;
    await supabase.from("feed_posts").update({ comment: editComment }).eq("id", editingPost.id);
    setFeedPosts(prev => prev.map(p => p.id === editingPost.id ? { ...p, comment: editComment } : p));
    setEditingPost(null); setEditComment("");
  };
  const toggleLike = async (postId: string) => {
    const post = feedPosts.find((p) => p.id === postId);
    if (!post || !user?.id) return;

    const wasLiked = post.liked_by_me;
    const prevCount = post.likes_count;

    setFeedPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              liked_by_me: !wasLiked,
              likes_count: Math.max(0, p.likes_count + (wasLiked ? -1 : 1)),
            }
          : p,
      ),
    );

    const { liked, error } = await toggleLikeRow(postId, user.id);

    if (error) {
      setFeedPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, liked_by_me: wasLiked, likes_count: prevCount } : p,
        ),
      );
      showToast("좋아요를 처리하지 못했어요. 다시 시도해주세요", "error");
      return;
    }

    if (liked !== !wasLiked) {
      setFeedPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: liked,
                likes_count: Math.max(0, liked ? prevCount + 1 : prevCount - 1),
              }
            : p,
        ),
      );
    }

    if (liked && post.userId && post.userId !== user.id) {
      try {
        await supabase.from("notifications").insert({
          id: Date.now().toString() + Math.random().toString(36).substring(2, 8),
          user_id: post.userId,
          type: "like",
          actor_id: user.id,
          actor_username: MY_USERNAME,
          target_id: postId,
          target_text: post.title || post.placeName,
        });
      } catch {
        /* 알림 INSERT 실패 무시 */
      }
    }
  };
  const addComment = async (postId: string) => {
    if (!newComment.trim()) return;
    const c = { id: Date.now().toString(), post_id: postId, user_id: user?.id || "", user_name: MY_USERNAME, text: newComment.trim() };
    await supabase.from("comments").insert(c);
    const newC: Comment = {
      id: c.id,
      user: MY_USERNAME,
      userId: user?.id,
      avatarUrl: user?.avatar_url,
      text: newComment.trim(),
      createdAt: new Date().toISOString(),
    };
    setFeedPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: [...p.comments, newC] } : p));

    const post = feedPosts.find(p => p.id === postId);
    if (post && post.userId && post.userId !== user?.id && user) {
      try {
        await supabase.from("notifications").insert({
          id: Date.now().toString() + Math.random().toString(36).substring(2, 8),
          user_id: post.userId,
          type: "comment",
          actor_id: user.id,
          actor_username: MY_USERNAME,
          target_id: postId,
          target_text: c.text.length > 30 ? c.text.slice(0, 30) + "..." : c.text,
        });
      } catch {
        /* 알림 INSERT 실패 무시 */
      }
    }
    setNewComment("");
    scheduleScrollToCommentSection();
  };
  const deleteComment = async (postId: string, commentId: string) => {
    await supabase.from("comments").delete().eq("id", commentId);
    setFeedPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: p.comments.filter(c => c.id !== commentId) } : p));
  };

  const resetRealtimeRemountCounters = useCallback(() => {
    realtimeRemountRetryCountRef.current.clear();
    for (const timer of realtimeRemountDebounceRef.current.values()) {
      window.clearTimeout(timer);
    }
    realtimeRemountDebounceRef.current.clear();
    for (const timer of realtimeRemountBackoffRef.current.values()) {
      window.clearTimeout(timer);
    }
    realtimeRemountBackoffRef.current.clear();
  }, []);

  const scheduleRealtimeRemount = useCallback((channelKey: string, remountFn: () => void) => {
    const existingDebounce = realtimeRemountDebounceRef.current.get(channelKey);
    if (existingDebounce !== undefined) {
      window.clearTimeout(existingDebounce);
    }
    const debounceTimer = window.setTimeout(() => {
      realtimeRemountDebounceRef.current.delete(channelKey);
      const retryCount = realtimeRemountRetryCountRef.current.get(channelKey) ?? 0;
      if (retryCount >= REALTIME_REMOUNT_MAX_RETRIES) {
        console.warn("[PindMap:realtime] remount gave up", { channelKey, retries: retryCount });
        return;
      }
      const backoffMs =
        REALTIME_REMOUNT_BACKOFFS_MS[Math.min(retryCount, REALTIME_REMOUNT_BACKOFFS_MS.length - 1)]!;
      const existingBackoff = realtimeRemountBackoffRef.current.get(channelKey);
      if (existingBackoff !== undefined) {
        window.clearTimeout(existingBackoff);
      }
      const backoffTimer = window.setTimeout(() => {
        realtimeRemountBackoffRef.current.delete(channelKey);
        realtimeRemountRetryCountRef.current.set(channelKey, retryCount + 1);
        console.log("[PindMap:realtime] remount attempt", { channelKey, attempt: retryCount + 1 });
        remountFn();
      }, backoffMs);
      realtimeRemountBackoffRef.current.set(channelKey, backoffTimer);
    }, REALTIME_REMOUNT_DEBOUNCE_MS);
    realtimeRemountDebounceRef.current.set(channelKey, debounceTimer);
  }, []);

  const handleRealtimeChannelStatus = useCallback(
    (logPrefix: string, channelKey: string, status: string, remountFn: () => void) => {
      try {
        debugLog.set({ realtimeStatus: `${logPrefix}:${status}` });
      } catch {
        /* ignore */
      }
      if (!REALTIME_ERROR_STATUSES.has(status)) return;
      console.warn("[PindMap:realtime] channel error status", { channelKey, status });
      scheduleRealtimeRemount(channelKey, remountFn);
    },
    [scheduleRealtimeRemount],
  );

  const unmountRoomSubscription = useCallback((reason: string) => {
    activeChatRoomIdRef.current = null;
    if (!roomChannelRef.current) return;
    console.log("[PindMap:message] subscription unmounted", reason);
    supabase.removeChannel(roomChannelRef.current);
    roomChannelRef.current = null;
  }, []);

  const unmountGlobalMessagesSubscription = useCallback(() => {
    if (!globalMessagesChannelRef.current) return;
    supabase.removeChannel(globalMessagesChannelRef.current);
    globalMessagesChannelRef.current = null;
  }, []);

  const unmountNotificationsSubscription = useCallback(() => {
    if (!notificationsChannelRef.current) return;
    supabase.removeChannel(notificationsChannelRef.current);
    notificationsChannelRef.current = null;
  }, []);

  const mountNotificationsSubscription = useCallback(
    (userId: string) => {
      unmountNotificationsSubscription();
      const channelKey = `notifications-${userId}`;
      const channel = supabase
        .channel(channelKey)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const newNotification = payload.new as Notification;
            void (async () => {
              await userAvatarCacheRef.current.prefetchByIds([newNotification.actor_id]);
              const actorAvatarUrl = userAvatarCacheRef.current.getByUserId(newNotification.actor_id);
              setNotifications((prev) => [{ ...newNotification, actorAvatarUrl }, ...prev]);

              if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
              if (newNotification.actor_id === userIdRef.current) return;
              if (
                (newNotification.type === "like" || newNotification.type === "comment") &&
                newNotification.target_id &&
                detailPostIdRef.current === newNotification.target_id
              ) {
                return;
              }
              enqueueInAppNotificationRef.current({
                id: `notify-${newNotification.id}-${Date.now()}`,
                type: newNotification.type,
                actorName: newNotification.actor_username,
                actorUsername: newNotification.actor_username,
                actorId: newNotification.actor_id,
                actorAvatarUrl,
                text: formatInAppNotificationFromRow(newNotification),
                targetId: newNotification.target_id,
                notificationId: newNotification.id,
              });
            })();
          },
        )
        .subscribe((status) => {
          handleRealtimeChannelStatus("notifications", channelKey, status, () => {
            mountNotificationsSubscription(userId);
          });
        });
      notificationsChannelRef.current = channel;
    },
    [unmountNotificationsSubscription, handleRealtimeChannelStatus],
  );

  const mountGlobalMessagesSubscription = useCallback(() => {
    if (!MY_USER) return;
    unmountGlobalMessagesSubscription();
    const channel = supabase
      .channel(`global-messages-${MY_USER}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: any) => {
          const m = payload.new;
          if (m.sender_id === MY_USER) return;
          const viewingRoomId = activeChatRoomRef.current?.id ?? null;
          const isViewing = viewingRoomId === m.room_id;
          setChatRooms((prev) => {
            const room = prev.find((r) => r.id === m.room_id);
            if (!room) return prev;
            const next = prev.map((r) =>
              r.id === m.room_id
                ? {
                    ...r,
                    lastMessage: m.text,
                    lastTime: m.created_at,
                    unreadCount: isViewing ? 0 : r.unreadCount + 1,
                  }
                : r,
            );
            return sortChatRoomsByRecency(next);
          });

          if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
          if (isViewing) return;

          void (async () => {
            const listed = chatRoomsRef.current.find((r) => r.id === m.room_id);
            let actorName = listed?.friendName ?? "";
            let actorAvatarUrl = listed?.friendAvatarUrl;
            let actorUsername = actorName;
            if (!actorName) {
              await userAvatarCacheRef.current.prefetchByIds([m.sender_id]);
              const { data: senderData } = await supabase
                .from("users")
                .select("username, avatar_url")
                .eq("id", m.sender_id)
                .maybeSingle();
              actorName = senderData?.username ?? "알 수 없음";
              actorUsername = senderData?.username ?? "";
              actorAvatarUrl =
                normalizeAvatarUrl(senderData?.avatar_url) ??
                userAvatarCacheRef.current.getByUserId(m.sender_id);
            }
            enqueueInAppNotificationRef.current({
              id: `msg-${m.id}-${Date.now()}`,
              type: "message",
              actorName,
              actorUsername,
              actorId: m.sender_id,
              actorAvatarUrl,
              text: formatMessageInAppText(actorName, m.text ?? ""),
              targetId: m.room_id,
            });
          })();
        },
      )
      .subscribe((status) => {
        const channelKey = `global-messages-${MY_USER}`;
        handleRealtimeChannelStatus("global", channelKey, status, () => {
          mountGlobalMessagesSubscription();
        });
      });
    globalMessagesChannelRef.current = channel;
  }, [MY_USER, unmountGlobalMessagesSubscription, handleRealtimeChannelStatus]);

  const mountRoomSubscription = useCallback((roomId: string) => {
    unmountRoomSubscription("replace");
    const channel = supabase
      .channel(`room-${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` }, async (payload: any) => {
        const m = payload.new;
        setMessages(prev => prev.some(msg => msg.id === m.id) ? prev : [...prev, { id: m.id, senderId: m.sender_id, text: m.text, createdAt: m.created_at, read: m.read, status: "sent" }]);
        const currentUserId = userIdRef.current;
        if (currentUserId && m.sender_id !== currentUserId && activeChatRoomIdRef.current === roomId) {
          await supabase.from("messages").update({ read: true }).eq("id", m.id);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` }, (payload: any) => {
        const m = payload.new;
        setMessages(prev => prev.map(msg => msg.id === m.id ? { ...msg, read: m.read } : msg));
      })
      .subscribe((status) => {
        const channelKey = `room-${roomId}`;
        handleRealtimeChannelStatus("room", channelKey, status, () => {
          if (activeChatRoomRef.current?.id !== roomId) return;
          mountRoomSubscription(roomId);
        });
      });
    roomChannelRef.current = channel;
    activeChatRoomIdRef.current = roomId;
    console.log("[PindMap:message] subscription mounted", roomId);
  }, [unmountRoomSubscription, handleRealtimeChannelStatus]);

  const clearMessageUserSearch = useCallback(() => {
    setMessageUserSearchQuery("");
    setMessageUserSearchResults([]);
    setMessageUserSearchLoading(false);
  }, []);

  const openMessageSearchProfile = useCallback(
    (username: string) => {
      router.push(`/profile/${encodeURIComponent(username)}?from=messages`);
    },
    [router],
  );

  const toggleMessageSearchFollow = async (hit: UserSearchHit, e: React.MouseEvent) => {
    e.stopPropagation();
    if (messageUserSearchFollowLoadingId) return;
    setMessageUserSearchFollowLoadingId(hit.id);
    try {
      if (hit.isFollowing) {
        await unfollowUser(hit.username);
      } else {
        await followUser(hit.username);
      }
      setMessageUserSearchResults((prev) =>
        prev.map((u) => (u.id === hit.id ? { ...u, isFollowing: !hit.isFollowing } : u)),
      );
    } finally {
      setMessageUserSearchFollowLoadingId(null);
    }
  };

  const openChat = async (room: ChatRoom) => {
    const perfScreen = `chat:${room.id}`;
    dlog.perf.start(perfScreen);
    const fromId = activeChatRoom?.id ?? null;
    const reqId = ++openChatRequestRef.current;
    console.log("[PindMap:message] chatroom switched", { from: fromId, to: room.id });
    setChatRoomLoading(true);
    try {
      unmountRoomSubscription("openChat");
      setMessages([]);
      setChatOlderHasMore(false);
      setChatLoadingOlder(false);
      chatOlderLoadInFlightRef.current = false;
      setActiveChatRoom(room);
      setChatRooms((prev) => prev.map((r) => (r.id === room.id ? { ...r, unreadCount: 0 } : r)));

      void supabase
        .from("messages")
        .update({ read: true })
        .eq("room_id", room.id)
        .neq("sender_id", MY_USER)
        .eq("read", false)
        .then(
          () => {},
          (err) => console.error("[PindMap:message] mark messages read failed", err),
        );

      const me = user?.id;
      if (me && room?.id) {
        void supabase
          .from("notifications")
          .update({ read: true })
          .eq("user_id", me)
          .eq("type", "message")
          .eq("target_id", room.id)
          .eq("read", false)
          .then(
            () => {
              setNotifications((prev) =>
                prev.map((n) => (n.type === "message" && n.target_id === room.id ? { ...n, read: true } : n)),
              );
            },
            (err) => console.error("[PindMap:notify] mark message notifications read failed", err),
          );
      }

      let rows: any[] = [];
      try {
        dlog.perf.fetchStart(perfScreen);
        const res = await withAutoRetry((signal) =>
          Promise.resolve(
            supabase
              .from("messages")
              .select("*")
              .eq("room_id", room.id)
              .order("created_at", { ascending: false })
              .limit(CHAT_MESSAGES_PAGE_SIZE)
              .abortSignal(signal),
          ),
        );
        if (res.error) throw res.error;
        rows = (res.data as any[] | null) ?? [];
        dlog.perf.fetchEnd(perfScreen);
      } catch (e) {
        dlog.perf.fetchEnd(perfScreen);
        console.error("[PindMap:message] openChat fetch failed", e);
        setMessages([]);
        setChatOlderHasMore(false);
        mountRoomSubscription(room.id);
        dlog.perf.markRender(perfScreen);
        return;
      }

      if (reqId !== openChatRequestRef.current) {
        dlog.perf.cancel(perfScreen);
        return;
      }
      const data = rows;
      const asc = [...rows].reverse();
      setMessages(
        asc.map((m: any) => ({
          id: m.id,
          senderId: m.sender_id,
          text: m.text,
          createdAt: m.created_at,
          read: m.read,
          status: "sent" as const,
        })),
      );
      setChatOlderHasMore(rows.length === CHAT_MESSAGES_PAGE_SIZE);
      mountRoomSubscription(room.id);
    } finally {
      if (reqId === openChatRequestRef.current) {
        setChatRoomLoading(false);
      }
    }
  };

  const resolveChatRoomForId = useCallback(async (roomId: string): Promise<ChatRoom | null> => {
    const existing = chatRoomsRef.current.find((r) => r.id === roomId);
    if (existing) return existing;
    const uid = userIdRef.current;
    if (!uid) return null;
    const { data } = await supabase.from("chat_rooms").select("*").eq("id", roomId).maybeSingle();
    if (!data) return null;
    const friendId = data.user1_id === uid ? data.user2_id : data.user1_id;
    const { data: friendData } = await supabase
      .from("users")
      .select("username, avatar_url")
      .eq("id", friendId)
      .maybeSingle();
    if (friendData) {
      userAvatarCacheRef.current.setFromRow({
        id: friendId,
        username: friendData.username,
        avatar_url: friendData.avatar_url,
      });
    }
    const room: ChatRoom = {
      id: data.id,
      friendId,
      friendName: friendData?.username ?? friendId,
      friendAvatarUrl: normalizeAvatarUrl(friendData?.avatar_url),
      lastMessage: "",
      lastTime: data.created_at,
      unreadCount: 0,
    };
    setChatRooms((prev) =>
      sortChatRoomsByRecency(prev.some((r) => r.id === room.id) ? prev : [room, ...prev]),
    );
    return room;
  }, []);

  const navigateFromInAppNotification = useCallback(
    async (item: InAppNotificationItem) => {
      if (item.notificationId) {
        await supabase.from("notifications").update({ read: true }).eq("id", item.notificationId);
        setNotifications((prev) =>
          prev.map((x) => (x.id === item.notificationId ? { ...x, read: true } : x)),
        );
      }
      setShowNotifications(false);
      if (item.type === "like" || item.type === "comment") {
        if (item.targetId) setDetailPostId(item.targetId);
        return;
      }
      if (item.type === "follow") {
        router.push(`/profile/${encodeURIComponent(item.actorUsername)}`);
        return;
      }
      if (item.type === "message" && item.targetId) {
        setActiveTab("messages");
        const room = await resolveChatRoomForId(item.targetId);
        if (room) await openChat(room);
      }
    },
    [openChat, resolveChatRoomForId, router],
  );

  const loadOlderMessages = useCallback(async () => {
    const room = activeChatRoomRef.current;
    if (!room || chatOlderLoadInFlightRef.current || !chatOlderHasMoreRef.current) return;
    const oldest = oldestMessageCreatedAtRef.current;
    if (!oldest) return;
    chatOlderLoadInFlightRef.current = true;
    setChatLoadingOlder(true);
    const roomId = room.id;
    const el = chatMessagesContainerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    const prevScrollTop = el?.scrollTop ?? 0;
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("room_id", roomId)
        .lt("created_at", oldest)
        .order("created_at", { ascending: false })
        .limit(CHAT_MESSAGES_PAGE_SIZE);
      if (activeChatRoomRef.current?.id !== roomId) return;
      if (error) {
        console.error("[PindMap:message] loadOlder failed", error);
        return;
      }
      const rows = data ?? [];
      const asc = [...rows].reverse().map((m: any) => ({
        id: m.id,
        senderId: m.sender_id,
        text: m.text,
        createdAt: m.created_at,
        read: m.read,
        status: "sent" as const,
      }));
      setMessages((prev) => {
        const merged = [...asc, ...prev];
        const seen = new Set<string>();
        return merged.filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
      });
      setChatOlderHasMore(rows.length === CHAT_MESSAGES_PAGE_SIZE);
      requestAnimationFrame(() => {
        const el2 = chatMessagesContainerRef.current;
        if (el2 && activeChatRoomRef.current?.id === roomId) {
          el2.scrollTop = prevScrollTop + (el2.scrollHeight - prevScrollHeight);
        }
      });
    } finally {
      chatOlderLoadInFlightRef.current = false;
      if (activeChatRoomRef.current?.id === roomId) setChatLoadingOlder(false);
    }
  }, []);

  useEffect(() => {
    oldestMessageCreatedAtRef.current = messages[0]?.createdAt ?? null;
    chatOlderHasMoreRef.current = chatOlderHasMore;
  }, [messages, chatOlderHasMore]);

  /** A: navigator.onLine + C: 채팅 Realtime 채널 joined 여부 (가벼운 health check) */
  const isMessageSendConnectionLikelyOk = useCallback((): boolean => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return false;
    const channels = [globalMessagesChannelRef.current, roomChannelRef.current].filter(Boolean) as {
      state?: string;
    }[];
    if (channels.length === 0) return true;
    return channels.some((ch) => ch.state === "joined");
  }, []);

  const insertMessageWithSendRecovery = useCallback(
    (
      insertFn: (signal: AbortSignal) => Promise<unknown>,
      onBeforeAutoRetry?: () => void,
    ) =>
      withAutoRetryAndMessageSendRecovery(insertFn, {
        isConnectionLikelyOk: isMessageSendConnectionLikelyOk,
        onBeforeAutoRetry,
      }),
    [isMessageSendConnectionLikelyOk],
  );

  /** WKWebView 키보드 후 window/document 스크롤만 리셋. 메시지 목록(overflow-y)은 별도 컨테이너라 영향 없음. */
  const resetWindowScrollAfterChatKeyboard = useCallback(() => {
    chatComposerInputRef.current?.blur();
    requestAnimationFrame(() => {
      document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      window.scrollTo(0, 0);
    });
  }, []);

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeChatRoom) return;
    try {
      debugLog.resetSendSteps();
      debugLog.pushSendStep("start");
    } catch {
      /* ignore */
    }

    const roomId = activeChatRoom.id;
    const friendId = activeChatRoom.friendId;
    const text = newMessage.trim();
    const senderId = userSendRef.current?.id || userIdRef.current;
    if (!senderId) {
      showToast("잠시 후 다시 시도해 주세요", "error");
      return;
    }
    const id = Date.now().toString();
    if (sendingIdsRef.current.has(id)) return;
    sendingIdsRef.current.add(id);
    const createdAt = new Date().toISOString();
    console.log("[PindMap:message] send start", { id, roomId });
    chatStickToBottomRef.current = true;
    setMessages((prev) => [...prev, { id, senderId, text, createdAt, read: false, status: "pending" }]);
    setNewMessage("");
    setChatRooms((prev) =>
      sortChatRoomsByRecency(
        prev.map((r) =>
          r.id === roomId ? { ...r, lastMessage: text, lastTime: createdAt } : r,
        ),
      ),
    );
    let insertT = 0;
    try {
      insertT = Date.now();
      try {
        debugLog.pushSendStep("insert_begin");
      } catch {
        /* ignore */
      }
      await insertMessageWithSendRecovery(
        (signal) =>
          Promise.resolve(
            supabase
              .from("messages")
              .insert({ id, room_id: roomId, sender_id: senderId, text, read: false })
              .abortSignal(signal),
          ).then((r) => {
            if (r.error) throw r.error;
            return r;
          }),
        () => {
          try {
            debugLog.pushSendStep("auto_retry_wait");
          } catch {
            /* ignore */
          }
        },
      );
      try {
        debugLog.pushSendStep("insert_ok", Date.now() - insertT);
      } catch {
        /* ignore */
      }
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "sent" as const } : m)));
      console.log("[PindMap:message] send success", { id, roomId });
      if (friendId && friendId !== senderId) {
        void supabase
          .from("notifications")
          .insert({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 8),
            user_id: friendId,
            type: "message",
            actor_id: senderId,
            actor_username: MY_USERNAME,
            target_id: roomId,
            target_text: text.length > 30 ? text.slice(0, 30) + "..." : text,
          })
          .then(
            () => {},
            () => {},
          );
      }
    } catch (err: unknown) {
      try {
        const errName = err instanceof Error ? err.name : "err";
        debugLog.pushSendStep(`insert_fail:${errName}`, Date.now() - insertT);
      } catch {
        /* ignore */
      }
      console.error("[PindMap:message] send failed", { id, roomId, err });
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "failed" as const } : m)));
    } finally {
      try {
        debugLog.pushSendStep("done");
      } catch {
        /* ignore */
      }
      sendingIdsRef.current.delete(id);
      requestAnimationFrame(() => {
        chatComposerInputRef.current?.focus();
      });
    }
  };

  const resendFailedMessage = async (failedMessage: Message) => {
    if (!activeChatRoom) return;
    if (failedMessage.status !== "failed") return;
    const roomId = activeChatRoom.id;
    const id = failedMessage.id;
    if (sendingIdsRef.current.has(id)) return;
    const senderId = userSendRef.current?.id || userIdRef.current;
    if (!senderId) {
      showToast("잠시 후 다시 시도해 주세요", "error");
      return;
    }
    console.log("[PindMap:message] resend start", { id, roomId });
    sendingIdsRef.current.add(id);
    setMessages((prev) => prev.map((m) => (m.id === failedMessage.id ? { ...m, status: "pending" as const } : m)));
    try {
      await withAutoRetry((signal) =>
        Promise.resolve(
          supabase
            .from("messages")
            .insert({
              id: failedMessage.id,
              room_id: roomId,
              sender_id: senderId,
              text: failedMessage.text,
              read: false,
            })
            .abortSignal(signal),
        ).then((r) => {
          if (r.error) throw r.error;
          return r;
        }),
      );
      setMessages((prev) => prev.map((m) => (m.id === failedMessage.id ? { ...m, status: "sent" as const } : m)));
      console.log("[PindMap:message] resend success", { id, roomId });
    } catch (err: unknown) {
      console.error("[PindMap:message] resend failed", { id, roomId, err });
      setMessages((prev) => prev.map((m) => (m.id === failedMessage.id ? { ...m, status: "failed" as const } : m)));
    } finally {
      sendingIdsRef.current.delete(id);
      requestAnimationFrame(() => {
        chatComposerInputRef.current?.focus();
      });
    }
  };

  // 저장 목록 장소 클릭 → 지도에서 보기
  const handleSavedPlaceClick = (place: Place) => {
    setSelectedMapPlace(place);
    setActiveTab("map");
    const relatedPosts = getRelatedPostsForPlaceSheet(feedPosts, placeRefFromPlace(place));
    const stored = latLngFromRow(place);
    if (stored && mapRef.current) {
      mapRef.current.setCenter(new window.kakao.maps.LatLng(stored.lat, stored.lng));
      mapRef.current.setLevel(4);
      savedPlaceCoordsRef.current[place.id] = stored;
      setSelectedPlace(toSelectedFromSavedPlace(place, relatedPosts, stored.lat, stored.lng));
      setMapExpanded(true);
      return;
    }
    if (mapRef.current && geocoderRef.current) {
      geocoderRef.current.addressSearch(place.address, (result: any[], sv: string) => {
        if (sv !== window.kakao.maps.services.Status.OK || !result[0]) return;
        const markerLat = parseFloat(result[0].y);
        const markerLng = parseFloat(result[0].x);
        mapRef.current.setCenter(new window.kakao.maps.LatLng(result[0].y, result[0].x));
        mapRef.current.setLevel(4);
        setSelectedPlace(toSelectedFromSavedPlace(place, relatedPosts, markerLat, markerLng));
        setMapExpanded(true);
      });
    }
  };

  /** 큐레이션 상세 → 저장된 장소면 저장 클릭과 동일, 아니면 임시로 지도만 열고 빈 하트(미저장) */
  const goToMapFromDetailPost = () => {
    if (!detailPost) return;
    const name = detailPost.placeName.trim();
    const addr = detailPost.address.trim();
    const matchedPlace = savedPlaces.find(
      (p) => String(p.name).trim() === name && String(p.address).trim() === addr,
    );
    if (matchedPlace) {
      handleSavedPlaceClick(matchedPlace);
      setDetailPostId(null);
      return;
    }

    const postCoords = latLngFromRow(detailPost);
    setActiveTab("map");
    if (postCoords && mapRef.current) {
      mapRef.current.setCenter(new window.kakao.maps.LatLng(postCoords.lat, postCoords.lng));
      mapRef.current.setLevel(4);
      const detailRef = placeRefFromFeedPost(detailPost);
      const relatedPosts = getRelatedPostsForPlaceSheet(feedPosts, detailRef);
      setSelectedPlace({
        place_name: detailPost.placeName,
        category_name: detailPost.category,
        road_address_name: detailPost.address,
        address_name: detailPost.address,
        phone: "",
        place_url: "",
        y: String(postCoords.lat),
        x: String(postCoords.lng),
        _feedPosts: relatedPosts,
        _placeRef: detailRef,
      });
      setMapExpanded(true);
      setDetailPostId(null);
      return;
    }

    if (mapRef.current && geocoderRef.current) {
      geocoderRef.current.addressSearch(detailPost.address, (result: any[], sv: string) => {
        if (sv !== window.kakao.maps.services.Status.OK || !result[0]) return;
        const geocodedLat = parseFloat(result[0].y);
        const geocodedLng = parseFloat(result[0].x);
        mapRef.current.setCenter(new window.kakao.maps.LatLng(geocodedLat, geocodedLng));
        mapRef.current.setLevel(4);
        const detailRef = {
          ...placeRefFromFeedPost(detailPost),
          ...(Number.isFinite(geocodedLat) && Number.isFinite(geocodedLng)
            ? { lat: geocodedLat, lng: geocodedLng }
            : {}),
        };
        const relatedPosts = getRelatedPostsForPlaceSheet(feedPosts, detailRef);
        new window.kakao.maps.services.Places().keywordSearch(detailPost.placeName, (data: any[], st: string) => {
          const base =
            st === window.kakao.maps.services.Status.OK && data[0]
              ? data[0]
              : {
                  place_name: detailPost.placeName,
                  category_name: detailPost.category,
                  road_address_name: detailPost.address,
                  phone: "",
                  place_url: "",
                };
          setSelectedPlace({ ...base, _feedPosts: relatedPosts, _placeRef: detailRef });
          setMapExpanded(true);
        });
      });
    }
    setDetailPostId(null);
  };

  // 지도 탭의 작은 목록에서 장소 클릭 → 상세 카드만 띄움 (전체화면 X)
  const handleMiniListClick = (place: Place) => {
    const relatedPosts = getRelatedPostsForPlaceSheet(feedPosts, placeRefFromPlace(place));
    if (!window.kakao?.maps?.services) {
      setSelectedPlace(toSelectedFromSavedPlace(place, relatedPosts));
      return;
    }
    setSelectedPlace(toSelectedFromSavedPlace(place, relatedPosts));
  };

  // 게시물에서 바로 팔로우
  const followUser = async (username: string) => {
    if (username === MY_USERNAME || !user) return;
    // 유저 정보 가져오기
    const { data: targetUser } = await supabase.from("users").select("id, username").eq("username", username).maybeSingle();
    if (!targetUser) { showToast("유저를 찾을 수 없어요", "error"); return; }
    // 이미 팔로우 중이면 무시
    if (followingIds.includes(targetUser.id)) return;
    // follows 테이블에 INSERT
    const { error } = await supabase.from("follows").insert({
      follower_id: user.id,
      following_id: targetUser.id,
    });
    if (error) { showToast("팔로우 실패", "error"); return; }
    setFollowingIds(prev => [...prev, targetUser.id]);

    if (user) {
      try {
        await supabase.from("notifications").insert({
          id: Date.now().toString() + Math.random().toString(36).substring(2, 8),
          user_id: targetUser.id,
          type: "follow",
          actor_id: user.id,
          actor_username: MY_USERNAME,
          target_id: null,
          target_text: null,
        });
      } catch {
        /* 알림 INSERT 실패 무시 */
      }
    }

    showToast("팔로우 완료", "success");
  };

  const unfollowUser = async (username: string) => {
    if (!user) return;
    const { data: targetUser } = await supabase.from("users").select("id").eq("username", username).maybeSingle();
    if (!targetUser) return;
    await supabase.from("follows")
      .delete()
      .eq("follower_id", user.id)
      .eq("following_id", targetUser.id);
    setFollowingIds(prev => prev.filter(id => id !== targetUser.id));
    showToast("언팔로우 완료", "success");
  };

  const openShareModal = async (post: FeedPost) => {
    if (!user) return;
    setSharePost(post);
    const { data: roomsData } = await supabase
      .from("chat_rooms")
      .select("*")
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`);
    if (!roomsData) {
      setFriendRooms([]);
      return;
    }
    const rooms: FriendRoom[] = await Promise.all(
      roomsData.map(async (r: any) => {
        const friendId = r.user1_id === user.id ? r.user2_id : r.user1_id;
        const { data: friendData } = await supabase
          .from("users")
          .select("username, avatar_url")
          .eq("id", friendId)
          .maybeSingle();
        if (friendData) {
          userAvatarCacheRef.current.setFromRow({ id: friendId, username: friendData.username, avatar_url: friendData.avatar_url });
        }
        return {
          id: r.id,
          friendId,
          friendName: friendData?.username ?? friendId,
          friendAvatarUrl: normalizeAvatarUrl(friendData?.avatar_url),
        };
      }),
    );
    setFriendRooms(rooms);
  };

  const sendShareToFriend = async (room: FriendRoom) => {
    if (!user || !sharePost || shareLoading) return;
    setShareLoading(true);
    try {
      const shareText = `📍 ${sharePost.user}님의 큐레이션\n\n"${sharePost.title || sharePost.placeName}"\n${sharePost.placeName} · ${sharePost.category}\n\n${sharePost.comment.length > 80 ? `${sharePost.comment.slice(0, 80)}...` : sharePost.comment}\n\n👆 큐레이션 보러 가기 [share:${sharePost.id}]`;
      const msgId = Date.now().toString();
      await supabase.from("messages").insert({
        id: msgId,
        room_id: room.id,
        sender_id: user.id,
        text: shareText,
        read: false,
      });
      setSharePost(null);
      setFriendRooms([]);
      setDetailPostId(null);
      router.push(`/?openChatRoom=${room.id}`);
    } finally {
      setShareLoading(false);
    }
  };

  const closeCourseShareModal = () => {
    if (courseShareLoading) return;
    setShowCourseShareModal(false);
    setSharingCourse(null);
    setCourseShareFriendRooms([]);
    setCourseShareSendingRoomId(null);
    setCourseShareSearchQuery("");
    setCourseShareSentRoomIds([]);
  };

  const handleCopyCourseShareLink = async () => {
    if (!sharingCourse || courseShareLoading) return;
    const url = getCourseShareUrl(sharingCourse.id);
    const ok = await copyTextToClipboard(url);
    if (ok) {
      showToast("링크가 복사되었어요", "success");
    } else {
      showToast("복사할 수 없어요", "error");
    }
  };

  const handleShareCourseViaSystem = async () => {
    if (!sharingCourse || courseShareLoading) return;
    const url = getCourseShareUrl(sharingCourse.id);
    const placeCount = sharingCourse.place_count ?? sharingCourse.items.length;
    const result = await shareViaNavigatorShare({
      title: sharingCourse.title,
      text: `PindMap에서 ${placeCount}곳 코스 보기`,
      url,
    });
    if (result === "shared" || result === "cancelled") return;
    const ok = await copyTextToClipboard(url);
    if (ok) {
      showToast("공유를 지원하지 않아 링크를 복사했어요", "info");
    } else {
      showToast("복사할 수 없어요", "error");
    }
  };

  const activeViewedCourseId = savedCourseId ?? viewingSavedCourseIdRef.current;

  const openCourseShareModal = async (course: SavedCourse) => {
    if (!user) {
      console.log("[PindMap:course-share] open modal blocked: no user");
      showToast("로그인 후 코스를 공유할 수 있어요", "info");
      return;
    }
    console.log("[PindMap:course-share] open modal", course.id);
    setSharingCourse(course);
    setShowCourseShareModal(true);
    setCourseShareSearchQuery("");
    setCourseShareSentRoomIds([]);
    const { data: roomsData } = await supabase
      .from("chat_rooms")
      .select("*")
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`);
    if (!roomsData) {
      setCourseShareFriendRooms([]);
      return;
    }
    const rooms: FriendRoom[] = await Promise.all(
      roomsData.map(async (r: { id: string; user1_id: string; user2_id: string }) => {
        const friendId = r.user1_id === user.id ? r.user2_id : r.user1_id;
        const { data: friendData } = await supabase
          .from("users")
          .select("username, avatar_url")
          .eq("id", friendId)
          .maybeSingle();
        if (friendData) {
          userAvatarCacheRef.current.setFromRow({ id: friendId, username: friendData.username, avatar_url: friendData.avatar_url });
        }
        return {
          id: r.id,
          friendId,
          friendName: getDisplayFriendName(friendData?.username, friendId),
          friendAvatarUrl: normalizeAvatarUrl(friendData?.avatar_url),
        };
      }),
    );
    setCourseShareFriendRooms(rooms);
    console.log("[PindMap:course-share] friend rooms", rooms.length);
  };

  const sendCourseToFriend = async (room: FriendRoom) => {
    if (!user || !sharingCourse || courseShareLoading || courseShareSentRoomIds.includes(room.id)) return;
    setCourseShareLoading(true);
    setCourseShareSendingRoomId(room.id);
    try {
      const shareText = buildCourseShareText(sharingCourse);
      const msgId = Date.now().toString();
      await insertMessageWithSendRecovery((signal) =>
        Promise.resolve(
          supabase
            .from("messages")
            .insert({
              id: msgId,
              room_id: room.id,
              sender_id: user.id,
              text: shareText,
              read: false,
            })
            .abortSignal(signal),
        ).then((r) => {
          if (r.error) throw r.error;
          return r;
        }),
      );
      const preview = shareText.replace(/\[course:[^\]]+\]/, "").trim();
      const targetText = preview.length > 30 ? `${preview.slice(0, 30)}...` : preview;
      void supabase
        .from("notifications")
        .insert({
          id: Date.now().toString() + Math.random().toString(36).substring(2, 8),
          user_id: room.friendId,
          type: "message",
          actor_id: user.id,
          actor_username: MY_USERNAME,
          target_id: room.id,
          target_text: targetText,
        })
        .then(
          () => {},
          () => {},
        );
      setCourseShareSentRoomIds((prev) =>
        prev.includes(room.id) ? prev : [...prev, room.id],
      );
      showToast(`${room.friendName}에게 보냈어요`, "success");
    } catch {
      showToast("공유에 실패했어요. 다시 시도해주세요", "error");
    } finally {
      setCourseShareLoading(false);
      setCourseShareSendingRoomId(null);
    }
  };

  const openCourseShareFromSheet = () => {
    const courseId = activeViewedCourseId;
    if (!courseId) {
      console.log("[PindMap:course-share] blocked: no course id", {
        savedCourseId,
        refId: viewingSavedCourseIdRef.current,
      });
      showToast("코스 정보를 불러오는 중이에요. 잠시 후 다시 시도해주세요", "info");
      return;
    }
    if (!user?.id) {
      console.log("[PindMap:course-share] blocked: no user", courseId);
      showToast("로그인 후 코스를 공유할 수 있어요", "info");
      return;
    }
    if (!courseResult?.length) {
      console.log("[PindMap:course-share] blocked: empty places", courseId);
      showToast("공유할 장소가 없어요", "info");
      return;
    }
    const ownerId =
      viewedCourseUserId ?? courseCache[courseId]?.user_id ?? user.id;
    const tempCourse: SavedCourse = {
      id: courseId,
      user_id: ownerId,
      title: editingCourseTitle,
      items: courseResult.map(coursePlaceToSavedItem),
      place_count: courseResult.length,
      created_at: "",
      updated_at: "",
    };
    console.log("[PindMap:course-share] open from sheet", courseId, courseResult.length);
    void openCourseShareModal(tempCourse);
  };

  const viewedCourseOwnerId = useMemo(() => {
    if (viewedCourseUserId) return viewedCourseUserId;
    if (!activeViewedCourseId) return null;
    return courseCache[activeViewedCourseId]?.user_id ?? null;
  }, [viewedCourseUserId, activeViewedCourseId, courseCache]);

  const showSaveToMyCoursesButton = Boolean(
    user?.id &&
      activeViewedCourseId &&
      viewedCourseOwnerId &&
      viewedCourseOwnerId !== user.id,
  );

  const courseAlreadyImported = useMemo(() => {
    if (!activeViewedCourseId || !user?.id || viewedCourseOwnerId === user.id) return false;
    return myCourses.some((c) => c.cloned_from_id === activeViewedCourseId);
  }, [activeViewedCourseId, viewedCourseOwnerId, user?.id, myCourses]);

  const handleImportCourse = async (originalCourseId: string) => {
    if (!user?.id || courseImporting) return;
    setCourseImporting(true);
    try {
      const { data, alreadyImported, error } = await importCourse(originalCourseId, user.id);
      if (alreadyImported) {
        showToast("이미 내 코스에 저장된 코스예요", "info");
        return;
      }
      if (error) {
        showToast(error, "error");
        return;
      }
      if (data) {
        showToast("내 코스에 저장됐어요", "success");
        setMyCourses((prev) => [data, ...prev.filter((c) => c.id !== data.id)]);
        void refreshMyCourses();
      }
    } finally {
      setCourseImporting(false);
    }
  };

  // 코스 만들기 실행
  const generateCourse = async () => {
    if (!geocoderRef.current) {
      showToast("지도가 아직 준비되지 않았어요. 지도 탭을 한 번 열어주세요.", "info");
      return;
    }
    const totalCount = CATEGORY_COURSE_MODAL_ORDER.reduce((sum, c) => sum + courseCounts[c], 0);
    if (totalCount === 0) {
      showToast("최소 한 개 이상 선택해주세요", "info");
      return;
    }
    const perfScreen = "course:generate";
    dlog.perf.start(perfScreen);
    dlog.perf.fetchStart(perfScreen);
    viewingSavedCourseIdRef.current = null;
    setViewedCourseUserId(null);
    setCourseLoading(true);
    try {
      // 1. 출발지 좌표 결정
      let originLat = 37.5665;
      let originLng = 126.978;
      if (courseOriginMode === "current") {
        await new Promise<void>((resolve) => {
          if (!navigator.geolocation) { resolve(); return; }
          navigator.geolocation.getCurrentPosition(
            (pos) => { originLat = pos.coords.latitude; originLng = pos.coords.longitude; resolve(); },
            () => { resolve(); },
            { timeout: 5000 }
          );
        });
      } else if (courseOriginAddress.trim()) {
        await new Promise<void>((resolve) => {
          geocoderRef.current.addressSearch(courseOriginAddress.trim(), (result: any[], st: string) => {
            if (st === window.kakao.maps.services.Status.OK && result[0]) {
              originLat = parseFloat(result[0].y);
              originLng = parseFloat(result[0].x);
            }
            resolve();
          });
        });
      }

      // 2. savedPlaces 각 장소의 좌표 조회 (주소 → 위경도)
      const placesWithCoords: CoursePlace[] = [];
      await Promise.all(
        courseBasePlaces.map(
          (place) =>
            new Promise<void>((resolve) => {
              const cached = coursePlaceCoords[place.id];
              if (cached) {
                placesWithCoords.push({ ...place, lat: cached.lat, lng: cached.lng });
                resolve();
                return;
              }
              geocoderRef.current.addressSearch(place.address, (result: any[], st: string) => {
                if (st === window.kakao.maps.services.Status.OK && result[0]) {
                  const coord = { lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) };
                  placesWithCoords.push({
                    ...place,
                    lat: coord.lat,
                    lng: coord.lng,
                  });
                  setCoursePlaceCoords((prev) => ({ ...prev, [place.id]: coord }));
                }
                resolve();
              });
            })
        )
      );

      // 3. 카테고리별로 분류
      const candidates: Record<Category, CoursePlace[]> = {
        카페: placesWithCoords.filter((p) => p.category === "카페"),
        맛집: placesWithCoords.filter((p) => p.category === "맛집"),
        쇼핑: placesWithCoords.filter((p) => p.category === "쇼핑"),
        숙소: placesWithCoords.filter((p) => p.category === "숙소"),
        놀거리: placesWithCoords.filter((p) => p.category === "놀거리"),
        여행지: placesWithCoords.filter((p) => p.category === "여행지"),
      };

      // 4. 요청한 개수가 가능한지 체크 (쇼핑은 중복 OK라고 했지만, 일단 같은 장소 2번은 X 정책으로 갔으니 후보가 부족하면 가능한 만큼만)
      const adjustedCounts: Record<Category, number> = {
        카페: Math.min(courseCounts.카페, candidates.카페.length),
        맛집: Math.min(courseCounts.맛집, candidates.맛집.length),
        쇼핑: Math.min(courseCounts.쇼핑, candidates.쇼핑.length),
        숙소: Math.min(courseCounts.숙소, candidates.숙소.length),
        놀거리: Math.min(courseCounts.놀거리, candidates.놀거리.length),
        여행지: Math.min(courseCounts.여행지, candidates.여행지.length),
      };

      if (courseOriginMode === "manual" && courseRegionKeyword) {
        const labels: Record<Category, string> = {
          카페: "카페",
          맛집: "맛집",
          쇼핑: "쇼핑",
          숙소: "숙소",
          놀거리: "놀거리",
          여행지: "여행지",
        };
        CATEGORY_COURSE_MODAL_ORDER.forEach((cat) => {
          if (courseCounts[cat] > adjustedCounts[cat]) {
            showToast(`${courseRegionKeyword}에 ${labels[cat]}가 ${adjustedCounts[cat]}개뿐이에요`, "info");
          }
        });
      }

      const selectedPools: Record<Category, CoursePlace[]> = {
        카페: shufflePick(candidates.카페, adjustedCounts.카페),
        맛집: shufflePick(candidates.맛집, adjustedCounts.맛집),
        쇼핑: shufflePick(candidates.쇼핑, adjustedCounts.쇼핑),
        숙소: shufflePick(candidates.숙소, adjustedCounts.숙소),
        놀거리: shufflePick(candidates.놀거리, adjustedCounts.놀거리),
        여행지: shufflePick(candidates.여행지, adjustedCounts.여행지),
      };
      const mergedCandidates: CoursePlace[] = CATEGORY_COURSE_MODAL_ORDER.flatMap((c) => selectedPools[c]);

      // 5. 알고리즘 실행
      const course = buildCourse(
        { lat: originLat, lng: originLng },
        mergedCandidates,
        { avoidConsecutiveCategories: ["카페", "맛집"] },
      );

      if (course.length === 0) {
        showToast("코스를 만들 수 없어요. 저장된 장소를 더 추가해보세요.", "info");
        return;
      }
      setCourseResult(course);

      // 부족했으면 안내
      const requested = CATEGORY_COURSE_MODAL_ORDER.reduce((sum, c) => sum + courseCounts[c], 0);
      if (course.length < requested) {
        showToast(`저장된 장소가 부족해서 ${course.length}곳으로 코스를 만들었어요`, "info");
      }
    } catch (e) {
      showToast("코스를 만드는 중 오류가 발생했어요", "error");
    } finally {
      dlog.perf.fetchEnd(perfScreen);
      setCourseLoading(false);
      dlog.perf.markRender(perfScreen);
    }
  };

  // 코스를 전체화면 지도에 경로로 표시
  const showCourseOnMap = async () => {
    if (!courseResult || courseResult.length === 0) return;
    returnToCourseSheetRef.current = true;
    setShowCourseModal(false);
    setShowCourseRoute(true);
    setActiveTab("map");
    if (isNativeMapAvailable()) {
      fullscreenCourseRef.current = [...courseResult];
      setMapExpanded(true);
      return;
    }
    setMapExpanded(true);
    // 지도가 그려진 후에 마커와 폴리라인 그리기 (살짝 딜레이)
    setTimeout(() => drawCourseRoute(), 800);
  };

  // 전체화면 지도에 코스 경로 그리기
  const drawCourseRoute = () => {
    if (!courseResult) return;
    if (!expandedMapRef.current || !window.kakao?.maps) {
      if (drawCourseRouteRetryRef.current < 2) {
        drawCourseRouteRetryRef.current += 1;
        window.setTimeout(
          () => drawCourseRoute(),
          !expandedMapRef.current ? 200 : 1000,
        );
      }
      return;
    }
    drawCourseRouteRetryRef.current = 0;
    // 기존 경로 지우기
    clearRoute();
    searchMarkersRef.current.forEach((m) => m.setMap(null));
    searchMarkersRef.current = [];

    const path: any[] = [];
    const bounds = new window.kakao.maps.LatLngBounds();
    courseResult.forEach((place, idx) => {
      const pos = new window.kakao.maps.LatLng(place.lat, place.lng);
      path.push(pos);
      bounds.extend(pos);
      // 순번 마커
      const numberSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24S32 28 32 16C32 7.16 24.84 0 16 0z" fill="#1a2a7a" stroke="#fff" stroke-width="1.5"/><circle cx="16" cy="16" r="11" fill="#fff"/><text x="16" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#1a2a7a">${idx + 1}</text></svg>`;
      const markerImg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(numberSvg)}`;
      const marker = new window.kakao.maps.Marker({
        map: expandedMapRef.current,
        position: pos,
        image: new window.kakao.maps.MarkerImage(markerImg, new window.kakao.maps.Size(32, 40)),
      });
      window.kakao.maps.event.addListener(marker, "click", () => {
        const coursePlaceRef = placeRefFromPlace(
          { id: place.id, name: place.name, address: place.address, category: place.category },
          place.lat,
          place.lng,
        );
        setSelectedPlace({
          place_name: place.name,
          category_name: place.category,
          road_address_name: place.address,
          phone: "",
          place_url: "",
          y: place.lat,
          x: place.lng,
          _feedPosts: getRelatedPostsForPlaceSheet(feedPosts, coursePlaceRef),
          _placeRef: coursePlaceRef,
        });
      });
      searchMarkersRef.current.push(marker);
    });
    // 경로선
    routePolylineRef.current = new window.kakao.maps.Polyline({
      path,
      strokeWeight: 4,
      strokeColor: "#1a2a7a",
      strokeOpacity: 0.85,
      strokeStyle: "solid",
    });
    routePolylineRef.current.setMap(expandedMapRef.current);
    expandedMapRef.current.setBounds(bounds);
  };
  const handleAddFromInstagram = async () => {
    if (!canSubmit) return;
    if (!user?.id) {
      showToast("로그인이 필요합니다.", "error");
      return;
    }
    if (handleAddSubmittingRef.current) return;
    handleAddSubmittingRef.current = true;
    try {
    const trimmedUrl = cleanInstagramUrl(instagramUrl.trim());
    const perfScreen = "extract:start";
    dlog.perf.start(perfScreen);
    const controller = new AbortController();
    console.log("[PindMap:url] extraction start", { url: trimmedUrl });
    setIsSubmitting(true); setStatus(""); setError("");
    orchestratorSuccessKeyRef.current = "";
    window.localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY);
    completedJobIdsRef.current.clear();
    let timeout: number | undefined;
    try {
      timeout = window.setTimeout(() => controller.abort(), 10000);
      console.log("[PindMap:url] /api/extract/start request", { url: trimmedUrl, userId: user.id });
      dlog.perf.fetchStart(perfScreen);
      const response = await fetch("/api/extract/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ instagramUrl: trimmedUrl, userId: user.id }),
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      const data = await response.json() as { jobId?: string; error?: string };
      dlog.perf.fetchEnd(perfScreen);
      console.log("[PindMap:url] /api/extract/start response status:", response.status, "body:", data);
      if (!response.ok || !data.jobId) {
        console.log("[PindMap:url] /api/extract/start failed - status:", response.status, "error:", data?.error ?? "missing_job_id");
      }
      if (!response.ok || !data.jobId) throw new Error(`[status:${response.status}] ${data.error ?? "분석 작업 시작에 실패했습니다."}`);
      const newJob: ActiveExtractJob = {
        jobId: data.jobId,
        instagramUrl: trimmedUrl,
        status: "pending",
        progressStep: "대기 중",
      };
      setActiveJobs((prev) => [newJob, ...prev.filter((job) => job.jobId !== newJob.jobId)]);
      setInstagramUrl("");
      setStatus("분석 작업이 시작됐어요. 다른 작업하셔도 돼요!");
      console.log("[PindMap:url] extraction message shown");
      showToast("분석 작업을 백그라운드에서 시작했어요", "success");
      console.log("[PindMap:url] extraction success", { jobId: data.jobId });
      dlog.perf.markRender(perfScreen);
    } catch (e) {
      dlog.perf.fetchEnd(perfScreen);
      const isTimeout = e instanceof Error && e.name === "AbortError";
      console.log(`[PindMap:url] extraction ${isTimeout ? "timeout" : "failed"}`, { error: e });
      dlog.perf.markRender(perfScreen);
      const message = e instanceof Error && e.name === "AbortError"
        ? "요청이 지연되고 있어요. 잠시 후 다시 시도해주세요."
        : e instanceof Error
          ? e.message
          : "요청 처리 중 오류가 발생했습니다.";
      setStatus("");
      console.log(`[PindMap:url] extraction message hidden (${isTimeout ? "timeout" : "failed"})`);
      setError(message);
    }
    finally {
      if (typeof timeout === "number") window.clearTimeout(timeout);
      setIsSubmitting(false);
      console.log("[PindMap:url] state reset (finally)", { isSubmitting: false });
    }
    } finally {
      handleAddSubmittingRef.current = false;
    }
  };

  const uploadPostImageToServer = async (file: File, accessToken: string): Promise<string> => {
    console.log("[handleImageUpload] 원본", {
      name: file.name,
      type: file.type,
      size: file.size,
    });
    const prepared = await prepareImageForUpload(file);
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}-${Math.random().toString(36).substring(2, 11)}.jpg`;
    console.log("[handleImageUpload] 압축 완료, 업로드 시작", { fileName, size: prepared.size });

    const formData = new FormData();
    formData.append("file", prepared, fileName);
    formData.append("fileName", fileName);

    const fetchPromise = fetch("/api/upload/image", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
      credentials: "include",
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("업로드 시간이 너무 오래 걸려요. 다시 시도해주세요.")), 10000);
    });

    const res = await Promise.race([fetchPromise, timeoutPromise]);

    const data = (await res.json().catch(() => ({}))) as { publicUrl?: string; error?: string };
    const publicUrlRaw: string | undefined = data?.publicUrl;
    const uploadFailed = !res.ok || !publicUrlRaw || typeof publicUrlRaw !== "string";
    console.log("[handleImageUpload] Storage upload 응답", { ok: res.ok, status: res.status, hasError: uploadFailed });

    if (!res.ok) {
      console.error("[handleImageUpload] API 업로드 실패", data);
      throw new Error(data.error || `사진 업로드 실패 (${res.status})`);
    }

    console.log("[handleImageUpload] publicUrl 생성", publicUrlRaw);
    if (!publicUrlRaw || typeof publicUrlRaw !== "string") {
      console.error("[handleImageUpload] publicUrl 누락", data);
      throw new Error("사진 업로드 응답이 올바르지 않아요. 다시 시도해주세요.");
    }

    const publicUrl = publicUrlRaw;
    console.log("[handleImageUpload] 완료", publicUrl);
    return publicUrl;
  };

  const retryPostImageUpload = (item: PostImageItem) => {
    if (item.status !== "failed" || !item.file) return;
    const { id, file } = item;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        showToast("로그인이 필요합니다.", "error");
        return;
      }
      setPostImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, status: "uploading" as const, error: undefined } : img)),
      );
      try {
        const publicUrl = await uploadPostImageToServer(file, session.access_token);
        setPostImages((prev) => {
          const next = prev.map((img) => {
            if (img.id !== id) return img;
            if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
            return { id: img.id, previewUrl: "", publicUrl, status: "uploaded" as const };
          });
          console.log("[handleImageUpload] state 추가 완료, 총 이미지:", next.length);
          return next;
        });
      } catch (err) {
        console.error("[handleImageUpload] 재시도 예외", err);
        setPostImages((prev) =>
          prev.map((img) => (img.id === id ? { ...img, status: "failed" as const, error: err instanceof Error ? err.message : "오류", file } : img)),
        );
        showToast("사진 업로드에 실패했어요. 다시 시도해주세요", "error");
      }
    })();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_CURATION_PHOTOS - postImages.length);
    e.target.value = "";
    if (files.length === 0) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      showToast("로그인이 필요합니다.", "error");
      return;
    }
    const accessToken = session.access_token;

    for (const file of files) {
      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      const previewUrl = URL.createObjectURL(file);
      setPostImages((prev) => [...prev, { id, previewUrl, status: "uploading", file }]);

      void (async () => {
        try {
          const publicUrl = await uploadPostImageToServer(file, accessToken);
          setPostImages((prev) => {
            const next = prev.map((img) => {
              if (img.id !== id) return img;
              if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
              return { id: img.id, previewUrl: "", publicUrl, status: "uploaded" as const };
            });
            console.log("[handleImageUpload] state 추가 완료, 총 이미지:", next.length);
            return next;
          });
        } catch (err) {
          console.error("[handleImageUpload] 예외", err);
          const msg = err instanceof Error ? err.message : "알 수 없는 오류";
          setPostImages((prev) =>
            prev.map((img) =>
              img.id === id ? { ...img, status: "failed" as const, error: msg, file } : img,
            ),
          );
          showToast(`${file.name}: 업로드 실패. 재시도해주세요`, "error");
        }
      })();
    }
  };

  const handleChatMessagesScroll = () => {
    const el = chatMessagesContainerRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    chatStickToBottomRef.current = gap < 80;
    const gRoom = activeChatRoomRef.current?.id;
    if (gRoom && chatOlderHasMoreRef.current && !chatOlderLoadInFlightRef.current && el.scrollTop < 80) {
      void loadOlderMessages();
    }
  };
  const handleSubmitPost = async () => {
    if (!canPost) return;
    if (!isCompanionTag(postCompanionTag)) {
      alert("동행 태그를 선택해주세요.");
      return;
    }
    const repTag = getRepresentativePhotoPlaceTag(postPhotoPlaceTags);
    const hasPhotoTags = postPhotoPlaceTags.length > 0;
    const normalizedPlaceName = (repTag?.placeName ?? (hasPhotoTags ? postPlaceName : "")).trim();
    const normalizedAddress = (repTag?.address ?? (hasPhotoTags ? postAddress : "")).trim();
    if (normalizedPlaceName) {
      const { data: existing } = await supabase
        .from("feed_posts")
        .select("id")
        .eq("user_name", MY_USERNAME)
        .eq("place_name", normalizedPlaceName)
        .eq("address", normalizedAddress)
        .eq("archived", false)
        .maybeSingle();
      if (existing) {
        showToast("이미 이 장소에 큐레이션을 작성하셨어요", "info");
        return;
      }
    }
    const imageUrls = postImages
      .filter((img): img is PostImageItem & { publicUrl: string; status: "uploaded" } =>
        img.status === "uploaded" && typeof img.publicUrl === "string",
      )
      .map((img) => img.publicUrl);
    const postCoords = repTag
      ? { lat: repTag.lat, lng: repTag.lng }
      : coerceLatLng(postPlaceLat, postPlaceLng);

    let linkedCourseId: string | null = null;
    if (postSaveCourseChecked && user?.id) {
      const courseItems = buildUniqueCourseItemsFromPhotoPlaceTags(postPhotoPlaceTags);
      if (courseItems.length === 0) {
        showToast("장소 태그가 없어 코스는 저장하지 않았어요", "info");
      } else {
        const { data: savedCourse, error: courseError } = await saveCourse(
          user.id,
          postCourseTitle,
          courseItems,
          "curation",
        );
        if (courseError || !savedCourse) {
          showToast(courseError ?? "코스를 저장하지 못했어요", "error");
          return;
        }
        linkedCourseId = savedCourse.id;
      }
    }

    const savedCategories = postCategories.length > 0 ? [...postCategories] : null;
    const legacyCategory: Category =
      (savedCategories?.[0] as Category | undefined) ??
      (repTag?.category as Category | undefined) ??
      postCategory;

    const newPost: FeedPost = {
      id: Math.random().toString(36).substring(2) + Date.now().toString(36),
      user: MY_USERNAME,
      userId: user?.id || "",
      userAvatarUrl: user?.avatar_url,
      title: postTitle,
      placeName: repTag?.placeName ?? (hasPhotoTags ? postPlaceName : ""),
      address: repTag?.address ?? (hasPhotoTags ? postAddress : ""),
      ...(postCoords ? { lat: postCoords.lat, lng: postCoords.lng } : {}),
      category: legacyCategory,
      categories: savedCategories,
      comment: postComment,
      companionTag: postCompanionTag,
      photoPlaceTags: postPhotoPlaceTags.length > 0 ? postPhotoPlaceTags : null,
      courseId: linkedCourseId,
      images: imageUrls,
      createdAt: new Date().toISOString(),
      likes_count: 0,
      liked_by_me: false,
      comments: [],
    };
    const { error: postError } = await submitPost(newPost);
    if (postError) {
      showToast(`큐레이션 등록에 실패했어요: ${postError}`, "error");
      return;
    }

    showToast(
      linkedCourseId ? "큐레이션과 코스가 등록됐어요 ✨" : "큐레이션이 등록됐어요 ✨",
      "success",
    );
    setShowPostModal(false);
    setActiveTab("home");
  };
  const togglePostCategory = useCallback((cat: Category) => {
    setPostCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }, []);

  const resetPostForm = useCallback(() => {
    setPostTitle("");
    setPostPlaceName("");
    setPostAddress("");
    setPostPlaceLat(undefined);
    setPostPlaceLng(undefined);
    setPostComment("");
    setPostCompanionTag(null);
    setPostCategory("카페");
    setPostCategories([]);
    setPostImages((prev) => {
      prev.forEach((img) => {
        if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
      });
      return [];
    });
    setPostPhotoPlaceTags([]);
    setPostSaveCourseChecked(false);
    setPostCourseTitle("");
  }, []);
  const closePostScreen = () => setShowPostModal(false);
  const resetModal = () => {
    closePostScreen();
    resetPostForm();
  };

  const applyMyLocationOnMap = (
    map: any,
    scope: "main" | "expanded",
    latitude: number,
    longitude: number,
    moveCenter: boolean,
  ) => {
    myLocationLatLngRef.current = { lat: latitude, lng: longitude };
    const latlng = new window.kakao.maps.LatLng(latitude, longitude);
    // 메인 지도만 GPS로 센터 이동. 확장 지도는 복제된 center 유지 + 검색/저장용 focusExpandedMap만 이동.
    if (moveCenter && scope === "main") {
      map.setCenter(latlng);
      map.setLevel(9);
    }
    const existing = myLocationMarkerRef.current[scope];
    if (existing?.setPosition) {
      existing.setPosition(latlng);
    } else {
      myLocationMarkerRef.current[scope] = new window.kakao.maps.Marker({
        map,
        position: latlng,
        image: new window.kakao.maps.MarkerImage(makeMyLocationImage(), new window.kakao.maps.Size(24, 24), { offset: new window.kakao.maps.Point(12, 12) }),
      });
    }
  };

  const addMyLocation = (map: any, scope: "main" | "expanded" = "main") => {
    const token = ++locationRenderTokenRef.current[scope];
    void (async () => {
      let stage1Ok = false;
      try {
        const { latitude, longitude } = await getCurrentPositionForMapStage1();
        const currentMap = scope === "main" ? mapRef.current : expandedMapRef.current;
        if (currentMap !== map || token !== locationRenderTokenRef.current[scope]) {
          console.log("[PindMap:location] map identity changed, retry on new map", { scope });
          return;
        }
        applyMyLocationOnMap(map, scope, latitude, longitude, true);
        stage1Ok = true;
        console.log("[PindMap:location] stage1 (fast) coords", latitude, longitude, { scope });
      } catch (err) {
        console.log("[PindMap:location] stage1 failed", { scope, err });
        if (isGeolocationPermissionDenied(err)) {
          showToast("위치 권한이 필요해요. 설정에서 위치를 허용해 주세요.", "info");
          return;
        }
      }

      try {
        const { latitude, longitude } = await getCurrentPositionForMapStage2();
        const currentMap = scope === "main" ? mapRef.current : expandedMapRef.current;
        if (currentMap !== map || token !== locationRenderTokenRef.current[scope]) {
          console.log("[PindMap:location] map identity changed before stage2", { scope });
          return;
        }
        applyMyLocationOnMap(map, scope, latitude, longitude, false);
        console.log("[PindMap:location] stage2 (refined) coords", latitude, longitude, { scope });
      } catch (err) {
        console.log("[PindMap:location] stage2 failed", { scope, err });
        if (!stage1Ok) {
          const denied = isGeolocationPermissionDenied(err);
          showToast(
            denied ? "위치 권한이 필요해요. 설정에서 위치를 허용해 주세요." : "현재 위치를 가져오지 못했어요.",
            "info",
          );
        }
      }
    })();
  };

  // 카카오맵 실제 초기화 함수 (DOM이 준비된 후 호출)
  const initMap = (places: Place[], posts: FeedPost[]) => {
    if (!mapContainerRef.current || mapRef.current) return;
    const mapTypeId = window.kakao.maps.MapTypeId?.NORMAL;
    mapRef.current = new window.kakao.maps.Map(mapContainerRef.current, { center: new window.kakao.maps.LatLng(37.5665, 126.978), level: 9 });
    mapInstanceIdRef.current += 1;
    mapRef.current.setMapTypeId && mapRef.current.setMapTypeId(mapTypeId);
    geocoderRef.current = new window.kakao.maps.services.Geocoder();
    addMyLocation(mapRef.current, "main");
    setCompactMapReady(true);
  };

  const addPlacePins = (map: any, arr: any[], posts: FeedPost[], places: Place[], scope: "main" | "expanded" = "main") => {
    if (!geocoderRef.current) return;
    const useNative = isNativeMapAvailable() && expandedNativeMapEnabled && scope === "expanded";
    const myRunId = ++placePinsRunIdRef.current[scope];
    console.log("[addPlacePins]", scope, "places:", places.length, "runId:", myRunId);
    arr.forEach((m) => m.setMap(null));
    arr.length = 0;
    if (useNative) {
      clearNativeMarkerClickHandlers("place-");
      placePinByIdRef.current.clear();
    }
    const nativePlacePins: { id: string; lat: number; lng: number; category?: string }[] = [];
    if (places.length === 0) {
      console.log(`[PindMap:pin] runId ${myRunId} completed successfully`);
      return;
    }
    let cancellationLogged = false;
    let completed = 0;
    const done = () => {
      completed += 1;
      if (completed === places.length) {
        if (myRunId === placePinsRunIdRef.current[scope]) {
          console.log(`[PindMap:pin] runId ${myRunId} completed successfully`);
          if (useNative) {
            void (async () => {
              if (myRunId !== placePinsRunIdRef.current[scope]) return;
              await clearNativeMarkers("place-");
              if (myRunId !== placePinsRunIdRef.current[scope]) return;
              await addNativeMarkers(nativePlacePins);
            })();
          }
        }
      }
    };
    const runSavedPlaceMarkerClick = (place: Place, markerLat: number, markerLng: number) => {
      const clickToken = Date.now();
      console.log("[place click]", place.name, "token:", clickToken);
      selectedPlaceTokenRef.current = clickToken;
      const relatedPosts = getRelatedPostsForPlaceSheet(
        posts,
        placeRefFromPlace(place, markerLat, markerLng),
      );
      // 저장된 핀은 저장 데이터로 즉시 카드 오픈 (동명이 이슈 방지)
      console.log("[place click:setSelected1]", place.name);
      setSelectedPlace(toSelectedFromSavedPlace(place, relatedPosts, markerLat, markerLng));
      new window.kakao.maps.services.Places().keywordSearch(place.name, (data: any[], st: string) => {
        console.log("[place click:keywordSearch]", place.name, "status:", st, "data.length:", data?.length ?? 0);
        if (selectedPlaceTokenRef.current !== clickToken) {
          console.log("[place click:tokenMismatch]", "expected:", clickToken, "current:", selectedPlaceTokenRef.current);
          return;
        }
        if (st !== window.kakao.maps.services.Status.OK || !Array.isArray(data) || data.length === 0) return;
        const nearest = data
          .map((it) => {
            const y = parseFloat(it.y);
            const x = parseFloat(it.x);
            if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
            return { place: it, meters: distanceMeters(markerLat, markerLng, y, x) };
          })
          .filter((v): v is { place: any; meters: number } => Boolean(v))
          .sort((a, b) => a.meters - b.meters)[0];
        if (!nearest || nearest.meters > 100) {
          console.log("[PindMap:pin] keywordSearch fallback keep saved data", place.name, nearest?.meters);
          return;
        }
        const baseSelected = toSelectedFromSavedPlace(place, relatedPosts, markerLat, markerLng);
        const safeNearest =
          nearest.place && typeof nearest.place === "object" ? nearest.place as Record<string, unknown> : {};
        const mergedSafely: Record<string, unknown> = { ...baseSelected };
        for (const key of Object.keys(safeNearest)) {
          const v = safeNearest[key];
          if (v !== undefined && v !== null && v !== "") {
            mergedSafely[key] = v;
          }
        }
        mergedSafely._feedPosts = relatedPosts;
        mergedSafely._savedPlaceId = place.id;
        console.log("[place click:setSelected2]", place.name, "merged keys:", Object.keys(mergedSafely));
        setSelectedPlace(mergedSafely as typeof baseSelected & { _feedPosts: typeof relatedPosts; _savedPlaceId: string });
      });
    };
    const attachSavedPlaceMarkerAtLatLng = (
      place: Place,
      markerLat: number,
      markerLng: number,
      source: "cache" | "geocode" | "db",
      pinScope: "main" | "expanded",
    ) => {
      if (myRunId !== placePinsRunIdRef.current[scope]) {
        console.log("[addPlacePins:cancelled]", place.name, "myRun:", myRunId, "current:", placePinsRunIdRef.current[scope]);
        if (!cancellationLogged) {
          cancellationLogged = true;
          console.log(`[PindMap:pin] runId ${myRunId} cancelled (newer run started)`);
        }
        return;
      }
      const liveMap = pinScope === "main" ? mapRef.current : expandedMapRef.current;
      const liveArr = pinScope === "main" ? markersRef.current : expandedMarkersRef.current;
      if (!useNative) {
        if (!liveMap) {
          console.log("[addPlacePins:noLiveMap]", place.name, "scope:", pinScope);
          done();
          return;
        }
      }
      if (myRunId !== placePinsRunIdRef.current[scope]) {
        console.log("[addPlacePins:cancelled]", place.name, "myRun:", myRunId, "current:", placePinsRunIdRef.current[scope]);
        if (!cancellationLogged) {
          cancellationLogged = true;
          console.log(`[PindMap:pin] runId ${myRunId} cancelled (newer run started)`);
        }
        return;
      }
      if (useNative) {
        const markerId = `place-${place.id}`;
        if (source === "cache") {
          console.log("[addPlacePins:marker]", place.name, "lat:", markerLat, "lng:", markerLng, "(cached coords)");
        } else if (source === "db") {
          console.log("[addPlacePins:marker]", place.name, "lat:", markerLat, "lng:", markerLng, "(stored coords)");
        } else {
          console.log("[addPlacePins:marker]", place.name, "lat:", markerLat, "lng:", markerLng);
        }
        savedPlaceCoordsRef.current[place.id] = { lat: markerLat, lng: markerLng };
        placePinByIdRef.current.set(markerId, place);
        nativePlacePins.push({
          id: markerId,
          lat: markerLat,
          lng: markerLng,
          category: place.category,
        });
        setNativeMarkerClickHandler(markerId, () => {
          const savedPlace = placePinByIdRef.current.get(markerId);
          if (savedPlace) runSavedPlaceMarkerClick(savedPlace, markerLat, markerLng);
        });
        done();
        return;
      }
      let marker: any;
      try {
        marker = new window.kakao.maps.Marker({
          position: new window.kakao.maps.LatLng(markerLat, markerLng),
          image: new window.kakao.maps.MarkerImage(makeMarkerImage(place.category), new window.kakao.maps.Size(36, 44)),
        });
        marker.setMap(liveMap);
        if (source === "cache") {
          console.log("[addPlacePins:marker]", place.name, "lat:", markerLat, "lng:", markerLng, "(cached coords)");
        } else if (source === "db") {
          console.log("[addPlacePins:marker]", place.name, "lat:", markerLat, "lng:", markerLng, "(stored coords)");
        } else {
          console.log("[addPlacePins:marker]", place.name, "lat:", markerLat, "lng:", markerLng);
        }
        savedPlaceCoordsRef.current[place.id] = { lat: markerLat, lng: markerLng };
        window.kakao.maps.event.addListener(marker, "click", () => {
          runSavedPlaceMarkerClick(place, markerLat, markerLng);
        });
        liveArr.push(marker);
        done();
      } catch (err) {
        console.error("[PindMap:pin] addPlacePins marker setup failed", place?.name, err);
        if (marker) {
          try {
            marker.setMap(null);
          } catch {
            /* noop */
          }
        }
        done();
      }
    };
    places.forEach((place) => {
      console.log("[addPlacePins:start]", place.name, "address:", place.address);
      const stored = latLngFromRow(place);
      if (stored) {
        attachSavedPlaceMarkerAtLatLng(place, stored.lat, stored.lng, "db", scope);
        return;
      }
      const cached = savedPlaceCoordsRef.current[place.id];
      if (
        cached &&
        typeof cached.lat === "number" &&
        typeof cached.lng === "number" &&
        Number.isFinite(cached.lat) &&
        Number.isFinite(cached.lng)
      ) {
        attachSavedPlaceMarkerAtLatLng(place, cached.lat, cached.lng, "cache", scope);
        return;
      }
      geocoderRef.current.addressSearch(place.address, (result: any[], sv: string) => {
        try {
          console.log("[addPlacePins:geocode]", place.name, "ok:", sv === window.kakao.maps.services.Status.OK);
          if (myRunId !== placePinsRunIdRef.current[scope]) {
            console.log("[addPlacePins:cancelled]", place.name, "myRun:", myRunId, "current:", placePinsRunIdRef.current[scope]);
            if (!cancellationLogged) {
              cancellationLogged = true;
              console.log(`[PindMap:pin] runId ${myRunId} cancelled (newer run started)`);
            }
            return;
          }
          if (sv !== window.kakao.maps.services.Status.OK || !result[0]) {
            done();
            return;
          }
          const markerLat = parseFloat(result[0].y);
          const markerLng = parseFloat(result[0].x);
          attachSavedPlaceMarkerAtLatLng(place, markerLat, markerLng, "geocode", scope);
        } catch (err) {
          console.error("[PindMap:pin] addPlacePins marker setup failed", place?.name, err);
          done();
        }
      });
    });
  };

  /** M-1 최후 안전망: 메인 지도에 보일 장소가 있는데 마커가 없을 때 한 번 더 addPlacePins */
  const runMainPinFallbackOnce = (source: string) => {
    if (activeTabRef.current !== "map") {
      console.log("[PindMap:pin] mainPinFallback skipped — inactive tab (%s)", source);
      return;
    }
    const mapNow = mapRef.current;
    if (!mapNow || !geocoderRef.current) {
      console.log("[PindMap:pin] mainPinFallback skipped — no map/geocoder (%s)", source);
      return;
    }
    const places = savedPlacesRef.current;
    const hidden = hiddenIdsRef.current;
    const visibleCount = places.filter((p) => !hidden.has(p.id)).length;
    if (visibleCount === 0) {
      console.log("[PindMap:pin] mainPinFallback skipped — no visible places (%s)", source);
      return;
    }
    if (markersRef.current.length > 0) {
      console.log("[PindMap:pin] mainPinFallback skipped — markers already present (%s, n=%d)", source, markersRef.current.length);
      return;
    }
    console.log("[PindMap:pin] mainPinFallback running addPlacePins (%s)", source);
    mapNow.relayout?.();
    addPlacePins(mapNow, markersRef.current, feedPostsRef.current, places, "main");

    clearMainPinFallbackVerify();
    let ticks = 0;
    mainPinFallbackVerifyIntervalRef.current = window.setInterval(() => {
      ticks += 1;
      if (markersRef.current.length > 0) {
        console.log("[PindMap:pin] mainPinFallback verify ok (markers=%d, ticks=%d)", markersRef.current.length, ticks);
        clearMainPinFallbackVerify();
        return;
      }
      if (ticks >= 40) {
        console.log("[PindMap:pin] mainPinFallback verify gave up after ~6s (%s)", source);
        clearMainPinFallbackVerify();
      }
    }, 150);
  };

  const scheduleMainPinOrchestratorFallback = (reason: string, cycleId: number) => {
    clearMainPinFallbackTimer();
    console.log("[PindMap:pin] mainPinFallback scheduled in 5000ms (%s, cycle %d)", reason, cycleId);
    mainPinFallbackTimerRef.current = window.setTimeout(() => {
      mainPinFallbackTimerRef.current = null;
      runMainPinFallbackOnce(`delayed-after-failure: ${reason} cycle=${cycleId}`);
    }, 1000);
  };

  const addFeedPins = (map: any, arr: any[], posts: FeedPost[]) => {
    if (!geocoderRef.current) return;
    arr.forEach((m) => m.setMap(null)); arr.length = 0;
    const placeFeedPin = (rep: FeedPost, lat: number, lng: number) => {
      const marker = new window.kakao.maps.Marker({
        map,
        position: new window.kakao.maps.LatLng(lat, lng),
        image: new window.kakao.maps.MarkerImage(makeMarkerImage(rep.category), new window.kakao.maps.Size(36, 44)),
      });
      const groupPosts = getRelatedPostsForPlaceSheet(posts, {
        placeName: rep.placeName,
        lat,
        lng,
        address: rep.address,
        placeId: null,
      });
      window.kakao.maps.event.addListener(marker, "click", () => {
        const feedPinRef = {
          placeName: rep.placeName,
          lat,
          lng,
          address: rep.address,
          placeId: null,
        };
        setSelectedPlace({
          place_name: rep.placeName,
          category_name: rep.category,
          road_address_name: rep.address,
          phone: "",
          place_url: "",
          y: String(lat),
          x: String(lng),
          _feedPosts: groupPosts,
          _placeRef: feedPinRef,
        });
      });
      arr.push(marker);
    };
    const byAddress = new Map<string, FeedPost[]>();
    posts.filter((p) => !p.archived && p.address).forEach((p) => {
      if (!byAddress.has(p.address)) byAddress.set(p.address, []);
      byAddress.get(p.address)!.push(p);
    });
    byAddress.forEach((groupPosts, address) => {
      const rep = groupPosts[0];
      const stored = latLngFromRow(rep);
      if (stored) {
        placeFeedPin(rep, stored.lat, stored.lng);
        return;
      }
      geocoderRef.current.addressSearch(address, (result: any[], sv: string) => {
        if (sv !== window.kakao.maps.services.Status.OK || !result[0]) return;
        const lat = parseFloat(result[0].y);
        const lng = parseFloat(result[0].x);
        placeFeedPin(rep, lat, lng);
      });
    });
  };

  const clearRoute = () => {
    if (routePolylineRef.current) { routePolylineRef.current.setMap(null); routePolylineRef.current = null; }
    setDirectionsInfo(null);
  };

  const drawRoute = async (destLat: number, destLng: number, mode: "car" | "walk" = "car") => {
    if (!expandedMapRef.current || !window.kakao?.maps) return;
    setDirectionsLoading(true);
    clearRoute();
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const res = await fetch("/api/directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin: { lat: pos.coords.latitude, lng: pos.coords.longitude }, destination: { lat: destLat, lng: destLng }, mode }),
        });
        const data = await res.json();
        if (!data.routes?.[0]) { showToast("경로를 찾을 수 없어요", "error"); setDirectionsLoading(false); return; }
        const route = data.routes[0];
        const summary = route.summary;
        setDirectionsInfo({ duration: Math.round(summary.duration / 60), distance: Math.round(summary.distance / 1000 * 10) / 10 });
        const linePath: any[] = [];
        route.sections.forEach((section: any) => {
          section.roads.forEach((road: any) => {
            for (let i = 0; i < road.vertexes.length; i += 2) {
              linePath.push(new window.kakao.maps.LatLng(road.vertexes[i + 1], road.vertexes[i]));
            }
          });
        });
        const strokeColor = mode === "walk" ? "#16a34a" : "#1a2a7a";
        const strokeWeight = mode === "walk" ? 7 : 5;
        const strokeStyle = mode === "walk" ? "shortdash" : "solid";
        routePolylineRef.current = new window.kakao.maps.Polyline({ path: linePath, strokeWeight, strokeColor, strokeOpacity: 0.95, strokeStyle });
        routePolylineRef.current.setMap(expandedMapRef.current);
        const bounds = new window.kakao.maps.LatLngBounds();
        linePath.forEach(p => bounds.extend(p));
        expandedMapRef.current.setBounds(bounds);
      } catch { showToast("길찾기에 실패했어요", "error"); }
      finally { setDirectionsLoading(false); }
    }, () => { showToast("현재 위치를 가져올 수 없어요", "error"); setDirectionsLoading(false); });
  };

  const openTransitInKakaoMap = (destName: string, destLat: number, destLng: number) => {
    // 카카오맵 앱 딥링크: 출발지=현재위치, 도착지=장소
    navigator.geolocation.getCurrentPosition((pos) => {
      const url = `https://map.kakao.com/?sName=현재위치&sX=${pos.coords.longitude}&sY=${pos.coords.latitude}&eName=${encodeURIComponent(destName)}&eX=${destLng}&eY=${destLat}`;
      window.open(url, "_blank");
    }, () => {
      // 위치 권한 없으면 도착지만으로
      const url = `https://map.kakao.com/?eName=${encodeURIComponent(destName)}&eX=${destLng}&eY=${destLat}`;
      window.open(url, "_blank");
    });
  };

  /** 전체 지도(확장) 검색 핀 카드 공통 처리 — places 저장만 허용, feed에는 넣지 않음 */
  const openExpandedSearchPlaceCard = useCallback((place: any, source: string) => {
    const key = `${String(place.place_name ?? "")}:${place.y}:${place.x}`;
    const now = Date.now();
    if (expandedSearchOpenDedupeRef.current.key === key && now - expandedSearchOpenDedupeRef.current.t < 450) {
      console.log("[PindMap:expandedMap] dedupe skip same place", source, key);
      return;
    }
    expandedSearchOpenDedupeRef.current = { t: now, key };
    console.log("[PindMap:expandedMap] open place card", source, place.place_name, { y: place.y, x: place.x });
    const expandedRef = placeRefFromKakaoPlace(place);
    setSelectedPlace({
      ...place,
      _feedPosts: getRelatedPostsForPlaceSheet(feedPostsRef.current, expandedRef),
      _placeRef: expandedRef,
    });
  }, []);

  const handleFullscreenNativePlaceDetail = useCallback(async (markerId: string) => {
    // Pin tap no longer opens React PlaceDetailSheet — native bottom sheet handles place UI.
    // Kept for potential future "상세 보기" entry points.
    void markerId;
  }, []);

  useEffect(() => {
    if (!isNativeMapAvailable()) return;
    if (fullscreenPlaceDetailListenerRegisteredRef.current) return;
    fullscreenPlaceDetailListenerRegisteredRef.current = true;
    void PindmapNativeMap.addListener("fullscreenPlaceDetail", (e) => {
      void handleFullscreenNativePlaceDetail(e.id);
    }).catch((err) => {
      fullscreenPlaceDetailListenerRegisteredRef.current = false;
      console.error("[fullscreen] fullscreenPlaceDetail listener failed", err);
    });
  }, [handleFullscreenNativePlaceDetail]);

  /** 확장 지도 검색 — 지도 center 기준 (GPS 아님) */
  const getExpandedMapSearchCenter = useCallback(() => {
    const mapNow = expandedMapRef.current;
    const center = mapNow?.getCenter?.();
    if (center) return center;
    return new window.kakao.maps.LatLng(37.5665, 126.978);
  }, []);

  const runExpandedMapSearch = useCallback(
    (keyword: string) => {
      const trimmed = keyword.trim();
      console.log("[PindMap:search] search invoked", { query: trimmed });
      if (!trimmed) {
        console.log("[PindMap:search] search blocked - reason: empty_query");
        return;
      }
      if (!expandedMapRef.current) {
        console.log("[PindMap:search] search blocked - reason: expanded_map_not_ready");
        return;
      }
      if (!window.kakao?.maps) {
        console.log("[PindMap:search] search blocked - reason: kakao_not_ready");
        return;
      }

      mapSearchKeywordRef.current = trimmed;
      setShowMapResearchButton(false);
      pendingSearchCenterSyncRef.current = true;

      const searchCenter = getExpandedMapSearchCenter();
      const searchCenterLat = searchCenter.getLat();
      const searchCenterLng = searchCenter.getLng();
      lastSearchCenterRef.current = { lat: searchCenterLat, lng: searchCenterLng };

      const ps = new window.kakao.maps.services.Places();
      const geocoder = new window.kakao.maps.services.Geocoder();

      const fitExpandedMapToKeywordResults = (places: any[]) => {
        const mapNow = expandedMapRef.current;
        if (!mapNow || places.length === 0) return;
        const valid = places.filter((p) => {
          const y = parseFloat(p.y);
          const x = parseFloat(p.x);
          return Number.isFinite(y) && Number.isFinite(x);
        });
        if (valid.length === 0) return;
        const sorted = [...valid].sort(
          (a, b) =>
            distanceMeters(searchCenterLat, searchCenterLng, parseFloat(a.y), parseFloat(a.x)) -
            distanceMeters(searchCenterLat, searchCenterLng, parseFloat(b.y), parseFloat(b.x)),
        );
        const fitPlaces = sorted.slice(0, 3);
        if (fitPlaces.length === 1) {
          const p = fitPlaces[0];
          mapNow.setCenter(new window.kakao.maps.LatLng(parseFloat(p.y), parseFloat(p.x)));
          mapNow.setLevel(3);
          return;
        }
        const bounds = new window.kakao.maps.LatLngBounds();
        fitPlaces.forEach((p) => bounds.extend(new window.kakao.maps.LatLng(parseFloat(p.y), parseFloat(p.x))));
        mapNow.setBounds(bounds);
      };

      const applyKeywordSearchResults = (data: any[], st: string) => {
        if (st !== window.kakao.maps.services.Status.OK) {
          showToast("검색 결과가 없어요", "info");
          pendingSearchCenterSyncRef.current = false;
          return;
        }
        console.log("[PindMap:expandedMap] keywordSearch ok count=", data?.length ?? 0);
        clearSearchResultPins();
        addSearchResultPins(data, (place) => openExpandedSearchPlaceCard(place, "marker-keyword-click"));
        setMapSearchResults(data);
        setMapSearchLabel(trimmed);
        setIsMapSearchSheetOpen(true);
        fitExpandedMapToKeywordResults(data);
        setSearchQuery("");
      };

      const runKeywordSearchAtMapCenter = () => {
        const bias = getExpandedMapSearchCenter();
        const SortBy = window.kakao.maps.services.SortBy;
        const keywordOpts: Record<string, unknown> = { location: bias };
        if (SortBy?.DISTANCE != null) {
          keywordOpts.sort = SortBy.DISTANCE;
        }
        ps.keywordSearch(trimmed, applyKeywordSearchResults, keywordOpts);
      };

      geocoder.addressSearch(trimmed, (result: any[], st: string) => {
        if (st === window.kakao.maps.services.Status.OK && result[0]) {
          const addr = result[0];
          clearSearchResultPins();
          const placeObj = {
            id: `addr-${addr.x}-${addr.y}`,
            place_name: trimmed || addr.place_name || addr.address_name || "위치",
            category_name: "장소",
            road_address_name: addr.road_address?.address_name ?? addr.address?.address_name ?? addr.address_name ?? "",
            phone: "",
            place_url: "",
            y: addr.y,
            x: addr.x,
          };
          const addrLat = parseFloat(addr.y);
          const addrLng = parseFloat(addr.x);
          if (Number.isFinite(addrLat) && Number.isFinite(addrLng)) {
            lastSearchCenterRef.current = { lat: addrLat, lng: addrLng };
          }
          console.log("[PindMap:expandedMap] addressSearch marker", placeObj.place_name);
          addSearchResultPins([placeObj], (place) => openExpandedSearchPlaceCard(place, "marker-address-click"));
          setMapSearchResults([placeObj]);
          setMapSearchLabel(trimmed);
          setIsMapSearchSheetOpen(true);
          expandedMapRef.current.setCenter(new window.kakao.maps.LatLng(addr.y, addr.x));
          expandedMapRef.current.setLevel(3);
          pendingSearchCenterSyncRef.current = true;
          setSearchQuery("");
        } else {
          console.log("[PindMap:expandedMap] addressSearch fallback to keyword:", trimmed);
          runKeywordSearchAtMapCenter();
        }
      });
    },
    [
      addSearchResultPins,
      clearSearchResultPins,
      getExpandedMapSearchCenter,
      openExpandedSearchPlaceCard,
      showToast,
    ],
  );

  const handleSearch = () => {
    runExpandedMapSearch(searchQuery);
  };

  const handleResearchThisArea = useCallback(() => {
    const keyword = mapSearchKeywordRef.current.trim();
    if (!keyword) return;
    runExpandedMapSearch(keyword);
  }, [runExpandedMapSearch]);

  // 카카오 스크립트 최초 로드 (DOM 준비와 무관하게 스크립트만 로드)
  useEffect(() => {
    if (!mapKey) {
      setIsKakaoMapLoaded(false);
      setKakaoStatus("error");
      return;
    }
    const notifySdkReady = () => {
      console.log("[PindMap:kakao] maps.load ready", {
        hasLatLng: isKakaoMapsApiReady(),
        origin: typeof window !== "undefined" ? window.location.origin : "ssr",
      });
      setIsKakaoMapLoaded(true);
      setKakaoStatus("ready");
    };
    if (window.kakao?.maps) {
      beginKakaoMapsLoad(notifySdkReady);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>("script[data-pindmap-kakao]");
    if (existing) {
      const done = () => {
        if (!window.kakao?.maps) {
          setIsKakaoMapLoaded(false);
          setKakaoStatus("error");
          return;
        }
        beginKakaoMapsLoad(notifySdkReady);
      };
      if (window.kakao?.maps || existing.getAttribute("data-loaded") === "1") {
        done();
        return;
      }
      setKakaoStatus("loading");
      existing.addEventListener("load", done, { once: true });
      return;
    }
    setKakaoStatus("loading");
    const script = document.createElement("script");
    script.setAttribute("data-pindmap-kakao", "1");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${mapKey}&autoload=false&libraries=services`;
    script.async = true;
    console.log("[PindMap:kakao] injecting sdk.js", {
      origin: window.location.origin,
      hasKey: Boolean(mapKey),
    });
    const failTimer = window.setTimeout(() => {
      if (!isKakaoMapsApiReady()) {
        console.error("[PindMap:kakao] sdk load timeout (25s)", {
          hasKakao: Boolean(window.kakao),
          hasMaps: Boolean(window.kakao?.maps),
          hasLatLng: isKakaoMapsApiReady(),
        });
        setIsKakaoMapLoaded(false);
        setKakaoStatus("error");
      }
    }, 25000);
    script.onload = () => {
      window.clearTimeout(failTimer);
      script.setAttribute("data-loaded", "1");
      console.log("[PindMap:kakao] script onload", {
        hasMaps: Boolean(window.kakao?.maps),
        hasLatLng: isKakaoMapsApiReady(),
      });
      if (!window.kakao?.maps) {
        setIsKakaoMapLoaded(false);
        setKakaoStatus("error");
        return;
      }
      beginKakaoMapsLoad(notifySdkReady);
    };
    script.onerror = (event) => {
      window.clearTimeout(failTimer);
      console.error("[PindMap:kakao] script onerror", event);
      setIsKakaoMapLoaded(false);
      setKakaoStatus("error");
    };
    document.head.appendChild(script);
    return () => {
      window.clearTimeout(failTimer);
    };
  }, [mapKey]);

  // 확장 지도 닫히면 메인 지도 참조 무효화 → 아래 초기화 effect가 initMap 재호출
  useEffect(() => {
    if (mapExpanded) return;
    if (!mapRef.current) return;
    mapRef.current = null;
    mapInstanceIdRef.current += 1;
    myLocationMarkerRef.current.main = null;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    setCompactMapReady(false);
    initialPinTriggeredRef.current = false;
    prevSavedPlacesKeyRef.current = "";
    relayoutTriggeredRef.current = false;
    orchestratorSuccessKeyRef.current = "";
  }, [mapExpanded]);

  // SDK 준비 + 지도 탭일 때: 컨테이너 높이 0 등으로 initMap 스킵되던 문제를 재시도로 해소
  useEffect(() => {
    if (kakaoStatus !== "ready" || activeTab !== "map") return;
    if (mapRef.current) return;

    let cancelled = false;
    const timeouts: number[] = [];
    let attempt = 0;
    const maxAttempts = 50;

    const tryInit = () => {
      if (cancelled || mapRef.current) return;
      const container = mapContainerRef.current;
      if (!container) {
        if (attempt < maxAttempts) {
          attempt += 1;
          const t = window.setTimeout(tryInit, 100);
          timeouts.push(t);
        }
        return;
      }
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        initMap(savedPlaces, feedPosts);
        return;
      }
      if (attempt < maxAttempts) {
        attempt += 1;
        const t = window.setTimeout(tryInit, 100);
        timeouts.push(t);
      } else {
        initMap(savedPlaces, feedPosts);
      }
    };

    const tStart = window.setTimeout(tryInit, 0);
    timeouts.push(tStart);

    return () => {
      cancelled = true;
      timeouts.forEach((tid) => window.clearTimeout(tid));
    };
  }, [kakaoStatus, activeTab, savedPlaces, feedPosts, mapExpanded]);

  // 탭 전환 시 지도 relayout
  useEffect(() => {
    if (activeTab !== "map" || !mapRef.current || kakaoStatus !== "ready") return;
    const relayoutTimers = [100, 300, 600].map((delay) => setTimeout(() => {
      const map = mapRef.current;
      if (!map || !isKakaoMapsApiReady()) return;
      map.relayout();
      const container = mapContainerRef.current;
      const parent = container?.parentElement;
      if (parent && (parent.clientWidth === 0 || parent.clientHeight === 0)) {
        const center = map.getCenter?.() ?? new window.kakao.maps.LatLng(37.5665, 126.978);
        map.setCenter(center);
      }
    }, delay));
    return () => relayoutTimers.forEach(clearTimeout);
  }, [activeTab, kakaoStatus]);

  useEffect(() => {
    if (activeTab !== "map") return;
    if (!compactMapReady || !mapRef.current) return;
    if (relayoutTriggeredRef.current) return;
    relayoutTriggeredRef.current = true;
    console.log("[PindMap:pin] relayout trigger (initial)");

    const runRelayoutAndRepaint = () => {
      const map = mapRef.current;
      if (!map) return;
      map.relayout?.();
      console.log("[PindMap:pin] relayout completed");
    };

    const timers = [200, 500].map((delay) => window.setTimeout(runRelayoutAndRepaint, delay));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [activeTab, compactMapReady, savedPlaces]);

  // URL에 ?openChatRoom=xxx 있으면 자동으로 그 채팅방 열기
  useEffect(() => {
    const roomIdFromUrl = searchParams?.get("openChatRoom");
    if (!roomIdFromUrl || !user) return;

    const handleOpen = async () => {
      // 1. 일단 메시지 탭으로 이동
      setActiveTab("messages");

      // 2. chatRooms에서 먼저 찾아보기
      let targetRoom = chatRooms.find(r => r.id === roomIdFromUrl);

      // 3. 없으면 DB에서 직접 가져오기 (chatRooms 로딩 타이밍 회피)
      if (!targetRoom) {
        const { data } = await supabase.from("chat_rooms").select("*").eq("id", roomIdFromUrl).maybeSingle();
        if (data) {
          const friendId = data.user1_id === user.id ? data.user2_id : data.user1_id;
          // 친구 username 가져오기
          const { data: friendData } = await supabase.from("users").select("username, avatar_url").eq("id", friendId).maybeSingle();
          if (friendData) {
            userAvatarCacheRef.current.setFromRow({ id: friendId, username: friendData.username, avatar_url: friendData.avatar_url });
          }
          targetRoom = {
            id: data.id,
            friendId,
            friendName: friendData?.username ?? friendId,
            friendAvatarUrl: normalizeAvatarUrl(friendData?.avatar_url),
            lastMessage: "",
            lastTime: data.created_at,
            unreadCount: 0,
          };
          // chatRooms에도 추가해두기
          setChatRooms((prev) =>
            sortChatRoomsByRecency(
              prev.some((r) => r.id === targetRoom!.id) ? prev : [targetRoom!, ...prev],
            ),
          );
        }
      }

      if (targetRoom) {
        await openChat(targetRoom);
        // URL에서 쿼리 파라미터 제거 (새로고침 시 중복 동작 방지)
        window.history.replaceState({}, "", "/");
      }
    };

    void handleOpen();
  }, [searchParams, user]);

  useEffect(() => {
    if (searchParams?.get("tab") === "mypage") {
      setActiveTab("mypage");
      window.history.replaceState({}, "", "/");
    }
    if (searchParams?.get("tab") === "messages") {
      setActiveTab("messages");
      window.history.replaceState({}, "", "/");
    }
    if (searchParams?.get("tab") === "home" && !searchParams?.get("postId")) {
      setActiveTab("home");
      if (searchParams.get("openHomeSearch") === "1") {
        setIsHomeSearchOpen(true);
      }
      window.history.replaceState({}, "", "/");
    }
  }, [searchParams]);

  useLayoutEffect(() => {
    if (searchParams?.get("postId")) {
      window.history.replaceState({}, "", "/");
    }
  }, [searchParams]);

  useEffect(() => {
    const postId = searchParams?.get("postId");
    if (!postId) return;
    setDetailPostId((prev) => (prev === postId ? prev : postId));
    setDetailReturnTo(parseDetailReturnTo(searchParams));
    if (searchParams.get("from") === "mypage") {
      setActiveTab("mypage");
    }
    if (searchParams.get("tab") === "home") {
      setActiveTab("home");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!detailPostId || feedPosts.some((p) => p.id === detailPostId)) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("feed_posts")
        .select("*, comments(*)")
        .eq("id", detailPostId)
        .maybeSingle();
      if (cancelled || !data) return;
      const coords = latLngFromRow(data);
      const likedByMe = user?.id ? await fetchIsPostLikedByUser(detailPostId, user.id) : false;
      if (cancelled) return;
      const raw: FeedPost = {
        id: data.id,
        user: data.user_name,
        userId: data.user_id ?? "",
        title: data.title,
        placeName: data.place_name,
        address: data.address,
        ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        category: data.category as Category,
        comment: data.comment,
        images: data.images ?? [],
        createdAt: data.created_at,
        archived: data.archived,
        likes_count: data.likes_count ?? 0,
        liked_by_me: likedByMe,
        comments: (data.comments ?? []).map((c: { id: string; user_name: string; user_id?: string; text: string; created_at: string }) => ({
          id: c.id,
          user: c.user_name,
          userId: c.user_id ?? undefined,
          text: c.text,
          createdAt: c.created_at,
        })),
      };
      await prefetchAvatarsForFeedPosts([raw]);
      if (cancelled) return;
      const [hydrated] = hydrateFeedPostsWithAvatars([raw]);
      setFeedPosts((prev) => (prev.some((p) => p.id === hydrated.id) ? prev : [hydrated, ...prev]));
    })();
    return () => {
      cancelled = true;
    };
  }, [detailPostId, feedPosts, prefetchAvatarsForFeedPosts, hydrateFeedPostsWithAvatars]);

  // 메시지 탭 진입 시 안 읽은 개수 갱신
  useEffect(() => {
    if (activeTab !== "messages" || activeChatRoom) return;
    const refreshRooms = async () => {
      const { data: roomsData } = await supabase.from("chat_rooms").select("*").or(`user1_id.eq.${MY_USER},user2_id.eq.${MY_USER}`);
      if (!roomsData) return;
      const rooms: ChatRoom[] = await Promise.all(roomsData.map(async (r: any) => {
        const friendId = r.user1_id === MY_USER ? r.user2_id : r.user1_id;
        const { data: friendData } = await supabase.from("users").select("username, avatar_url").eq("id", friendId).maybeSingle();
        if (friendData) {
          userAvatarCacheRef.current.setFromRow({ id: friendId, username: friendData.username, avatar_url: friendData.avatar_url });
        }
        const { data: msgs } = await supabase.from("messages").select("*").eq("room_id", r.id).order("created_at", { ascending: false }).limit(1);
        const { count: unread } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("room_id", r.id).neq("sender_id", MY_USER).eq("read", false);
        return {
          id: r.id,
          friendId,
          friendName: friendData?.username || friendId,
          friendAvatarUrl: normalizeAvatarUrl(friendData?.avatar_url),
          lastMessage: msgs?.[0]?.text ?? "",
          lastTime: msgs?.[0]?.created_at ?? r.created_at,
          unreadCount: unread ?? 0,
        };
      }));
      setChatRooms(sortChatRoomsByRecency(rooms));
    };
    refreshRooms();
  }, [activeTab, activeChatRoom]);

  useEffect(() => {
    if (!user?.id) {
      unmountNotificationsSubscription();
      return;
    }
    mountNotificationsSubscription(user.id);
    return () => {
      unmountNotificationsSubscription();
    };
  }, [user?.id, mountNotificationsSubscription, unmountNotificationsSubscription]);

  // 전역 메시지 구독 — mountGlobalMessagesSubscription 단일 경로 (포그라운드 재구독과 공유)
  useEffect(() => {
    if (!MY_USER) {
      unmountGlobalMessagesSubscription();
      return;
    }
    mountGlobalMessagesSubscription();
    return () => {
      unmountGlobalMessagesSubscription();
    };
  }, [MY_USER, mountGlobalMessagesSubscription]);

  useEffect(() => {
    return () => {
      resetRealtimeRemountCounters();
    };
  }, [resetRealtimeRemountCounters]);

  /** 백그라운드 복귀 시 Realtime 재구독 (짧은 전환은 스킵) */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        lastVisibilityHiddenAtRef.current = Date.now();
        return;
      }
      resetRealtimeRemountCounters();
      const hiddenAt = lastVisibilityHiddenAtRef.current;
      if (hiddenAt !== null) {
        const bgMs = Date.now() - hiddenAt;
        lastVisibilityHiddenAtRef.current = null;
        if (bgMs < 5000) return;
      }
      if (realtimeResubTimerRef.current !== null) {
        window.clearTimeout(realtimeResubTimerRef.current);
      }
      realtimeResubTimerRef.current = window.setTimeout(() => {
        realtimeResubTimerRef.current = null;
        const rid = activeChatRoomIdRef.current;
        if (rid) {
          mountRoomSubscription(rid);
        }
        if (MY_USER) {
          mountGlobalMessagesSubscription();
        }
      }, 1000);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (realtimeResubTimerRef.current !== null) {
        window.clearTimeout(realtimeResubTimerRef.current);
        realtimeResubTimerRef.current = null;
      }
    };
  }, [MY_USER, mountRoomSubscription, mountGlobalMessagesSubscription, resetRealtimeRemountCounters]);

  useEffect(() => {
    chatStickToBottomRef.current = true;
  }, [activeChatRoom?.id]);

  useEffect(() => {
    if (!activeChatRoom || chatRoomLoading) return;
    dlog.perf.markRender(`chat:${activeChatRoom.id}`);
  }, [activeChatRoom?.id, chatRoomLoading, messages.length]);

  useEffect(() => {
    if (activeTab === "messages") return;
    unmountRoomSubscription("leave-messages-tab");
  }, [activeTab, unmountRoomSubscription]);

  useEffect(() => {
    if (activeChatRoom) return;
    unmountRoomSubscription("chatroom-closed");
  }, [activeChatRoom, unmountRoomSubscription]);

  useEffect(() => {
    return () => {
      unmountRoomSubscription("component-unmount");
    };
  }, [unmountRoomSubscription]);

  useLayoutEffect(() => {
    if (!activeChatRoom || !chatStickToBottomRef.current) return;
    const el = chatMessagesContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, activeChatRoom?.id]);

  useEffect(() => {
    if (activeTab !== "messages" || !activeChatRoom) {
      prevKeyboardVisibleForChatRef.current = false;
      return;
    }
    const wasVisible = prevKeyboardVisibleForChatRef.current;
    if (wasVisible && !keyboardVisible) {
      if (Date.now() - lastKbResetAtRef.current > 500) {
        lastKbResetAtRef.current = Date.now();
        resetWindowScrollAfterChatKeyboard();
      }
    }
    prevKeyboardVisibleForChatRef.current = keyboardVisible;
  }, [activeTab, activeChatRoom?.id, keyboardVisible, resetWindowScrollAfterChatKeyboard]);

  useEffect(() => {
    if (activeTab !== "messages" || !activeChatRoom) return;
    if (!chatStickToBottomRef.current) return;
    if (keyboardHeight <= 0 && !keyboardWillShow) return;

    const scrollToBottom = () => {
      const el = chatMessagesContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };

    scrollToBottom();
    const raf = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(raf);
  }, [activeTab, activeChatRoom?.id, keyboardHeight, keyboardWillShow]);

  useEffect(() => {
    if (activeTab !== "messages" || activeChatRoom) {
      clearMessageUserSearch();
    }
  }, [activeTab, activeChatRoom?.id, clearMessageUserSearch]);

  useEffect(() => {
    const q = messageUserSearchQuery.trim();
    if (!q || activeTab !== "messages" || activeChatRoom || !user?.id) {
      setMessageUserSearchResults([]);
      setMessageUserSearchLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setMessageUserSearchLoading(true);
        const { data, error } = await searchUsersByUsername(q, user.id, followingIds);
        if (cancelled) return;
        if (error) showToast(error, "error");
        for (const hit of data) {
          userAvatarCacheRef.current.setFromRow({
            id: hit.id,
            username: hit.username,
            avatar_url: hit.avatar_url,
          });
        }
        setMessageUserSearchResults(data);
        setMessageUserSearchLoading(false);
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [messageUserSearchQuery, activeTab, activeChatRoom, user?.id, showToast]);

  useEffect(() => {
    setMessageUserSearchResults((prev) =>
      prev.length === 0
        ? prev
        : prev.map((h) => ({ ...h, isFollowing: followingIds.includes(h.id) })),
    );
  }, [followingIds]);

  useEffect(() => {
    if (
      prevActiveTabRef.current === "messages" &&
      activeTab !== "messages" &&
      activeChatRoomRef.current
    ) {
      resetWindowScrollAfterChatKeyboard();
    }
    prevActiveTabRef.current = activeTab;
  }, [activeTab, resetWindowScrollAfterChatKeyboard]);

  useEffect(() => {
    const hasMap = !!mapRef.current;
    console.log("[PindMap:pin] orchestrator triggered");
    console.log("[PindMap:pin] orchestrator conditions: kakao=%s, map=%s, ready=%s, places=%d", kakaoStatus, hasMap, compactMapReady, savedPlaces.length);
    if (activeTab !== "map") {
      console.log("[PindMap:pin] orchestrator skipped - reason: inactive_tab");
      return;
    }
    if (kakaoStatus !== "ready") {
      console.log("[PindMap:pin] orchestrator skipped - reason: kakao_not_ready");
      return;
    }
    const map = mapRef.current;
    if (!map) {
      console.log("[PindMap:pin] orchestrator skipped - reason: map_missing");
      return;
    }
    if (!compactMapReady) {
      console.log("[PindMap:pin] orchestrator skipped - reason: compact_map_not_ready");
      return;
    }

    const savedPlacesKey = savedPlaces.map((p) => `${p.id}:${p.name}:${p.address}`).join("|");
    const cycleKey = `${mapInstanceIdRef.current}::${savedPlacesKey}`;
    if (orchestratorSuccessKeyRef.current === cycleKey) {
      console.log("[PindMap:pin] orchestrator cycle skipped - same key");
      return;
    }

    initialPinTriggeredRef.current = true;
    prevSavedPlacesKeyRef.current = savedPlacesKey;
    const cycleId = ++orchestratorCycleRef.current;
    console.log("[PindMap:pin] orchestrator cycle %d started", cycleId);

    let cancelled = false;
    let pendingTimer: number | null = null;
    let pendingRaf: number | null = null;
    let pollIntervalId: number | null = null;

    const MARKER_POLL_INTERVAL_MS = 80;
    const MARKER_POLL_MAX_MS = 950;

    const clearMarkerPoll = () => {
      if (pollIntervalId !== null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    };

    const visiblePlacesCount = savedPlaces.filter((p) => !hiddenIds.has(p.id)).length;
    const runAttempt = (attempt: 1 | 2 | 3) => {
      if (cancelled) return;
      clearMarkerPoll();
      console.log("[PindMap:pin] orchestrator cycle %d attempt %d/3", cycleId, attempt);
      map.relayout?.();
      console.log("[PindMap:pin] orchestrator: relayout done");
      pendingRaf = window.requestAnimationFrame(() => {
        if (cancelled) return;
        console.log("[PindMap:pin] orchestrator: rAF done");
        addPlacePins(map, markersRef.current, feedPosts, savedPlaces, "main");
        console.log("[PindMap:pin] orchestrator: addPlacePins done with %d places", savedPlaces.length);
        const pollStartedAt = Date.now();
        const pollTick = () => {
          if (cancelled) {
            clearMarkerPoll();
            return;
          }
          const markerCount = markersRef.current.length;
          const success = visiblePlacesCount === 0 || markerCount > 0;
          if (success) {
            clearMarkerPoll();
            orchestratorSuccessKeyRef.current = cycleKey;
            console.log("[PindMap:pin] orchestrator cycle %d success at attempt %d (markers: %d)", cycleId, attempt, markerCount);
            return;
          }
          if (Date.now() - pollStartedAt >= MARKER_POLL_MAX_MS) {
            clearMarkerPoll();
            const markerCountFinal = markersRef.current.length;
            if (attempt === 1) {
              runAttempt(2);
              return;
            }
            if (attempt === 2) {
              pendingTimer = window.setTimeout(() => {
                runAttempt(3);
              }, 500);
              return;
            }
            console.log("[PindMap:pin] orchestrator cycle %d failed after 3 attempts (markers: %d, places: %d)", cycleId, markerCountFinal, visiblePlacesCount);
            scheduleMainPinOrchestratorFallback("orchestrator-3-attempts-exhausted", cycleId);
          }
        };
        pollIntervalId = window.setInterval(pollTick, MARKER_POLL_INTERVAL_MS);
        pollTick();
      });
    };

    runAttempt(1);
    return () => {
      cancelled = true;
      if (pendingRaf !== null) window.cancelAnimationFrame(pendingRaf);
      if (pendingTimer !== null) window.clearTimeout(pendingTimer);
      clearMarkerPoll();
    };
  }, [activeTab, kakaoStatus, compactMapReady, savedPlaces, feedPosts, hiddenIds]);

  /** M-1: 전체 지도 닫힘(true→false) 시 지연 핀 재시도 예약, 확장 중에는 취소 */
  useEffect(() => {
    if (mapExpanded) {
      clearMainPinFallbackTimer();
      prevMapExpandedForFallbackRef.current = true;
      return () => {
        clearMainPinFallbackTimer();
      };
    }
    const wasExpanded = prevMapExpandedForFallbackRef.current === true;
    prevMapExpandedForFallbackRef.current = false;
    if (wasExpanded) {
      scheduleMainPinOrchestratorFallback("map-collapsed", 0);
    }
    return () => {
      clearMainPinFallbackTimer();
    };
  }, [mapExpanded]);

  useEffect(() => {
    if (!mapExpanded || !mapExpandedRef.current || kakaoStatus !== "ready" || !isKakaoMapsApiReady()) {
      return undefined;
    }

    let cancelled = false;
    const tid = window.setTimeout(() => {
      if (cancelled || !mapExpandedRef.current || !isKakaoMapsApiReady()) return;
      const mapContainerEl = mapExpandedRef.current;
      expandedMapRef.current = new window.kakao.maps.Map(mapContainerEl, {
        center: mapRef.current?.getCenter() ?? new window.kakao.maps.LatLng(37.5665, 126.978),
        level: mapRef.current?.getLevel() ?? 9,
      });
      const map = expandedMapRef.current;
      console.log("[PindMap:expandedMap] Map instance ready, wiring kakao click + DOM touch fallback");

      addMyLocation(map, "expanded");
      setExpandedMapPinsTick((n) => n + 1);

      const hitFromLatLng = (lat: number, lng: number, source: string): boolean => {
        const candidates = lastExpandedSearchPlacesRef.current;
        if (!candidates.length) {
          console.log("[PindMap:expandedMap] geo tap skipped (no keyword/address pins in memory)", source);
          return false;
        }
        const picked = pickNearestExpandedSearchPlaceByPixel(map, lat, lng, candidates, 56);
        if (!picked) {
          console.log("[PindMap:expandedMap] geo tap no marker within px threshold", source, { lat, lng, nearCount: candidates.length });
          return false;
        }
        openExpandedSearchPlaceCard(picked, source);
        return true;
      };

      const listenerClick = window.kakao.maps.event.addListener(map, "click", (me: any) => {
        const ll = me?.latLng;
        if (!ll) {
          console.log("[PindMap:expandedMap] kakao map click without latLng");
          return;
        }
        const lat = ll.getLat();
        const lng = ll.getLng();
        console.log("[PindMap:expandedMap] kakao maps map.click", lat, lng);
        hitFromLatLng(lat, lng, "kakao-map-click+pixels");
      });

      const fingerStartRef = { x: 0, y: 0 };

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        const tc = e.touches[0];
        fingerStartRef.x = tc.clientX;
        fingerStartRef.y = tc.clientY;
        console.log("[PindMap:expandedMap] DOM touchstart", tc.clientX, tc.clientY);
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (e.changedTouches.length !== 1) return;
        const tc = e.changedTouches[0];
        const dx = tc.clientX - fingerStartRef.x;
        const dy = tc.clientY - fingerStartRef.y;
        if (Math.hypot(dx, dy) > 22) {
          console.log("[PindMap:expandedMap] DOM touchend ignored (drag-like)", dx, dy);
          return;
        }
        const proj = map.getProjection?.();
        if (!proj?.coordsFromContainerPoint) {
          console.warn("[PindMap:expandedMap] touchend: no coordsFromContainerPoint");
          return;
        }
        const rect = mapContainerEl.getBoundingClientRect();
        const px = tc.clientX - rect.left;
        const pyTouch = tc.clientY - rect.top;
        console.log("[PindMap:expandedMap] DOM touchend → container px", px, pyTouch);
        const latlng = proj.coordsFromContainerPoint(new window.kakao.maps.Point(px, pyTouch));
        if (!latlng) {
          console.log("[PindMap:expandedMap] touchend coordsFromContainerPoint returned null");
          return;
        }
        const latTap = latlng.getLat();
        const lngTap = latlng.getLng();
        if (hitFromLatLng(latTap, lngTap, "dom-touchend+pixels")) return;
        const pickedSaved = pickNearestSavedPlaceByPixel(
          map,
          latTap,
          lngTap,
          savedPlaces,
          savedPlaceCoordsRef.current,
          hiddenIds,
          56,
        );
        if (!pickedSaved) return;
        const curId = String(selectedPlaceRef.current?._savedPlaceId || "").trim();
        if (curId === pickedSaved.id) {
          console.log("[PindMap:expandedMap] saved-pin touch assist skip (card already open)", pickedSaved.id);
          return;
        }
        const now = Date.now();
        const d = expandedSavedTouchAssistDedupeRef.current;
        if (d.id === pickedSaved.id && now - d.t < 280) {
          console.log("[PindMap:expandedMap] saved-pin touch assist deduped", pickedSaved.id);
          return;
        }
        expandedSavedTouchAssistDedupeRef.current = { t: now, id: pickedSaved.id };
        const c = savedPlaceCoordsRef.current[pickedSaved.id];
        if (!c) return;
        const relatedPosts = getRelatedPostsForPlaceSheet(
          feedPosts,
          placeRefFromPlace(pickedSaved, c.lat, c.lng),
        );
        console.log("[PindMap:expandedMap] saved-pin touch assist", pickedSaved.name);
        setSelectedPlace(toSelectedFromSavedPlace(pickedSaved, relatedPosts, c.lat, c.lng));
      };

      mapContainerEl.addEventListener("touchstart", onTouchStart, { passive: true });
      mapContainerEl.addEventListener("touchend", onTouchEnd, { passive: true });

      const updateResearchButtonVisibility = () => {
        if (!lastSearchCenterRef.current || !mapSearchKeywordRef.current.trim()) {
          setShowMapResearchButton(false);
          return;
        }
        if (mapSearchResultsRef.current.length === 0) {
          setShowMapResearchButton(false);
          return;
        }
        if (pendingSearchCenterSyncRef.current) {
          const c = map.getCenter();
          if (c) {
            lastSearchCenterRef.current = { lat: c.getLat(), lng: c.getLng() };
          }
          pendingSearchCenterSyncRef.current = false;
          setShowMapResearchButton(false);
          return;
        }
        const center = map.getCenter();
        if (!center) return;
        const dist = distanceMeters(
          lastSearchCenterRef.current.lat,
          lastSearchCenterRef.current.lng,
          center.getLat(),
          center.getLng(),
        );
        const threshold = getMapResearchDistanceThresholdM(map);
        if (dist < threshold * 0.45) {
          setShowMapResearchButton(false);
        } else if (dist >= threshold) {
          setShowMapResearchButton(true);
        }
      };

      const listenerIdle = window.kakao.maps.event.addListener(map, "idle", updateResearchButtonVisibility);

      expandedMapInteractionCleanupRef.current = () => {
        try {
          window.kakao.maps.event.removeListener(listenerClick);
          window.kakao.maps.event.removeListener(listenerIdle);
        } catch (err) {
          console.log("[PindMap:expandedMap] removeListener error", err);
        }
        mapContainerEl.removeEventListener("touchstart", onTouchStart);
        mapContainerEl.removeEventListener("touchend", onTouchEnd);
        expandedMapInteractionCleanupRef.current = null;
        console.log("[PindMap:expandedMap] teardown map click + touch listeners");
      };
    }, 100);

    return () => {
      cancelled = true;
      window.clearTimeout(tid);
      expandedMapInteractionCleanupRef.current?.();
      lastExpandedSearchPlacesRef.current = [];
      mapSearchResultPinsRef.current.forEach((m) => {
        try {
          m.setMap(null);
        } catch {
          /* noop */
        }
      });
      mapSearchResultPinsRef.current = [];
      myLocationMarkerRef.current.expanded = null;
    };
  }, [mapExpanded, kakaoStatus, openExpandedSearchPlaceCard, feedPosts, savedPlaces, hiddenIds, toSelectedFromSavedPlace]);

  useEffect(() => {
    console.log("[expanded effect]", "tick:", expandedMapPinsTick, "savedPlaces.length:", savedPlaces.length);
    if (!mapExpanded || !expandedMapRef.current || !geocoderRef.current) return;
    console.log("[expanded effect:addPlacePins]");
    addPlacePins(expandedMapRef.current, expandedMarkersRef.current, feedPosts, savedPlaces, "expanded");
    // addFeedPins(expandedMapRef.current, feedMarkersRef.current, feedPosts); // 비활성화: 다른 사람 큐레이션 핀 안 보이게
  }, [feedPosts, mapExpanded, savedPlaces, expandedMapPinsTick]);

  useEffect(() => {
    if (activeTab !== "map") {
      returnToCourseSheetRef.current = false;
    }
  }, [activeTab]);

  useEffect(() => {
    if (!mapExpanded) {
      setIsMapSearchSheetOpen(false);
      setMapSearchResults([]);
      setMapSearchLabel("");
      setShowMapResearchButton(false);
      lastSearchCenterRef.current = null;
      mapSearchKeywordRef.current = "";
      pendingSearchCenterSyncRef.current = false;
      setExpandedNativeMapEnabled(false);
      setExpandedNativeMapId(null);
    }
  }, [mapExpanded]);

  /** V-7-1: 확장 지도 Native 슬롯 mount / unmount */
  useEffect(() => {
    const EXTENDED_NATIVE_MAP_SLOT_ID = "extended-map-slot";

    if (!mapExpanded || !expandedNativeMapEnabled || !isNativeMapAvailable()) {
      const staleId = expandedNativeMapIdRef.current;
      if (staleId) {
        void destroyNativeMap(staleId);
        setExpandedNativeMapId(null);
      }
      return;
    }

    let cancelled = false;

    const mountNativeMap = () => {
      if (cancelled) return;
      const map = expandedMapRef.current;
      let lat = 37.5665;
      let lng = 126.978;
      let zoom = 9;
      try {
        if (map?.getCenter) {
          const center = map.getCenter();
          lat = center.getLat();
          lng = center.getLng();
          zoom = typeof map.getLevel === "function"
            ? kakaoJsLevelToNativeZoomLevel(map.getLevel())
            : FULLSCREEN_NATIVE_DEFAULT_ENTRY_ZOOM;
        }
      } catch {
        /* noop */
      }

      void createNativeMap({
        elementId: EXTENDED_NATIVE_MAP_SLOT_ID,
        lat,
        lng,
        zoom,
        provider: "kakao",
      }).then((result) => {
        if (cancelled) {
          void destroyNativeMap(result.mapId);
          return;
        }
        setExpandedNativeMapId(result.mapId);
      });
    };

    const tid = window.setTimeout(mountNativeMap, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(tid);
      const id = expandedNativeMapIdRef.current;
      setExpandedNativeMapId(null);
      if (id) void destroyNativeMap(id);
    };
  }, [mapExpanded, expandedNativeMapEnabled]);

  /** V-7-1: JS 카카오맵 pan/zoom → Native 카메라 (단방향, idle) */
  useEffect(() => {
    if (
      !mapExpanded ||
      !expandedNativeMapEnabled ||
      !expandedNativeMapId ||
      expandedNativeMapId === "unavailable" ||
      !expandedMapRef.current ||
      !window.kakao?.maps
    ) {
      return undefined;
    }

    const map = expandedMapRef.current;
    const mapId = expandedNativeMapId;

    const syncJsCameraToNative = () => {
      try {
        const center = map.getCenter();
        if (!center) return;
        void setNativeCamera(
          mapId,
          {
            lat: center.getLat(),
            lng: center.getLng(),
            zoom: kakaoJsLevelToNativeZoomLevel(map.getLevel()),
            animated: false,
          },
          { silent: true },
        );
      } catch {
        /* noop */
      }
    };

    syncJsCameraToNative();
    const listener = window.kakao.maps.event.addListener(map, "idle", syncJsCameraToNative);

    return () => {
      try {
        window.kakao.maps.event.removeListener(listener);
      } catch {
        /* noop */
      }
    };
  }, [mapExpanded, expandedNativeMapEnabled, expandedNativeMapId]);

  useEffect(() => { if (!openMenuId) return; const handler = () => setOpenMenuId(null); document.addEventListener("click", handler); return () => document.removeEventListener("click", handler); }, [openMenuId]);

  useEffect(() => {
    if (detailPostId && scrollToComment) {
      setTimeout(() => {
        scrollToCommentSection();
        commentInputRef.current?.focus();
        setScrollToComment(false);
      }, 200);
    }
  }, [detailPostId, scrollToComment, scrollToCommentSection]);

  useEffect(() => {
    if (!commentInputFocusedRef.current || keyboardHeight <= 0) return;
    const t = window.setTimeout(() => scrollToCommentSection(), 50);
    return () => window.clearTimeout(t);
  }, [keyboardHeight, scrollToCommentSection]);

  const visibleFeedPosts = useMemo(() => {
    return feedPosts
      .filter((p) => !p.archived)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [feedPosts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedHomeSearchQuery(homeSearchQuery);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [homeSearchQuery]);

  const filteredHomeFeedPosts = useMemo(() => {
    let result = visibleFeedPosts;
    if (selectedCompanionTag !== "all") {
      result = result.filter((p) => p.companionTag === selectedCompanionTag);
    }
    if (selectedHomeCategory !== "all") {
      result = result.filter((p) => feedPostMatchesCategoryFilter(p, selectedHomeCategory));
    }
    return result;
  }, [visibleFeedPosts, selectedCompanionTag, selectedHomeCategory]);

  const homeSearchResultPosts = useMemo(() => {
    const q = debouncedHomeSearchQuery.trim();
    if (!q) return [];
    return visibleFeedPosts.filter((p) => feedPostMatchesHomeSearch(p, q));
  }, [visibleFeedPosts, debouncedHomeSearchQuery]);

  const openHomeSearch = useCallback(() => {
    setIsHomeSearchOpen(true);
  }, []);

  const closeHomeSearch = useCallback(() => {
    setIsHomeSearchOpen(false);
    setHomeSearchQuery("");
    setDebouncedHomeSearchQuery("");
  }, []);

  useEffect(() => {
    if (activeTab !== "home" && isHomeSearchOpen) {
      closeHomeSearch();
    }
  }, [activeTab, isHomeSearchOpen, closeHomeSearch]);

  const myMypagePosts = useMemo(() => {
    if (!user?.id) return [];
    const uname = user.username;
    return feedPosts
      .filter(
        (p) =>
          !p.archived &&
          (p.userId === user.id || (uname && p.user === uname)),
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [feedPosts, user?.id, user?.username]);

  useEffect(() => {
    if (activeTab !== "mypage" || !user?.id) return;
    const perfScreen = "tab:mypage:fetch";
    dlog.perf.start(perfScreen);
    dlog.perf.fetchStart(perfScreen);
    void refreshMyTotalLikes();
    void refreshMyCourses();
    let cancelled = false;
    void (async () => {
      const uid = user.id;
      const [followersRes, followingsRes] = await Promise.all([
        supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", uid),
        supabase.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", uid),
      ]);
      if (cancelled) return;
      setMypageFollowerCount(followersRes.count ?? 0);
      setMypageFollowingCount(followingsRes.count ?? 0);
      dlog.perf.fetchEnd(perfScreen);
      dlog.perf.markRender(perfScreen);
    })();
    return () => {
      cancelled = true;
      dlog.perf.cancel(perfScreen);
    };
  }, [activeTab, user?.id, refreshMyTotalLikes, refreshMyCourses]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (activeTab !== "mypage" || !user?.id) return;
      void refreshMyTotalLikes();
      void refreshMyCourses();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [activeTab, user?.id, refreshMyTotalLikes, refreshMyCourses]);

  const togglePlaceSheetSave = useCallback(async (placeData: PlaceSheetData, onAfterSave?: () => void) => {
    if (!user?.id) {
      showToast("로그인 후 이용해주세요", "info");
      return;
    }
    const saved = resolveSavedMatch(placeData);
    if (saved) {
      await deletePlace(saved.id);
      showToast("저장이 취소되었어요", "info");
      return;
    }
    const category = inferCategoryFromKakaoCategoryName(placeData.category_name) as Category;
    const heartCoords = kakaoYXToLatLng(placeData.y, placeData.x);
    await addPlace({
      id: Math.random().toString(36).substring(2) + Date.now().toString(36),
      name: placeData.place_name,
      address: placeData.road_address_name || placeData.address_name || "",
      category,
      ...(heartCoords ? { lat: heartCoords.lat, lng: heartCoords.lng } : {}),
    });
    showToast("저장됐어요", "success");
    onAfterSave?.();
  }, [user?.id, resolveSavedMatch, deletePlace, addPlace, showToast]);

  const resolveFullscreenMarkerPlaceSheet = useCallback((markerId: string): PlaceSheetData | null => {
    const id = String(markerId ?? "").trim();
    if (!id) return null;
    if (id.startsWith("place-")) {
      const place = placePinByIdRef.current.get(id);
      if (!place) return null;
      const stored = savedPlaceCoordsRef.current[place.id] ?? latLngFromRow(place);
      const lat = stored?.lat;
      const lng = stored?.lng;
      const relatedPosts = getRelatedPostsForPlaceSheet(
        feedPostsRef.current,
        placeRefFromPlace(place, lat, lng),
      );
      return toSelectedFromSavedPlace(place, relatedPosts, lat, lng) as PlaceSheetData;
    }
    if (id.startsWith("search-")) {
      const place = searchPinPlaceByIdRef.current.get(id);
      if (!place) return null;
      const expandedRef = placeRefFromKakaoPlace(place);
      return {
        ...place,
        _feedPosts: getRelatedPostsForPlaceSheet(feedPostsRef.current, expandedRef),
        _placeRef: expandedRef,
      } as PlaceSheetData;
    }
    return null;
  }, [toSelectedFromSavedPlace]);

  const handleFullscreenNativeToggleSave = useCallback(async (markerId: string) => {
    const placeData = resolveFullscreenMarkerPlaceSheet(markerId);
    if (!placeData) {
      showToast("장소 정보를 찾을 수 없어요", "error");
      return;
    }
    await togglePlaceSheetSave(placeData);
    const isSaved = !!resolveSavedMatch(placeData);
    await setFullscreenNativePlaceSaved({ id: markerId, saved: isSaved }, { silent: false });
  }, [resolveFullscreenMarkerPlaceSheet, togglePlaceSheetSave, resolveSavedMatch, showToast]);

  const handleFullscreenNativeOpenExternal = useCallback((markerId: string, type: "apple" | "transit") => {
    const placeData = resolveFullscreenMarkerPlaceSheet(markerId);
    if (!placeData) {
      showToast("장소 정보를 찾을 수 없어요", "error");
      return;
    }
    const lat = Number(placeData.y);
    const lng = Number(placeData.x);
    if (type === "apple") {
      openAppleMapsPlace(
        placeData.place_name,
        placeData.road_address_name || placeData.address_name,
        placeData.y,
        placeData.x,
      );
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      showToast("위치 정보가 없어요", "error");
      return;
    }
    openTransitInKakaoMap(placeData.place_name ?? "장소", lat, lng);
  }, [resolveFullscreenMarkerPlaceSheet, openAppleMapsPlace, showToast]);

  useEffect(() => {
    if (!isNativeMapAvailable()) return;
    if (fullscreenToggleSaveListenerRegisteredRef.current) return;
    fullscreenToggleSaveListenerRegisteredRef.current = true;
    void PindmapNativeMap.addListener("fullscreenToggleSave", (e) => {
      void handleFullscreenNativeToggleSave(e.id);
    }).catch((err) => {
      fullscreenToggleSaveListenerRegisteredRef.current = false;
      console.error("[fullscreen] fullscreenToggleSave listener failed", err);
    });
  }, [handleFullscreenNativeToggleSave]);

  useEffect(() => {
    if (!isNativeMapAvailable()) return;
    if (fullscreenCurationListenerRegisteredRef.current) return;
    fullscreenCurationListenerRegisteredRef.current = true;
    void PindmapNativeMap.addListener("fullscreenCuration", (e) => {
      if (e.postId) setDetailPostId(e.postId);
    }).catch((err) => {
      fullscreenCurationListenerRegisteredRef.current = false;
      console.error("[fullscreen] fullscreenCuration listener failed", err);
    });
  }, []);

  useEffect(() => {
    if (!isNativeMapAvailable()) return;
    if (fullscreenOpenExternalListenerRegisteredRef.current) return;
    fullscreenOpenExternalListenerRegisteredRef.current = true;
    void PindmapNativeMap.addListener("fullscreenOpenExternal", (e) => {
      const type = e.type === "transit" ? "transit" : "apple";
      handleFullscreenNativeOpenExternal(e.id, type);
    }).catch((err) => {
      fullscreenOpenExternalListenerRegisteredRef.current = false;
      console.error("[fullscreen] fullscreenOpenExternal listener failed", err);
    });
  }, [handleFullscreenNativeOpenExternal]);

  useEffect(() => {
    if (!isNativeMapAvailable()) return;
    if (fullscreenImageLightboxListenerRegisteredRef.current) return;
    fullscreenImageLightboxListenerRegisteredRef.current = true;
    void PindmapNativeMap.addListener("fullscreenImageLightbox", (e) => {
      if (e.url) setLightboxImg(e.url);
    }).catch((err) => {
      fullscreenImageLightboxListenerRegisteredRef.current = false;
      console.error("[fullscreen] fullscreenImageLightbox listener failed", err);
    });
  }, []);

  const openHomePlaceSheetFromPost = useCallback(
    (post: FeedPost, placeRef?: PlaceRefForPhotoTagMatch) => {
      const ref = placeRef ?? placeRefFromFeedPost(post);
      const relatedPosts = getRelatedPostsForPlaceSheet(feedPosts, ref);
      const sheetName = ref.placeName?.trim() || post.placeName;
      const sheetAddress = ref.address?.trim() || post.address;
      const matchedSaved = savedPlaces.find(
        (p) => p.name.trim() === sheetName && p.address.trim() === sheetAddress,
      );
      setHomePlaceSheet(
        feedPostToPlaceSheet(
          {
            id: post.id,
            placeName: sheetName,
            address: sheetAddress,
            category: post.category,
            lat: ref.lat ?? post.lat,
            lng: ref.lng ?? post.lng,
          },
          relatedPosts,
          matchedSaved?.id,
          ref,
        ),
      );
    },
    [feedPosts, savedPlaces],
  );

  const renderPlaceCard = () => {
    if (!selectedPlace) return null;
    const placeData = selectedPlace as PlaceSheetData;
    return (
      <PlaceDetailSheet
        place={placeData}
        isSaved={!!resolveSavedMatch(selectedPlace)}
        layout="embedded"
        showDirections={!!(selectedPlace.y && selectedPlace.x)}
        directionsMode={directionsMode}
        directionsLoading={directionsLoading}
        directionsInfo={directionsInfo}
        onClose={() => {
          setSelectedPlace(null);
          setSelectedMapPlace(null);
        }}
        onToggleSave={() => {
          void togglePlaceSheetSave(placeData, () => {
            const py = parseFloat(String(selectedPlace.y ?? ""));
            const px = parseFloat(String(selectedPlace.x ?? ""));
            if (Number.isFinite(py) && Number.isFinite(px)) {
              focusExpandedMapOnLatLng(py, px, 3);
            } else {
              focusExpandedMapOnAddress(selectedPlace.road_address_name || selectedPlace.address_name || "", 3);
            }
          });
        }}
        onCurationClick={(postId) => {
          setDetailPostId(postId);
          setSelectedPlace(null);
          setMapExpanded(false);
        }}
        onImageLightbox={setLightboxImg}
        timeAgoLabel={timeAgo}
        onOpenAppleMaps={() =>
          openAppleMapsPlace(
            selectedPlace.place_name,
            selectedPlace.road_address_name || selectedPlace.address_name,
            selectedPlace.y,
            selectedPlace.x,
          )
        }
        onDirectionsModeChange={(mode) => {
          setDirectionsMode(mode);
          drawRoute(parseFloat(selectedPlace.y), parseFloat(selectedPlace.x), mode);
        }}
        onOpenTransit={() =>
          openTransitInKakaoMap(selectedPlace.place_name, parseFloat(selectedPlace.y), parseFloat(selectedPlace.x))
        }
        onClearRoute={clearRoute}
      />
    );
  };

  if (userLoading || !sessionChecked) {
    return (
      <main className="mobileRoot">
        <section className="phoneFrame" style={{ display: "flex", flexDirection: "column", background: "#fafafa" }}>
          <header className="appHeader" style={{ opacity: 0.85 }}>
            <h1 className="appTitle" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="skeleton" style={{ width: 22, height: 22, borderRadius: 6, display: "inline-block" }} />
              <span className="skeleton" style={{ width: 88, height: 18, borderRadius: 4, display: "inline-block" }} />
            </h1>
          </header>
          <section className="appContent" style={{ flex: 1, minHeight: 0, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="skeleton" style={{ width: "40%", height: 14, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: "100%", height: 220, borderRadius: 12 }} />
            <div className="skeleton" style={{ width: "100%", height: 44, borderRadius: 8 }} />
            <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#aaa", textAlign: "center" }}>불러오는 중...</p>
          </section>
        </section>
      </main>
    );
  }

  if (loggingOut) {
    return (
      <main className="mobileRoot">
        <section
          className="phoneFrame"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            minHeight: 0,
            background: "#fafafa",
            gap: 16,
            padding: 24,
          }}
        >
          <div
            className="skeleton"
            style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }}
            aria-hidden
          />
          <p role="status" style={{ margin: 0, fontSize: 14, color: "#666" }}>
            로그아웃 중...
          </p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mobileRoot">
        <section
          className="phoneFrame"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100dvh",
            background: "#fafafa",
            padding: 24,
            gap: 16,
          }}
        >
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: "50%" }} aria-hidden />
          <p style={{ margin: 0, fontSize: 13, color: "#888", textAlign: "center" }}>
            {authRetryPending ? "다시 연결하는 중..." : "세션을 확인하고 있어요..."}
          </p>
          <button
            type="button"
            disabled={authRetryPending}
            onClick={() => {
              setAuthRetryPending(true);
              void (async () => {
                try {
                  const ok = await reloadUserWithTimeout();
                  if (!ok) router.push("/login");
                } finally {
                  setAuthRetryPending(false);
                }
              })();
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #1a2a7a",
              background: "#fff",
              color: "#1a2a7a",
              fontSize: 13,
              fontWeight: 500,
              cursor: authRetryPending ? "wait" : "pointer",
              fontFamily: "inherit",
              opacity: authRetryPending ? 0.7 : 1,
            }}
          >
            다시 시도
          </button>
        </section>
      </main>
    );
  }

  const courseShareModalEl =
    showCourseShareModal &&
    sharingCourse &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            className="courseShareModalBackdrop"
            onClick={() => {
              if (!courseShareLoading) closeCourseShareModal();
            }}
          >
            <div className="courseShareModalSheet" onClick={(e) => e.stopPropagation()}>
              <div className="courseShareModalHeader">
                <span className="courseShareModalTitle">코스 공유하기</span>
                <button
                  type="button"
                  className="courseShareModalClose"
                  onClick={closeCourseShareModal}
                  disabled={courseShareLoading}
                  aria-label="닫기"
                >
                  ×
                </button>
              </div>
              <div className="courseShareModalCourseBox">
                <p className="courseShareModalCourseText">
                  📍 {sharingCourse.title} · {sharingCourse.place_count ?? sharingCourse.items.length}곳
                </p>
              </div>
              <input
                type="search"
                className="courseShareModalSearch"
                placeholder="친구 검색"
                value={courseShareSearchQuery}
                onChange={(e) => setCourseShareSearchQuery(e.target.value)}
                disabled={courseShareLoading}
                aria-label="친구 검색"
              />
              <div className="courseShareModalGridScroll">
                {courseShareFriendRooms.length === 0 ? (
                  <p className="courseShareModalEmpty">아직 친구가 없어요</p>
                ) : courseShareFilteredRooms.length === 0 ? (
                  <p className="courseShareModalEmpty">검색 결과가 없어요</p>
                ) : (
                  <div className="courseShareModalGrid" role="list">
                    {courseShareFilteredRooms.map((room) => {
                      const isSending = courseShareSendingRoomId === room.id;
                      const isSent = courseShareSentRoomIds.includes(room.id);
                      return (
                        <button
                          key={room.id}
                          type="button"
                          role="listitem"
                          className={
                            isSent
                              ? "courseShareModalFriendCell courseShareModalFriendCellSent"
                              : "courseShareModalFriendCell"
                          }
                          onClick={() => void sendCourseToFriend(room)}
                          disabled={courseShareLoading || isSent}
                          aria-label={`${room.friendName}에게 코스 보내기`}
                        >
                          <span className="courseShareModalFriendAvatarWrap">
                            <ProfileAvatar
                              avatarUrl={room.friendAvatarUrl}
                              username={room.friendName}
                              size={72}
                              fontSize={22}
                            />
                            {isSent && (
                              <span className="courseShareModalFriendCheck" aria-hidden>
                                ✓
                              </span>
                            )}
                            {isSending && (
                              <span className="courseShareModalFriendSending" aria-hidden>
                                ···
                              </span>
                            )}
                          </span>
                          <span className="courseShareModalFriendName">{room.friendName}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="courseShareModalActionBar">
                <button
                  type="button"
                  className="courseShareModalActionBtn"
                  onClick={() => void handleCopyCourseShareLink()}
                  disabled={courseShareLoading}
                >
                  <span className="courseShareModalActionIcon" aria-hidden>
                    📋
                  </span>
                  <span>링크 복사</span>
                </button>
                <button
                  type="button"
                  className="courseShareModalActionBtn"
                  onClick={() => void handleShareCourseViaSystem()}
                  disabled={courseShareLoading}
                >
                  <span className="courseShareModalActionIcon" aria-hidden>
                    📤
                  </span>
                  <span>공유</span>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  const sharePostModalEl = sharePost && (
    <div onClick={() => { if (!shareLoading) { setSharePost(null); setFriendRooms([]); } }} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", display: "flex", flexDirection: "column", gap: "12px", maxHeight: "70vh", overflowY: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
          <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>친구에게 공유</span>
          <button type="button" onClick={() => { setSharePost(null); setFriendRooms([]); }} disabled={shareLoading} style={{ border: "none", background: "transparent", fontSize: "20px", color: "#bbb", cursor: shareLoading ? "wait" : "pointer" }}>×</button>
        </div>
        <div style={{ padding: "10px 12px", background: "#f8f8fc", borderRadius: "8px" }}>
          <p style={{ margin: 0, fontSize: "13px", color: "#1a2a7a", fontWeight: 500 }}>{sharePost.title || sharePost.placeName}</p>
          <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#888" }}>{sharePost.placeName} · {sharePost.category}</p>
        </div>
        {friendRooms.length === 0 && (
          <p style={{ textAlign: "center", color: "#bbb", fontSize: "12px", padding: "20px 0" }}>대화 중인 친구가 없어요. 먼저 메시지를 시작해보세요 💌</p>
        )}
        {friendRooms.map((room) => (
          <button
            key={room.id}
            type="button"
            onClick={() => sendShareToFriend(room)}
            disabled={shareLoading}
            style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", border: "0.5px solid #eee", borderRadius: "10px", background: "#fff", cursor: shareLoading ? "wait" : "pointer", fontFamily: "inherit", textAlign: "left", opacity: shareLoading ? 0.6 : 1 }}
          >
            <ProfileAvatar avatarUrl={room.friendAvatarUrl} username={room.friendName} size={32} fontSize={13} />
            <span style={{ fontSize: "13px", color: "#1a1a2e", flex: 1 }}>{room.friendName}</span>
            <span style={{ fontSize: "11px", color: "#1a2a7a", fontWeight: 500 }}>보내기 →</span>
          </button>
        ))}
      </div>
    </div>
  );

  const getNotificationMessage = (n: Notification): string => formatInAppNotificationFromRow(n);

  const handleNotificationClick = async (n: Notification) => {
    await navigateFromInAppNotification({
      id: n.id,
      type: n.type,
      actorName: n.actor_username,
      actorUsername: n.actor_username,
      actorId: n.actor_id,
      actorAvatarUrl: n.actorAvatarUrl,
      text: getNotificationMessage(n),
      targetId: n.target_id,
      notificationId: n.id,
    });
  };

  const markAllNotificationsRead = async () => {
    if (!user) return;
    await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const notificationModalEl = showNotifications && (
    <div style={{
      position: "fixed",
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 99999,
      background: "#fff",
      display: "flex",
      flexDirection: "column",
    }}>
      <div
        className="fullscreenOverlayTop"
        style={{
        borderBottom: "0.5px solid #efefef",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexShrink: 0,
      }}
      >
        <button
          onClick={() => setShowNotifications(false)}
          style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex" }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a", flex: 1 }}>알림</span>
        {unreadNotificationCount > 0 && (
          <button
            onClick={markAllNotificationsRead}
            style={{ border: "none", background: "transparent", color: "#1a2a7a", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}
          >
            모두 읽음
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 20px" }}>
        {notifications.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#bbb" }}>
            <p style={{ fontSize: "32px", margin: 0 }}>🔔</p>
            <p style={{ fontSize: "13px", margin: "12px 0 0" }}>아직 알림이 없어요</p>
          </div>
        )}
        {notifications.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => handleNotificationClick(n)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              padding: "14px 12px",
              border: "none",
              background: n.read ? "transparent" : "#f5f7ff",
              borderRadius: "10px",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              width: "100%",
              marginBottom: "6px",
            }}
          >
            <ProfileAvatar avatarUrl={n.actorAvatarUrl} username={n.actor_username} size={36} fontSize={13} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#1a1a2e", lineHeight: 1.4 }}>
                {getNotificationMessage(n)}
              </p>
              {n.target_text && (
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {n.target_text}
                </p>
              )}
              <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#aaa" }}>
                {timeAgo(n.created_at)}
              </p>
            </div>
            {!n.read && (
              <span style={{
                width: "8px", height: "8px",
                borderRadius: "50%",
                background: "#e53935",
                flexShrink: 0,
                marginTop: "6px",
              }} />
            )}
          </button>
        ))}
      </div>
    </div>
  );

  const courseModalLayerEl =
    (showCourseModal || showCourseEditScreen || showCourseSaveModal) &&
    typeof document !== "undefined"
      ? createPortal(
          <>
            {showCourseModal && (
                        <div
                          className="courseModalBackdrop"
                          style={{
                            paddingBottom: keyboardHeight > 0 ? keyboardHeight : 0,
                            transition: "padding-bottom 0.25s ease",
                            boxSizing: "border-box",
                          }}
                        >
                          <div className="courseModalSheet">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                {savedCourseId ? (
                                  isEditingCourseTitleInline && !isReadOnlyCourse ? (
                                    <div>
                                      <input
                                        ref={courseTitleInlineInputRef}
                                        className="profileEditField"
                                        value={editingCourseTitle}
                                        maxLength={60}
                                        onChange={(e) => setEditingCourseTitle(e.target.value)}
                                        style={{
                                          width: "100%",
                                          boxSizing: "border-box",
                                          borderRadius: 12,
                                          padding: "10px 12px",
                                          fontSize: 14,
                                        }}
                                      />
                                      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#999", textAlign: "right" }}>
                                        {editingCourseTitle.length}/60
                                      </p>
                                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                        <button
                                          type="button"
                                          disabled={courseTitleSaving}
                                          onClick={() => { void handleSaveCourseTitleInline(); }}
                                          style={{
                                            padding: "8px 14px",
                                            borderRadius: 8,
                                            border: "none",
                                            background: "#1a2a7a",
                                            color: "#fff",
                                            fontSize: 12,
                                            fontWeight: 600,
                                            cursor: courseTitleSaving ? "wait" : "pointer",
                                            fontFamily: "inherit",
                                            opacity: courseTitleSaving ? 0.7 : 1,
                                          }}
                                        >
                                          {courseTitleSaving ? "저장 중..." : "저장"}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={courseTitleSaving}
                                          onClick={() => {
                                            setEditingCourseTitle(courseTitleOriginalRef.current);
                                            setIsEditingCourseTitleInline(false);
                                          }}
                                          style={{
                                            padding: "8px 14px",
                                            borderRadius: 8,
                                            border: "1px solid #ddd",
                                            background: "#fff",
                                            color: "#666",
                                            fontSize: 12,
                                            cursor: courseTitleSaving ? "wait" : "pointer",
                                            fontFamily: "inherit",
                                          }}
                                        >
                                          취소
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                      <span
                                        style={{
                                          fontSize: 17,
                                          fontWeight: 600,
                                          color: "#000",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                          flex: 1,
                                          minWidth: 0,
                                        }}
                                      >
                                        {editingCourseTitle}
                                      </span>
                                      {!isReadOnlyCourse && (
                                        <button
                                          type="button"
                                          aria-label="제목 수정"
                                          onClick={() => {
                                            courseTitleOriginalRef.current = editingCourseTitle;
                                            setIsEditingCourseTitleInline(true);
                                          }}
                                          style={{
                                            flexShrink: 0,
                                            border: "none",
                                            borderRadius: 6,
                                            background: "transparent",
                                            color: "#1a2a7a",
                                            fontSize: 13,
                                            fontWeight: 500,
                                            padding: "4px 8px",
                                            cursor: "pointer",
                                            fontFamily: "inherit",
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.background = "#f0f0f5";
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.background = "transparent";
                                          }}
                                          onMouseDown={(e) => {
                                            e.currentTarget.style.background = "#f0f0f5";
                                          }}
                                          onMouseUp={(e) => {
                                            e.currentTarget.style.background = "#f0f0f5";
                                          }}
                                        >
                                          편집
                                        </button>
                                      )}
                                    </div>
                                  )
                                ) : (
                                  <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>
                                    {courseResult ? "✨ 추천 코스" : "🗺️ 코스 만들기"}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={closeCourseModal}
                                style={{ border: "none", background: "transparent", fontSize: "20px", color: "#bbb", cursor: "pointer", flexShrink: 0, padding: 0, lineHeight: 1 }}
                              >
                                ×
                              </button>
                            </div>
            
                            {!courseResult && (
                              <>
                                <div>
                                  <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: "8px", marginTop: 0 }}>출발지 / 지역</p>
                                  <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                                    <button type="button" onClick={() => setCourseOriginMode("current")} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: courseOriginMode === "current" ? "1px solid #1a2a7a" : "1px solid #ddd", background: courseOriginMode === "current" ? "#1a2a7a" : "#fff", color: courseOriginMode === "current" ? "#fff" : "#666", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>📍 현재 위치</button>
                                    <button type="button" onClick={() => setCourseOriginMode("manual")} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: courseOriginMode === "manual" ? "1px solid #1a2a7a" : "1px solid #ddd", background: courseOriginMode === "manual" ? "#1a2a7a" : "#fff", color: courseOriginMode === "manual" ? "#fff" : "#666", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>✏️ 직접 입력</button>
                                  </div>
                                  {courseOriginMode === "manual" && (
                                    <input className="mapInput" placeholder="예: 성수역, 망원동" value={courseOriginAddress} onChange={(e) => setCourseOriginAddress(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
                                  )}
                                  {courseOriginMode === "current" && (
                                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#888" }}>
                                      {courseLocationLoading
                                        ? "📍 현재 위치를 확인하는 중..."
                                        : courseCurrentLocation
                                          ? `📍 현재 위치 반경 ${COURSE_WALK_RADIUS_KM}km 이내 장소(${courseBasePlaces.length}곳)로 코스를 짤게요`
                                          : `📍 위치 권한을 허용하면 반경 ${COURSE_WALK_RADIUS_KM}km 이내 장소로 코스를 짤 수 있어요`}
                                    </p>
                                  )}
                                </div>
            
                                <div>
                                  <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: "10px", marginTop: 0 }}>몇 곳을 방문할까요?</p>
                                  {CATEGORY_COURSE_MODAL_ORDER.map((cat) => {
                                    const available = courseAvailableByCategory[cat];
                                    const max = available;
                                    return (
                                      <div key={cat} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", borderBottom: "0.5px solid #f5f5f5" }}>
                                        <div style={{ flex: 1 }}>
                                          <span style={{ fontSize: "14px", color: "#1a1a2e" }}>{CATEGORY_PIN[cat].emoji} {cat}</span>
                                          <span style={{ fontSize: "11px", color: "#bbb", marginLeft: "6px" }}>
                                            {courseOriginMode === "manual" && courseRegionKeyword
                                              ? `(${courseRegionKeyword}에 ${available}곳)`
                                              : courseOriginMode === "current"
                                                ? `(주변에 ${available}곳)`
                                                : `(저장 ${available}곳)`}
                                          </span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                          <button type="button" disabled={courseCounts[cat] === 0} onClick={() => setCourseCounts(prev => ({ ...prev, [cat]: Math.max(0, prev[cat] - 1) }))} style={{ width: "28px", height: "28px", borderRadius: "50%", border: "1px solid #ddd", background: "#fff", color: "#1a2a7a", fontSize: "14px", cursor: courseCounts[cat] === 0 ? "not-allowed" : "pointer", opacity: courseCounts[cat] === 0 ? 0.4 : 1 }}>−</button>
                                          <span style={{ fontSize: "14px", color: "#1a2a7a", fontWeight: 600, minWidth: "20px", textAlign: "center" }}>{courseCounts[cat]}</span>
                                          <button type="button" disabled={courseCounts[cat] >= max} onClick={() => setCourseCounts(prev => ({ ...prev, [cat]: Math.min(max, prev[cat] + 1) }))} style={{ width: "28px", height: "28px", borderRadius: "50%", border: "1px solid #ddd", background: "#fff", color: "#1a2a7a", fontSize: "14px", cursor: courseCounts[cat] >= max ? "not-allowed" : "pointer", opacity: courseCounts[cat] >= max ? 0.4 : 1 }}>＋</button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
            
                                <button type="button" onClick={generateCourse} disabled={courseLoading || (courseOriginMode === "current" && !courseLocationLoading && courseBasePlaces.length === 0)} style={{ width: "100%", padding: "14px", borderRadius: "8px", border: "none", background: "#1a2a7a", color: "#fff", fontSize: "14px", letterSpacing: "1px", cursor: courseLoading ? "wait" : "pointer", fontFamily: "inherit", opacity: courseLoading || (courseOriginMode === "current" && !courseLocationLoading && courseBasePlaces.length === 0) ? 0.6 : 1 }}>
                                  {courseLoading ? "코스를 짜는 중..." : "코스 만들기"}
                                </button>
                                {courseOriginMode === "current" && !courseLocationLoading && courseBasePlaces.length === 0 && (
                                  <p style={{ margin: 0, textAlign: "center", fontSize: "11px", color: "#999" }}>주변에 저장된 장소가 없어요. 다른 방식으로 시도해보세요</p>
                                )}
                              </>
                            )}
            
                            {courseResult && (
                              <>
                                <p style={{ margin: 0, fontSize: "12px", color: "#888", lineHeight: 1.5 }}>📍 출발지에서 가까운 순서로 동선을 짜드렸어요. 시간에 여유 두고 다녀오세요!</p>
            
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                  {courseResult.map((place, idx) => (
                                    <div key={`${place.id}-${idx}`} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", background: "#f8f8fc", borderRadius: "10px" }}>
                                      <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#1a2a7a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, flexShrink: 0 }}>{idx + 1}</div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ margin: 0, fontSize: "13px", color: "#1a1a2e", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{place.name}</p>
                                        <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{CATEGORY_PIN[place.category].emoji} {place.category} · {place.address}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
            
                                {activeViewedCourseId ? (
                                  <>
                                    {showSaveToMyCoursesButton && (
                                      <button
                                        type="button"
                                        disabled={courseImporting || courseAlreadyImported}
                                        onClick={() => {
                                          if (activeViewedCourseId) void handleImportCourse(activeViewedCourseId);
                                        }}
                                        style={{
                                          width: "100%",
                                          padding: "12px",
                                          borderRadius: "12px",
                                          border: "1px solid #1a2a7a",
                                          background: courseAlreadyImported ? "#f4f5fb" : "#fff",
                                          color: courseAlreadyImported ? "#888" : "#1a2a7a",
                                          fontSize: "13px",
                                          fontWeight: 600,
                                          cursor: courseImporting || courseAlreadyImported ? "not-allowed" : "pointer",
                                          fontFamily: "inherit",
                                          opacity: courseImporting || courseAlreadyImported ? 0.7 : 1,
                                        }}
                                      >
                                        {courseImporting
                                          ? "저장 중..."
                                          : courseAlreadyImported
                                            ? "✓ 저장됨"
                                            : "내 코스로 저장"}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={openCourseShareFromSheet}
                                      style={{
                                        width: "100%",
                                        padding: "12px",
                                        borderRadius: "12px",
                                        border: "1px solid #1a2a7a",
                                        background: "#fff",
                                        color: "#1a2a7a",
                                        fontSize: "13px",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                        fontFamily: "inherit",
                                      }}
                                    >
                                      📤 코스 공유
                                    </button>
                                    {!isReadOnlyCourse && (
                                      <button
                                        type="button"
                                        onClick={openCourseEditScreen}
                                        style={{
                                          width: "100%",
                                          padding: "12px",
                                          borderRadius: "12px",
                                          border: "1px solid #ddd",
                                          background: "#fff",
                                          color: "#333",
                                          fontSize: "13px",
                                          fontWeight: 500,
                                          cursor: "pointer",
                                          fontFamily: "inherit",
                                        }}
                                      >
                                        ✏️ 코스 수정
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={showCourseOnMap}
                                      style={{
                                        width: "100%",
                                        padding: "12px",
                                        borderRadius: "8px",
                                        border: "none",
                                        background: "#1a2a7a",
                                        color: "#fff",
                                        fontSize: "13px",
                                        cursor: "pointer",
                                        fontFamily: "inherit",
                                      }}
                                    >
                                      🗺️ 지도에서 경로 보기
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      disabled={!!savedCourseId}
                                      onClick={() => setShowCourseSaveModal(true)}
                                      style={{
                                        width: "100%",
                                        padding: "12px",
                                        borderRadius: "12px",
                                        border: "1px solid #1a2a7a",
                                        background: "#fff",
                                        color: "#1a2a7a",
                                        fontSize: "13px",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                        fontFamily: "inherit",
                                      }}
                                    >
                                      💾 코스 저장
                                    </button>
            
                                    <div style={{ display: "flex", gap: "8px" }}>
                                      <button type="button" onClick={() => { void generateCourse(); }} disabled={courseLoading} style={{ flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid #ddd", background: "#fff", color: "#666", fontSize: "13px", cursor: courseLoading ? "wait" : "pointer", fontFamily: "inherit", opacity: courseLoading ? 0.6 : 1 }}>{courseLoading ? "다시 짜는 중..." : "다시 만들기"}</button>
                                      <button type="button" onClick={showCourseOnMap} style={{ flex: 1, padding: "12px", borderRadius: "8px", border: "none", background: "#1a2a7a", color: "#fff", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>🗺️ 지도에서 경로 보기</button>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={openAppleMapsCourseRoute}
                                      style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #d6ddf2", background: "#fff", color: "#1a2a7a", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}
                                    >
                                      🗺 Apple 지도에서 경로 보기
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      {showCourseEditScreen && editingCourseDraft && (
                        <CourseEditScreen
                          draft={editingCourseDraft}
                          saving={courseEditSaving}
                          keyboardHeight={keyboardHeight}
                          showAddPlace={showAddPlaceSheet}
                          addablePlaces={addableSavedPlacesForCourseEdit}
                          categoryPin={CATEGORY_PIN}
                          categoryColors={CATEGORY_COLORS}
                          onCloseRequest={requestCloseCourseEditScreen}
                          onSave={() => { void handleSaveCourseEdit(); }}
                          onTitleChange={(title) =>
                            setEditingCourseDraft((prev) => (prev ? { ...prev, title } : prev))
                          }
                          onOpenAddPlace={() => setShowAddPlaceSheet(true)}
                          onCloseAddPlace={() => setShowAddPlaceSheet(false)}
                          onMoveItem={moveCourseEditItem}
                          onRemoveItem={removeCourseEditItem}
                          onAddPlace={addPlaceToCourseEdit}
                        />
                      )}
                      {showCourseSaveModal && (
                        <div
                          style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 100000,
                            background: "rgba(0,0,0,0.45)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "24px",
                            paddingBottom: keyboardHeight > 0 ? 24 + keyboardHeight : 24,
                            transition: "padding-bottom 0.25s ease",
                            boxSizing: "border-box",
                          }}
                          onClick={closeCourseSaveModal}
                        >
                          <div
                            role="dialog"
                            aria-labelledby="course-save-title"
                            style={{
                              width: "100%",
                              maxWidth: "340px",
                              background: "#fff",
                              borderRadius: "16px",
                              padding: "24px 20px",
                              boxSizing: "border-box",
                              display: "flex",
                              flexDirection: "column",
                              gap: "16px",
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <p id="course-save-title" style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#1a1a2e" }}>
                              💾 코스 저장
                            </p>
                            <div>
                              <input
                                ref={courseSaveInputRef}
                                className="profileEditField"
                                placeholder="코스 이름 (예: 성수동 데이트)"
                                value={courseSaveTitle}
                                maxLength={60}
                                onChange={(e) => setCourseSaveTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !courseSaving) void handleSaveCourse();
                                }}
                                style={{ width: "100%", boxSizing: "border-box" }}
                              />
                              <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#8f93a6", textAlign: "right" }}>
                                {courseSaveTitle.length}/60
                              </p>
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                type="button"
                                onClick={closeCourseSaveModal}
                                disabled={courseSaving}
                                style={{
                                  flex: 1,
                                  padding: "12px",
                                  borderRadius: "10px",
                                  border: "1px solid #ddd",
                                  background: "#fff",
                                  color: "#666",
                                  fontSize: "13px",
                                  cursor: courseSaving ? "wait" : "pointer",
                                  fontFamily: "inherit",
                                }}
                              >
                                취소
                              </button>
                              <button
                                type="button"
                                onClick={() => { void handleSaveCourse(); }}
                                disabled={courseSaving}
                                style={{
                                  flex: 1,
                                  padding: "12px",
                                  borderRadius: "10px",
                                  border: "none",
                                  background: "#1a2a7a",
                                  color: "#fff",
                                  fontSize: "13px",
                                  fontWeight: 600,
                                  cursor: courseSaving ? "wait" : "pointer",
                                  fontFamily: "inherit",
                                  opacity: courseSaving ? 0.7 : 1,
                                }}
                              >
                                {courseSaving ? "저장 중..." : "저장하기"}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
          </>,
          document.body,
        )
      : null;

  if (detailPostId && !detailPost) {
    return (
      <main className="mobileRoot">
        <section className="phoneFrame">
          <header className="subpageHeader" style={{ height: "56px", display: "flex", alignItems: "center", padding: "0 20px", borderBottom: "0.5px solid #efefef", background: "#fff", gap: "12px", flexShrink: 0 }}>
            <button onClick={closeDetailPost} type="button" style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#1a2a7a" }}>큐레이션</span>
          </header>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
            <p style={{ margin: 0, fontSize: 13, color: "#888" }}>불러오는 중...</p>
          </div>
        </section>
      </main>
    );
  }

  if (detailPost) {
    const liked = detailPost.liked_by_me;
    const detailIsLegacyPlace = !hasPhotoPlaceTags(detailPost) && !!detailPost.placeName.trim();
    const detailCommentComposerHeight = 56;
    return (
      <>
      <main className="mobileRoot">
        <section className="phoneFrame">
          <header className="subpageHeader" style={{ height: "56px", display: "flex", alignItems: "center", padding: "0 20px", borderBottom: "0.5px solid #efefef", background: "#fff", gap: "12px", flexShrink: 0 }}>
            <button onClick={closeDetailPost} type="button" style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#1a2a7a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detailPost.title || detailPost.placeName}</span>
          </header>
          <div
            ref={detailPostScrollRef}
            className="detailPostScroll"
            style={{
              flex: 1,
              minHeight: 0,
              background: "#fff",
              paddingBottom:
                keyboardHeight > 0
                  ? `calc(${detailCommentComposerHeight}px + ${keyboardHeight}px)`
                  : `calc(${detailCommentComposerHeight}px + env(safe-area-inset-bottom, 0px))`,
              transition: "padding-bottom 0.25s ease",
            }}
          >
            <div style={{ padding: "16px 20px 0" }}><p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "22px", color: "#1a2a7a", lineHeight: 1.3 }}>{detailPost.title || detailPost.placeName}</p></div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", padding: "12px 20px 0" }}>
              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/profile/${encodeURIComponent(detailPost.user)}?from=detail&postId=${encodeURIComponent(detailPost.id)}`,
                  )
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                }}
              >
                <ProfileAvatar avatarUrl={detailPost.userAvatarUrl} username={detailPost.user} size={38} className="avatar" />
                <div>
                  <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#1a1a2e" }}>{detailPost.user}</p>
                  <p style={{ margin: 0, fontSize: "11px", color: "#aaa" }}>{timeAgo(detailPost.createdAt)}</p>
                </div>
              </button>
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                {detailPost.user !== MY_USERNAME && detailPost.userId && !followingIds.includes(detailPost.userId) && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); followUser(detailPost.user); }}
                    style={{ border: "none", background: "#1a2a7a", color: "#fff", borderRadius: "16px", padding: "4px 12px", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginRight: "4px" }}
                  >+ 팔로우</button>
                )}
                {detailPost.user !== MY_USERNAME && detailPost.userId && followingIds.includes(detailPost.userId) && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); unfollowUser(detailPost.user); }}
                    style={{ border: "1px solid #d0d4e0", background: "#fff", color: "#76809a", borderRadius: "16px", padding: "4px 12px", fontSize: "11px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", marginRight: "4px" }}
                  >팔로잉</button>
                )}
                {detailPost.user === MY_USERNAME && (
                  <div style={{ position: "relative" }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === detailPost.id ? null : detailPost.id); }} style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px 6px", display: "flex", flexDirection: "column", gap: "3px", alignItems: "center" }}>
                      <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#bbb", display: "block" }} /><span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#bbb", display: "block" }} /><span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#bbb", display: "block" }} />
                    </button>
                    {openMenuId === detailPost.id && (
                      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "28px", right: 0, background: "#fff", border: "0.5px solid #eee", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.1)", zIndex: 100, minWidth: "120px", overflow: "hidden" }}>
                        <button type="button" onClick={() => { setDetailPostId(null); openEdit(detailPost); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 16px", border: "none", background: "transparent", fontSize: "13px", color: "#333", cursor: "pointer", borderBottom: "0.5px solid #f5f5f5" }}>✏️ 수정</button>
                        <button type="button" onClick={() => toggleArchive(detailPost.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 16px", border: "none", background: "transparent", fontSize: "13px", color: "#333", cursor: "pointer", borderBottom: "0.5px solid #f5f5f5" }}>📦 보관</button>
                        <button type="button" onClick={() => { deletePost(detailPost.id); setDetailPostId(null); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 16px", border: "none", background: "transparent", fontSize: "13px", color: "#e07070", cursor: "pointer" }}>🗑️ 삭제</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {detailIsLegacyPlace && (
              <div style={{ margin: "12px 20px 0", padding: "12px 14px", background: "#f8f8fc", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "22px" }}>{CATEGORY_PIN[detailPost.category].emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: "14px", fontFamily: "'Playfair Display', serif", color: "#1a1a2e" }}>{detailPost.placeName}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detailPost.address}</p>
                  </div>
                  <span style={{ fontSize: "10px", color: "#fff", background: CATEGORY_COLORS[detailPost.category], padding: "3px 8px", borderRadius: "10px", flexShrink: 0 }}>{detailPost.category}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); goToMapFromDetailPost(); }}
                  style={{
                    width: "100%",
                    border: "none",
                    borderRadius: "8px",
                    background: "#3182F6",
                    color: "#fff",
                    padding: "11px 14px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                >
                  📍 지도에서 보기
                </button>
              </div>
            )}
            {detailPost.images.length > 0 && (
              <div className="detailPostMediaWrap">
                <FeedPostMedia
                  images={detailPost.images}
                  placeSource={detailPost}
                  mediaAriaLabel="사진 확대"
                  onMediaClick={({ imageUrl }) => setLightboxImg(imageUrl)}
                  onPlaceOverlayClick={(placeRef) => openHomePlaceSheetFromPost(detailPost, placeRef)}
                />
              </div>
            )}
            <div style={{ padding: "16px 20px 0" }}><p className="detailPostComment">{detailPost.comment}</p></div>
            {getDisplayCategories(detailPost).length > 0 && (
              <div className="detailPostCategories" style={{ padding: "12px 20px 0" }}>
                {getDisplayCategories(detailPost).map((cat) => (
                  <span
                    key={cat}
                    className="detailPostCategoryBadge"
                    style={{ background: CATEGORY_COLORS[cat as Category] ?? "#1a2a7a" }}
                  >
                    {CATEGORY_PIN[cat as Category]?.emoji ?? "📍"} {cat}
                  </span>
                ))}
              </div>
            )}
            {detailPost.courseId && (
              <div style={{ padding: "12px 20px 0" }}>
                <FeedPostLinkedCourse
                  courseId={detailPost.courseId}
                  currentUserId={MY_USER}
                  ensureCourseLoaded={ensureCourseLoaded}
                  onOpenCourse={(course, readOnly) => openSavedCourse(course, { readOnly })}
                  onCourseUnavailable={() => showToast("코스를 불러올 수 없어요", "error")}
                />
              </div>
            )}
            <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", gap: "14px", borderTop: "0.5px solid #f0f0f0", marginTop: "16px" }}>
              <button type="button" onClick={(e) => { e.stopPropagation(); void toggleLike(detailPost.id); }} style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", padding: 0 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill={liked ? "#e05555" : "none"}><path d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z" stroke={liked ? "#e05555" : "#aaa"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span style={{ fontSize: "13px", color: liked ? "#e05555" : "#aaa" }}>{detailPost.likes_count}</span>
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#aaa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span style={{ fontSize: "13px", color: "#aaa" }}>{detailPost.comments.length}</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void openShareModal(detailPost);
                }}
                style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "5px" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span style={{ fontSize: "13px", color: "#1a2a7a", fontWeight: 500 }}>공유</span>
              </button>
            </div>
            <div style={{ padding: "14px 20px 0" }}>
              <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px" }}>댓글 {detailPost.comments.length}</p>
              {detailPost.comments.map((c) => (
                <div key={c.id} style={{ display: "flex", gap: "10px", marginBottom: "14px", alignItems: "flex-start" }}>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/profile/${encodeURIComponent(c.user)}?from=detail&postId=${encodeURIComponent(detailPost.id)}`,
                      )
                    }
                    style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, flexShrink: 0 }}
                  >
                    <ProfileAvatar avatarUrl={c.avatarUrl} username={c.user} size={30} fontSize={12} />
                  </button>
                  <div style={{ flex: 1, background: "#f8f8fc", borderRadius: "10px", padding: "8px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/profile/${encodeURIComponent(c.user)}?from=detail&postId=${encodeURIComponent(detailPost.id)}`,
                          )
                        }
                        style={{ fontSize: "12px", fontWeight: 600, color: "#1a1a2e", border: "none", background: "transparent", cursor: "pointer", padding: 0 }}
                      >
                        {c.user}
                      </button>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "10px", color: "#bbb" }}>{timeAgo(c.createdAt)}</span>
                        {c.user === MY_USERNAME && <button onClick={(e) => { e.stopPropagation(); deleteComment(detailPost.id, c.id); }} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ccc", fontSize: "13px", padding: 0, lineHeight: 1 }}>×</button>}
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: "13px", color: "#444", lineHeight: 1.5 }}>{c.text}</p>
                  </div>
                </div>
              ))}
              {detailPost.comments.length === 0 && <p style={{ fontSize: "12px", color: "#ccc", textAlign: "center", padding: "10px 0" }}>첫 댓글을 남겨보세요 💬</p>}
            </div>
            <div ref={commentSectionRef} aria-hidden style={{ height: 1, flexShrink: 0 }} />
          </div>
          <div
            className="detailPostCommentComposer"
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: keyboardHeight,
              zIndex: 80,
              paddingBottom: keyboardHeight > 0 ? 8 : "max(10px, env(safe-area-inset-bottom, 0px))",
            }}
          >
            <input
              ref={commentInputRef}
              className="detailPostCommentInput"
              placeholder="댓글 달기..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onFocus={() => {
                commentInputFocusedRef.current = true;
                scheduleScrollToCommentSection();
              }}
              onBlur={() => {
                commentInputFocusedRef.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  addComment(detailPost.id);
                }
              }}
            />
            <button
              className="detailPostCommentSubmit"
              type="button"
              disabled={!newComment.trim()}
              onClick={() => addComment(detailPost.id)}
            >
              게시
            </button>
          </div>
          {lightboxImg && <div onClick={() => setLightboxImg(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999999, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center" }}><img src={lightboxImg} style={{ maxWidth: "95%", maxHeight: "90vh", objectFit: "contain", borderRadius: "4px" }} /></div>}
          {courseModalLayerEl}
          {courseShareModalEl}
          {sharePostModalEl}
          {notificationModalEl}
        </section>
      </main>
      </>
    );
  }

  return (
    <>
    {showPlaceExtractionToast && (
      <div
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          left: "16px",
          right: "16px",
          zIndex: 100001,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            maxWidth: "560px",
            width: "100%",
            background: "rgba(26, 42, 122, 0.96)",
            color: "#fff",
            borderRadius: "14px",
            boxShadow: "0 10px 28px rgba(17, 24, 39, 0.28)",
            padding: "12px 14px",
            fontSize: "13px",
            lineHeight: 1.45,
            letterSpacing: "0.1px",
          }}
        >
          📍 릴스 또는 게시물 캡션에 장소 정보가 기재되어있는지 확인해주세요
        </div>
      </div>
    )}
    <main className="mobileRoot">
      <section className="phoneFrame">
        <section className={`appContent${tabBarHiddenByKeyboard ? " keyboardOpenContent" : ""}`}>
          {lightboxImg && <div onClick={() => setLightboxImg(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999999, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center" }}><img src={lightboxImg} style={{ maxWidth: "95%", maxHeight: "90vh", objectFit: "contain", borderRadius: "4px" }} /></div>}

          {editingPost && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 99999,
                background: "rgba(0,0,0,0.4)",
                display: "flex",
                alignItems: "flex-end",
                paddingBottom: keyboardHeight > 0 ? keyboardHeight : 0,
                transition: "padding-bottom 0.25s ease",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  background: "#fff",
                  width: "100%",
                  borderRadius: "20px 20px 0 0",
                  padding: keyboardHeight > 0 ? "24px 20px 16px" : "24px 20px 40px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>코멘트 수정</span>
                  <button onClick={() => setEditingPost(null)} style={{ border: "none", background: "transparent", fontSize: "20px", color: "#bbb", cursor: "pointer" }}>×</button>
                </div>
                <div style={{ padding: "10px 12px", background: "#f8f8fc", borderRadius: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "16px" }}>{CATEGORY_PIN[editingPost.category].emoji}</span>
                  <p style={{ margin: 0, fontSize: "13px", color: "#1a2a7a" }}>{editingPost.placeName}</p>
                </div>
                <textarea value={editComment} onChange={(e) => setEditComment(e.target.value)} rows={5} style={{ width: "100%", border: "0.5px solid #ddd", borderRadius: "4px", padding: "10px 12px", fontSize: "13px", fontFamily: "inherit", resize: "none", outline: "none", boxSizing: "border-box", color: "#333" }} />
                <button className="primaryButton" type="button" disabled={!editComment.trim()} onClick={submitEdit} style={{ width: "100%", padding: "14px", fontSize: "14px", letterSpacing: "1px" }}>수정 완료</button>
              </div>
            </div>
          )}

          {courseModalLayerEl}

          <NewCurationScreen
            open={showPostModal}
            onClose={closePostScreen}
            onExited={resetPostForm}
            onSubmit={() => { void handleSubmitPost(); }}
            canPost={canPost}
            validationHint={postValidationHint}
            title={postTitle}
            onTitleChange={setPostTitle}
            categories={postCategories}
            onCategoriesChange={setPostCategories}
            onCategoryToggle={togglePostCategory}
            categoryMainOrder={CATEGORY_MAIN_ORDER}
            categoryPin={CATEGORY_PIN}
            categoryColors={CATEGORY_COLORS}
            images={postImages}
            onImagesChange={setPostImages}
            onImageUpload={handleImageUpload}
            onRetryImage={retryPostImageUpload}
            photoPlaceTags={postPhotoPlaceTags}
            onPhotoPlaceTagsChange={setPostPhotoPlaceTags}
            companionTag={postCompanionTag}
            onCompanionTagChange={setPostCompanionTag}
            comment={postComment}
            onCommentChange={setPostComment}
            saveCourseChecked={postSaveCourseChecked}
            onSaveCourseCheckedChange={setPostSaveCourseChecked}
            courseTitle={postCourseTitle}
            onCourseTitleChange={setPostCourseTitle}
          />

          {activeTab === "home" && (
            <div className="screen homeFeed">
              <div className="homeFeedScroll">
              {!loading && !homeLoadError && (
                <div className="homeFeedStickyBar">
                  <HomeFeedTopBar
                    searchQuery={homeSearchQuery}
                    onSearchChange={setHomeSearchQuery}
                    onOpenSearch={openHomeSearch}
                    unreadNotificationCount={unreadNotificationCount}
                    onNotificationsClick={() => setShowNotifications(true)}
                    onAddClick={() => setShowPostModal(true)}
                  />
                  <div className="homeFeedChipsBar">
                    <CompanionTagFilterChips
                      value={selectedCompanionTag}
                      onChange={setSelectedCompanionTag}
                    />
                    <HomeCategoryFilterChips
                      value={selectedHomeCategory}
                      onChange={setSelectedHomeCategory}
                    />
                  </div>
                </div>
              )}
              {homeLoadError && !loading && (
                <div style={{ minHeight: "45vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", padding: "14px 10px" }}>
                  <p style={{ margin: 0, fontSize: "14px", color: "#56607a", textAlign: "center", lineHeight: 1.6 }}>{homeLoadError}</p>
                  <button
                    type="button"
                    onClick={retryHomeLoad}
                    disabled={homeRetrying}
                    style={{ minWidth: "190px", padding: "13px 18px", borderRadius: "12px", border: "none", background: "#1a2a7a", color: "#fff", fontSize: "14px", fontWeight: 600, cursor: homeRetrying ? "wait" : "pointer", fontFamily: "inherit", boxShadow: "0 8px 20px rgba(26,42,122,0.24)", opacity: homeRetrying ? 0.8 : 1 }}
                  >
                    {homeRetrying ? "다시 연결 중..." : "다시 시도"}
                  </button>
                </div>
              )}
              {loading && <FeedSkeleton variant="grid" columns={2} />}
              {!loading && !homeLoadError && visibleFeedPosts.length === 0 && (
                <EmptyState
                  variant="feed"
                  icon="✍️"
                  title="아직 큐레이션이 없어요"
                  description="상단 + 버튼을 눌러 첫 번째 장소를 추가해보세요"
                  action={{ label: "큐레이션 작성하기", onClick: () => setShowPostModal(true) }}
                />
              )}
              {!loading && !homeLoadError && visibleFeedPosts.length > 0 && filteredHomeFeedPosts.length === 0 && (
                <EmptyState
                  variant="feed"
                  icon="🔍"
                  title={
                    selectedHomeCategory !== "all"
                      ? `아직 ${selectedHomeCategory} 큐레이션이 없어요`
                      : `아직 ${companionFilterChipLabel(selectedCompanionTag)} 큐레이션이 없어요`
                  }
                  description="다른 필터를 선택하거나 새 큐레이션을 올려보세요"
                />
              )}
              {filteredHomeFeedPosts.length > 0 && (
                <PostGrid columns={2} className="homeFeedGrid">
                  {filteredHomeFeedPosts.map((post) => (
                    <PostGridCell
                      key={post.id}
                      variant="home"
                      imageUrl={post.images[0]}
                      titleLine={(post.title || post.comment || post.placeName || "").trim()}
                      placeName={post.placeName}
                      address={post.address}
                      likeCount={post.likes_count}
                      imageCount={post.images.length}
                      showUsername
                      showMultiIcon
                      username={post.user}
                      onProfileClick={() =>
                        router.push(`/profile/${encodeURIComponent(post.user)}?from=feed`)
                      }
                      onClick={() => setDetailPostId(post.id)}
                    />
                  ))}
                </PostGrid>
              )}
              </div>
            </div>
          )}

          {activeTab === "messages" && (
  <div
    className={activeChatRoom ? "screen messagesChatShell" : "screen"}
    style={{
      paddingTop: "env(safe-area-inset-top, 0px)",
      boxSizing: "border-box",
      ...(activeChatRoom ? { display: "flex", flexDirection: "column", minHeight: 0, flex: 1 } : {}),
    }}
  >
    {activeChatRoom ? (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px 14px", borderBottom: "0.5px solid #f0f0f0", flexShrink: 0 }}>
          <button onClick={() => { resetWindowScrollAfterChatKeyboard(); setActiveChatRoom(null); }} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0 }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!activeChatRoom) return;
              if (user?.id && activeChatRoom.friendId === user.id) {
                router.push("/?tab=mypage");
                return;
              }
              router.push(
                `/profile/${encodeURIComponent(activeChatRoom.friendName)}?fromChat=${encodeURIComponent(activeChatRoom.id)}`,
              );
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flex: 1,
              minWidth: 0,
              minHeight: 40,
              padding: "6px 10px",
              marginLeft: -2,
              border: "none",
              borderRadius: 10,
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              WebkitTapHighlightColor: "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f4f5f9";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.background = "#eceef4";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.background = "#f4f5f9";
            }}
          >
            <ProfileAvatar avatarUrl={activeChatRoom.friendAvatarUrl} username={activeChatRoom.friendName} size={32} fontSize={13} />
            <span
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: "16px",
                color: "#1a2a7a",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeChatRoom.friendName}
            </span>
          </button>
        </div>
        <div
          ref={chatMessagesContainerRef}
          onScroll={handleChatMessagesScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            padding: "8px 16px",
            paddingBottom:
              keyboardHeight > 0
                ? `calc(8px + 52px + ${keyboardHeight}px)`
                : "calc(8px + 52px + env(safe-area-inset-bottom, 0px))",
            transition: "padding-bottom 0.25s ease",
          }}
        >
          {chatRoomLoading && messages.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "24px 12px" }}>
              <div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%" }} aria-hidden />
              <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>대화 불러오는 중...</p>
            </div>
          )}
          {!chatRoomLoading && chatLoadingOlder && (
            <p style={{ textAlign: "center", color: "#aaa", fontSize: "11px", padding: "4px 0", margin: 0 }}>이전 메시지 불러오는 중...</p>
          )}
          {!chatRoomLoading && !chatLoadingOlder && chatOlderHasMore && (
            <button
              type="button"
              onClick={() => void loadOlderMessages()}
              style={{
                alignSelf: "center",
                marginBottom: "4px",
                padding: "6px 12px",
                fontSize: "11px",
                borderRadius: "999px",
                border: "0.5px solid #d9deec",
                background: "#fbfcff",
                color: "#1a2a7a",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              이전 메시지 더보기
            </button>
          )}
          {messages.map(m => {
            const isMine = m.senderId === MY_USER;
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start", alignItems: "flex-end", gap: "4px" }}>
                {isMine && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: "10px", color: "#bbb", lineHeight: 1.3 }}>
                    {!m.read && <span style={{ color: "#1a2a7a", fontWeight: 600 }}>1</span>}
                    {m.status === "pending" && <span style={{ color: "#9aa1bc" }}>전송 중...</span>}
                    {m.status === "failed" && <span style={{ color: "#e07070", fontWeight: 600 }}>전송 실패</span>}
                    <span>{formatTime(m.createdAt)}</span>
                  </div>
                )}
                <div style={{ maxWidth: "70%", padding: "8px 12px", borderRadius: isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: isMine ? "#1a2a7a" : "#f0f0f5", color: isMine ? "#fff" : "#333", fontSize: "13px", lineHeight: 1.5, whiteSpace: "pre-wrap" as any, opacity: m.status === "pending" ? 0.75 : 1 }}>
                  {(() => {
                    const shareMatch = m.text.match(/\[share:([^\]]+)\]/);
                    if (shareMatch) {
                      const sharedPostId = shareMatch[1];
                      const cleanText = m.text.replace(/\[share:[^\]]+\]/, "").trim();
                      return (
                        <>
                          <span>{cleanText}</span>
                          <button
                            type="button"
                            onClick={() => {
                              resetWindowScrollAfterChatKeyboard();
                              setActiveChatRoom(null);
                              setDetailPostId(sharedPostId);
                            }}
                            style={{
                              display: "block",
                              marginTop: "8px",
                              padding: "6px 10px",
                              background: isMine ? "rgba(255,255,255,0.2)" : "#fff",
                              border: isMine ? "1px solid rgba(255,255,255,0.3)" : "1px solid #1a2a7a",
                              borderRadius: "6px",
                              color: isMine ? "#fff" : "#1a2a7a",
                              fontSize: "11px",
                              fontWeight: 500,
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            📍 큐레이션 열어보기
                          </button>
                        </>
                      );
                    }
                    const courseMatch = m.text.match(/\[course:([^\]]+)\]/);
                    if (courseMatch) {
                      const sharedCourseId = courseMatch[1]!;
                      const cleanText = m.text.replace(/\[course:[^\]]+\]/, "").trim();
                      return (
                        <ChatCourseCard
                          courseId={sharedCourseId}
                          cleanText={cleanText}
                          isMine={isMine}
                          currentUserId={MY_USER}
                          ensureCourseLoaded={ensureCourseLoaded}
                          onOpenCourse={(course, readOnly) => {
                            resetWindowScrollAfterChatKeyboard();
                            setActiveChatRoom(null);
                            openSavedCourse(course, { readOnly });
                          }}
                        />
                      );
                    }
                    return m.text;
                  })()}
                  {isMine && m.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => { void resendFailedMessage(m); }}
                      style={{ display: "block", marginTop: "8px", padding: "4px 8px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.2)", color: "#fff", fontSize: "11px", fontFamily: "inherit", cursor: "pointer" }}
                    >
                      재전송
                    </button>
                  )}
                </div>
                {!isMine && (
                  <span style={{ fontSize: "10px", color: "#bbb", lineHeight: 1.3 }}>{formatTime(m.createdAt)}</span>
                )}
              </div>
            );
          })}
          {!chatRoomLoading && messages.length === 0 && <p style={{ textAlign: "center", color: "#bbb", fontSize: "12px", marginTop: "40px" }}>첫 메시지를 보내보세요 💬</p>}
        </div>
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: keyboardHeight,
            zIndex: 80,
            boxSizing: "border-box",
            paddingLeft: "max(12px, env(safe-area-inset-left, 0px))",
            paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
            paddingTop: 6,
            paddingBottom: keyboardHeight > 0 ? 8 : "max(8px, env(safe-area-inset-bottom, 0px))",
            transition: "bottom 0.25s ease",
            background: "#eceef2",
            borderTop: "0.5px solid #dfe2e8",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <input
            ref={chatComposerInputRef}
            placeholder="메시지 입력..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void sendMessage();
            }}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 40,
              maxHeight: 120,
              padding: "10px 16px",
              borderRadius: 22,
              border: "none",
              background: "#f5f6f8",
              fontSize: "15px",
              outline: "none",
              fontFamily: "inherit",
              color: "#1a1a1a",
              boxSizing: "border-box",
            }}
          />
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onClick={() => {
              void sendMessage();
            }}
            disabled={!newMessage.trim()}
            aria-label="전송"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "none",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: newMessage.trim() ? "pointer" : "not-allowed",
              background: newMessage.trim() ? "#3182F6" : "#c9ccd4",
              color: "#fff",
              fontSize: "17px",
              fontWeight: 600,
              lineHeight: 1,
              padding: 0,
              fontFamily: "inherit",
              opacity: newMessage.trim() ? 1 : 0.85,
            }}
          >
            ↑
          </button>
        </div>
      </>
    ) : (
      <div
        className="messagesListScreen"
        style={{
          paddingBottom: keyboardHeight > 0 ? `${keyboardHeight + 8}px` : undefined,
          transition: "padding-bottom 0.25s ease",
        }}
      >
        <div className="messagesListHeader">
          <p className="screenTitle" style={{ margin: 0 }}>메시지</p>
          <button
            type="button"
            onClick={() => setShowNotifications(true)}
            aria-label="알림"
            style={{
              position: "relative",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {unreadNotificationCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: "0px",
                  right: "0px",
                  background: "#e53935",
                  color: "#fff",
                  fontSize: "10px",
                  fontWeight: 600,
                  borderRadius: "10px",
                  minWidth: "16px",
                  height: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 4px",
                }}
              >
                {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
              </span>
            )}
          </button>
        </div>
        <div className="messagesUserSearchSticky">
          <div className="messagesUserSearchWrap">
            <input
              ref={messageUserSearchInputRef}
              type="search"
              className="messagesUserSearchInput"
              placeholder="친구 검색"
              value={messageUserSearchQuery}
              onChange={(e) => setMessageUserSearchQuery(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="친구 검색"
            />
            {messageUserSearchQuery.length > 0 && (
              <button
                type="button"
                className="messagesUserSearchClear"
                onClick={clearMessageUserSearch}
                aria-label="검색어 지우기"
              >
                ×
              </button>
            )}
          </div>
        </div>
        {messageUserSearchQuery.trim() ? (
          <div className="messagesUserSearchResults">
            {messageUserSearchLoading && (
              <p className="messagesUserSearchLoading">검색 중...</p>
            )}
            {!messageUserSearchLoading && messageUserSearchResults.length === 0 && (
              <p className="messagesUserSearchEmpty">검색 결과가 없어요</p>
            )}
            {!messageUserSearchLoading &&
              messageUserSearchResults.map((hit) => (
                <MessageUserSearchRow
                  key={hit.id}
                  hit={hit}
                  followLoading={messageUserSearchFollowLoadingId === hit.id}
                  onOpenProfile={openMessageSearchProfile}
                  onToggleFollow={toggleMessageSearchFollow}
                />
              ))}
          </div>
        ) : (
          <>
            {chatRooms.length === 0 && (
              <EmptyState
                icon="💌"
                title="아직 메시지가 없어요"
                description="위에서 친구를 검색해 첫 대화를 시작해보세요"
                action={{
                  label: "친구 검색하기",
                  onClick: () => messageUserSearchInputRef.current?.focus(),
                }}
              />
            )}
            {chatRooms.map((room) => (
              <article
                key={room.id}
                className="chatItem"
                onClick={() => openChat(room)}
                style={{ cursor: "pointer" }}
              >
                <ProfileAvatar avatarUrl={room.friendAvatarUrl} username={room.friendName} size={38} className="avatar" />
                <div className="chatBody">
                  <p className="chatName">{room.friendName}</p>
                  <p className="chatPreview">{room.lastMessage || "대화를 시작해보세요"}</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                  <span className="chatTime">{room.lastTime ? timeAgo(room.lastTime) : ""}</span>
                  {room.unreadCount > 0 && (
                    <span
                      style={{
                        background: "#e05555",
                        color: "#fff",
                        borderRadius: "10px",
                        minWidth: "18px",
                        height: "18px",
                        padding: "0 6px",
                        fontSize: "10px",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {room.unreadCount}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </>
        )}
      </div>
    )}
  </div>
)}

          <div
            className="screen screenMapTab"
            style={{
              display: activeTab === "map" ? "flex" : "none",
              flexDirection: "column",
              paddingTop: "env(safe-area-inset-top, 0px)",
              boxSizing: "border-box",
            }}
          >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p className="screenTitle" style={{ marginBottom: 0 }}>지도</p>
                {activeJobs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowJobsModal(true)}
                    style={{ border: "0.5px solid #d9deec", borderRadius: "999px", background: "#f7f9ff", color: "#1a2a7a", fontSize: "11px", padding: "5px 10px", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    분석 중인 작업: {activeJobs.length}개
                  </button>
                )}
              </div>
              {showJobsModal && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end" }}>
                  <div style={{ width: "100%", background: "#fff", borderRadius: "18px 18px 0 0", padding: "18px 16px 24px", maxHeight: "62vh", overflowY: "auto" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                      <p style={{ margin: 0, fontFamily: "'Playfair Display', serif", color: "#1a2a7a", fontSize: "18px" }}>분석 작업 상태</p>
                      <button type="button" onClick={() => setShowJobsModal(false)} style={{ border: "none", background: "transparent", color: "#bbb", cursor: "pointer", fontSize: "20px" }}>×</button>
                    </div>
                    {activeJobs.length === 0 && <p style={{ margin: 0, fontSize: "12px", color: "#aaa", textAlign: "center", padding: "16px 0" }}>진행 중인 작업이 없어요</p>}
                    {activeJobs.map((job) => (
                      <article key={job.jobId} style={{ border: "0.5px solid #eceff7", borderRadius: "10px", padding: "10px 12px", marginBottom: "8px", background: "#fafbff" }}>
                        <p style={{ margin: 0, fontSize: "11px", color: "#8b93aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.instagramUrl}</p>
                        <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#1a2a7a" }}>{job.progressStep || "대기 중"}</p>
                      </article>
                    ))}
                  </div>
                </div>
              )}
              <div className="mapInputWrap">
                <input className="mapInput" placeholder="Instagram 릴스/게시물 URL 붙여넣기" value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} />
                <button className="primaryButton" onClick={handleAddFromInstagram} type="button" disabled={!canSubmit}>{isSubmitting ? "분석 중..." : "핀 추가"}</button>
              </div>
              {isAnalyzing && (
                <div style={{ marginTop: "6px" }}>
                  <p style={{ margin: 0, color: "#1a2a7a", fontSize: "12px" }}>{analyzingMainText}</p>
                  <p style={{ margin: "3px 0 0", color: "#888", fontSize: "11px" }}>{analyzingSubText}</p>
                </div>
              )}
              {!isAnalyzing && status && <p className="hintText">{status}</p>}
              {error && <p className="emptyText">{error}</p>}
              {kakaoStatus === "loading" && <p className="hintText">카카오맵 SDK를 불러오는 중입니다</p>}
              {kakaoStatus === "error" && <p className="emptyText">카카오맵 로딩에 실패했습니다.</p>}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", marginBottom: "6px" }}>
                <button onClick={() => setMapExpanded(true)} style={{ background: "transparent", border: "0.5px solid #ddd", borderRadius: "4px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#1a2a7a", letterSpacing: "0.5px", fontFamily: "'Inter', sans-serif" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 5V1H5M7 1H11V5M11 7V11H7M5 11H1V7" stroke="#1a2a7a" strokeWidth="1.2" strokeLinecap="round"/></svg>전체화면
                </button>
                <button
                  type="button"
                  onClick={() => setHiddenIds(new Set(savedPlaces.map((p) => p.id)))}
                  disabled={savedPlaces.length === 0}
                  style={{ background: "transparent", border: "0.5px solid #ddd", borderRadius: "4px", padding: "6px 12px", cursor: savedPlaces.length === 0 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#1a2a7a", letterSpacing: "0.5px", fontFamily: "'Inter', sans-serif", opacity: savedPlaces.length === 0 ? 0.5 : 1 }}
                >
                  🗑️ 검색기록 삭제
                </button>
              </div>
              <div style={{ position: "relative", width: "100%", minHeight: 220 }}>
                {(kakaoStatus === "idle" || kakaoStatus === "loading" || (kakaoStatus === "ready" && !compactMapReady)) && (
                  <div
                    aria-hidden={compactMapReady}
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 4,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "10px",
                      background: "linear-gradient(180deg, #f7f9ff 0%, #eef1fb 100%)",
                      border: "0.5px solid #e4e9f7",
                      borderRadius: "8px",
                      minHeight: 220,
                    }}
                  >
                    <span style={{ fontSize: "28px", lineHeight: 1 }}>🗺️</span>
                    <p style={{ margin: 0, fontSize: "13px", color: "#1a2a7a", fontWeight: 600, letterSpacing: "0.3px" }}>지도를 불러오는 중...</p>
                    <p style={{ margin: 0, fontSize: "11px", color: "#7a849e", textAlign: "center", paddingInline: "12px" }}>
                      {kakaoStatus !== "ready" ? "카카오맵 SDK를 불러오고 있어요" : "지도를 그리고 있어요"}
                    </p>
                  </div>
                )}
                <div
                  ref={mapContainerRef}
                  className="kakaoMap"
                  style={{ position: "relative", zIndex: 1 }}
                />
              </div>
              {mapExpanded &&
                !isNativeMapAvailable() &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="전체 지도"
                    style={{
                      position: "fixed",
                      inset: 0,
                      zIndex: 200000,
                      background: "#fff",
                      display: "flex",
                      flexDirection: "column",
                      boxSizing: "border-box",
                      paddingTop: "env(safe-area-inset-top, 0px)",
                      paddingBottom: "env(safe-area-inset-bottom, 0px)",
                      paddingLeft: "env(safe-area-inset-left, 0px)",
                      paddingRight: "env(safe-area-inset-right, 0px)",
                    }}
                  >
                    <div
                      className="fullscreenMapHeaderRow"
                      style={{
                        borderBottom: "0.5px solid #efefef",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        background: "#fff",
                        position: "relative",
                        flexShrink: 0,
                        minHeight: 48,
                      }}
                    >
                      <button
                        type="button"
                        aria-label="전체 지도 닫기"
                        onClick={() => {
                          if (returnToCourseSheetRef.current) {
                            returnToCourseSheetRef.current = false;
                            setMapExpanded(false);
                            clearRoute();
                            setShowCourseRoute(false);
                            setShowCourseModal(true);
                            return;
                          }
                          setMapExpanded(false);
                          setSelectedPlace(null);
                        }}
                        style={{
                          position: "absolute",
                          left: "max(12px, env(safe-area-inset-left, 0px))",
                          top: "50%",
                          transform: "translateY(-50%)",
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: 44,
                          minHeight: 44,
                          padding: 0,
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden>
                          <path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>PindMap</span>
                    </div>
                    <div
                      style={{
                        padding: "12px 20px",
                        paddingLeft: "max(20px, env(safe-area-inset-left, 0px))",
                        paddingRight: "max(20px, env(safe-area-inset-right, 0px))",
                        borderBottom: "0.5px solid #efefef",
                        display: "flex",
                        gap: "8px",
                        background: "#fff",
                        flexShrink: 0,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
                        <input
                          className="mapInput"
                          placeholder="장소명으로 검색"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                          style={{ flex: 1, paddingRight: searchQuery.trim() || mapSearchResults.length > 0 ? 36 : undefined }}
                        />
                        {(searchQuery.trim() || mapSearchResults.length > 0) && (
                          <button
                            type="button"
                            aria-label="검색 지우기"
                            onClick={handleClearMapSearch}
                            style={{
                              position: "absolute",
                              right: 8,
                              border: "none",
                              background: "transparent",
                              color: "#999",
                              fontSize: 18,
                              cursor: "pointer",
                              width: 28,
                              height: 28,
                              lineHeight: 1,
                              padding: 0,
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <button className="primaryButton" onClick={handleSearch} type="button" disabled={!searchQuery.trim()} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "0 16px", flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <circle cx="6" cy="6" r="4.5" stroke="white" strokeWidth="1.3" />
                          <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                      </button>
                      {isNativeMapAvailable() && (
                        <button
                          type="button"
                          className={
                            expandedNativeMapEnabled
                              ? "expandedNativeMapToggle expandedNativeMapToggleOn"
                              : "expandedNativeMapToggle"
                          }
                          aria-pressed={expandedNativeMapEnabled}
                          title="Kakao Native 지도 (상단 50%)"
                          onClick={() => setExpandedNativeMapEnabled((on) => !on)}
                          style={{ flexShrink: 0 }}
                        >
                          {expandedNativeMapEnabled ? "Native ON" : "Native"}
                        </button>
                      )}
                    </div>
                    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                      <div ref={mapExpandedRef} className="kakaoMap" style={{ width: "100%", height: "100%", touchAction: "manipulation" }} />
                      {expandedNativeMapEnabled && isNativeMapAvailable() && (
                        <>
                          <div id="extended-map-slot" className="extendedNativeMapSlot" aria-hidden />
                          <div className="extendedNativeMapDivider" aria-hidden />
                          <span className="extendedNativeMapBadge">Kakao Native · 상단 50%</span>
                        </>
                      )}
                      <MapResearchAreaButton visible={showMapResearchButton} onResearch={handleResearchThisArea} />
                      {selectedPlace && renderPlaceCard()}
                      {isMapSearchSheetOpen && mapSearchResults.length > 0 && (
                        <MapSearchResultsSheet
                          open={isMapSearchSheetOpen}
                          queryLabel={mapSearchLabel}
                          results={mapSearchResults}
                          userLocation={myLocationLatLngRef.current}
                          keyboardHeight={keyboardHeight}
                          onSelect={(place) => {
                            const py = parseFloat(String(place.y ?? ""));
                            const px = parseFloat(String(place.x ?? ""));
                            if (Number.isFinite(py) && Number.isFinite(px)) {
                              applyExpandedMapCameraLatLng(py, px, 3);
                            }
                            openExpandedSearchPlaceCard(place, "sheet-list-tap");
                          }}
                          onClose={() => setIsMapSearchSheetOpen(false)}
                        />
                      )}
                    </div>
                  </div>,
                  document.body,
                )}
              <div className="miniList">
                {savedPlaces.filter(p => !hiddenIds.has(p.id)).map((place) => (
                  <article key={place.id} className="miniItem" onClick={() => handleMiniListClick(place)} style={{ cursor: "pointer" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: CATEGORY_COLORS[place.category], flexShrink: 0, display: "inline-block" }} />
                    <div style={{ flex: 1 }}><p className="miniName">{place.name}</p><p className="miniMeta">{place.address} · {place.category}</p></div>
                    <button onClick={(e) => { e.stopPropagation(); hideFromMap(place.id); }} type="button" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ccc", fontSize: "16px", padding: "0 4px", lineHeight: 1, flexShrink: 0 }}>×</button>
                  </article>
                ))}
                {savedPlaces.filter(p => !hiddenIds.has(p.id)).length === 0 && savedPlaces.length > 0 && (<p className="hintText" style={{ textAlign: "center" }}>모든 장소가 숨겨졌어요.{" "}<button onClick={resetHiddenPlaces} style={{ border: "none", background: "none", color: "#1a2a7a", cursor: "pointer", fontSize: "12px", textDecoration: "underline" }}>다시 보기</button></p>)}
                {savedPlaces.length === 0 && <p className="emptyText">아직 핀이 없습니다. URL을 입력해 시작해보세요.</p>}
              </div>
          </div>

          {activeTab === "saved" && (
  <div className="screen" style={{ paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "border-box" }}>
  <div
    style={{
      paddingBottom: keyboardHeight > 0 ? keyboardHeight : 0,
      transition: "padding-bottom 0.25s ease",
      boxSizing: "border-box",
    }}
  >
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
    <p className="screenTitle" style={{ margin: 0 }}>저장한 장소</p>
    {savedPlaces.length > 0 && (
      <button
        type="button"
        onClick={() => {
          setShowCourseModal(true);
          setCourseResult(null);
          viewingSavedCourseIdRef.current = null;
          setViewedCourseUserId(null);
          setIsReadOnlyCourse(false);
          setCourseCounts({ 카페: 0, 맛집: 0, 쇼핑: 0, 숙소: 0, 놀거리: 0, 여행지: 0 });
        }}
        style={{
          border: "1px solid #1a2a7a",
          background: "#fff",
          color: "#1a2a7a",
          borderRadius: "20px",
          padding: "6px 14px",
          fontSize: "12px",
          cursor: "pointer",
          fontFamily: "inherit",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        🗺️ 코스 만들기
      </button>
    )}
  </div>
  {savedPlaces.length === 0 && (
  <EmptyState
    icon="🔖"
    title="저장한 장소가 없어요"
    description="지도에서 마음에 드는 장소를 저장해보세요"
    action={{ label: "지도 보러가기", onClick: () => setActiveTab("map") }}
  />
)}
    {savedPlaces.length > 0 && (
      <div style={{ position: "relative", marginBottom: "16px" }}>
        <input
          className="mapInput"
          placeholder="🔍 지역, 장소명으로 검색 (예: 마포구)"
          value={savedSearchQuery}
          onChange={(e) => setSavedSearchQuery(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", paddingRight: savedSearchQuery ? "32px" : undefined }}
        />
        {savedSearchQuery && (
          <button
            type="button"
            onClick={() => setSavedSearchQuery("")}
            style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: "#bbb", fontSize: "16px", cursor: "pointer", padding: "0 4px" }}
          >×</button>
        )}
      </div>
    )}
    {savedPlaces.length > 0 && (() => {
      // 검색어로 필터링
      const q = savedSearchQuery.trim().toLowerCase();
      const filtered = q
        ? savedPlaces.filter(p => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
        : savedPlaces;
      if (filtered.length === 0) {
        return <p className="emptyText" style={{ textAlign: "center" }}>"{savedSearchQuery}"에 해당하는 장소가 없어요.</p>;
      }
      // 1차: 지역별로 그룹
      const regions = new Map<string, Place[]>();
      filtered.forEach(p => {
        const region = extractRegion(p.address);
        if (!regions.has(region)) regions.set(region, []);
        regions.get(region)!.push(p);
      });
      const sorted = Array.from(regions.entries()).sort((a, b) => a[0].localeCompare(b[0], "ko"));
      return sorted.map(([region, regionPlaces]) => (
        <div key={region} style={{ marginBottom: "28px" }}>
          {/* 지역 헤더 */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px", padding: "0 4px", borderBottom: "1px solid #eee", paddingBottom: "10px" }}>
            <span style={{ fontSize: "16px" }}>📍</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#1a2a7a", letterSpacing: "0.5px" }}>{region}</span>
            <span style={{ fontSize: "11px", color: "#bbb", marginLeft: "4px" }}>{regionPlaces.length}</span>
          </div>
          {/* 2차: 지역 안에서 카테고리별 소그룹 */}
          {CATEGORY_MAIN_ORDER.map(cat => {
            const places = regionPlaces.filter(p => p.category === cat);
            if (places.length === 0) return null;
            return (
              <div key={cat} style={{ marginBottom: "16px", paddingLeft: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "13px" }}>{CATEGORY_PIN[cat].emoji}</span>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: CATEGORY_COLORS[cat], letterSpacing: "0.5px" }}>{cat}</span>
                  <span style={{ fontSize: "10px", color: "#bbb" }}>{places.length}</span>
                </div>
                {places.map(place => (
                  <article key={place.id} className="savedItem" style={{ cursor: "pointer", borderLeft: `3px solid ${CATEGORY_COLORS[cat]}`, paddingLeft: "12px", marginBottom: "2px" }} onClick={() => handleSavedPlaceClick(place)}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: CATEGORY_COLORS[cat], flexShrink: 0, display: "inline-block" }} />
                    <div className="savedBody">
                      <p className="savedName">{place.name}</p>
                      <p className="savedMeta">{place.address}</p>
                    </div>
                    <button className="ghostButton" type="button" onClick={(e) => { e.stopPropagation(); deletePlace(place.id); }}>삭제</button>
                  </article>
                ))}
              </div>
            );
          })}
        </div>
      ));
    })()}
  </div>
  </div>
)}

          {activeTab === "mypage" && (
            <div
              className="screen"
              style={{
                padding: 0,
                paddingTop: "env(safe-area-inset-top, 0px)",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                boxSizing: "border-box",
              }}
            >
              <div style={{ flexShrink: 0, padding: "12px 16px 0", position: "relative", boxSizing: "border-box" }}>
                <button
                  type="button"
                  onClick={() => setShowMypageSettingsSheet(true)}
                  aria-label="설정"
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 8,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    padding: 0,
                    width: 40,
                    height: 40,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#262626",
                  }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 28, paddingRight: 40 }}>
                  <ProfileAvatar
                    avatarUrl={user?.avatar_url}
                    username={user?.username ?? ""}
                    size={90}
                    fontSize={36}
                  />
                  <div style={{ flex: 1, display: "flex", justifyContent: "space-around", textAlign: "center" }}>
                    {(
                      [
                        { label: "게시", value: myMypagePosts.length },
                        { label: "팔로워", value: mypageFollowerCount },
                        { label: "팔로잉", value: mypageFollowingCount },
                      ] as const
                    ).map((stat) => (
                      <button
                        key={stat.label}
                        type="button"
                        onClick={() => {
                          if (stat.label === "팔로워") setShowFollowList("followers");
                          else if (stat.label === "팔로잉") setShowFollowList("following");
                          else showToast("준비 중이에요", "info");
                        }}
                        style={{
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          padding: "4px 8px",
                          fontFamily: "inherit",
                        }}
                      >
                        <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a1a2e" }}>{stat.value}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: "#8f93a6" }}>{stat.label}</p>
                      </button>
                    ))}
                  </div>
                </div>
                {(user?.total_likes_received ?? 0) > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: "#555",
                      fontWeight: 400,
                    }}
                  >
                    <span>❤️</span>
                    <span>총 {user!.total_likes_received.toLocaleString()}개의 좋아요를 받았어요</span>
                  </div>
                )}
                <div style={{ paddingBottom: 12, borderBottom: "0.5px solid #efefef" }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#1a1a2e" }}>{user?.username || ""}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8f93a6" }}>@{user?.username || ""}_travelnote</p>
                  {user?.bio && (
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 14,
                        color: "#4a4a4a",
                        lineHeight: 1.45,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {user.bio}
                    </p>
                  )}
                </div>
              </div>
              <div className="mypageTabScroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#fff" }}>
                {myCourses.length > 0 && (
                  <section style={{ padding: "0 16px", marginBottom: 16 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600, color: "#000" }}>내 코스</span>
                      <span style={{ fontSize: 12, color: "#999" }}>전체 {myCourses.length}</span>
                    </div>
                    <div
                      className="myCoursesScroll"
                      style={{
                        display: "flex",
                        gap: 10,
                        marginLeft: -16,
                        marginRight: -16,
                        paddingLeft: 16,
                        paddingRight: 16,
                      }}
                    >
                      {myCourses.map((course) => (
                        <div
                          key={course.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openSavedCourse(course)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") openSavedCourse(course);
                          }}
                          style={{
                            position: "relative",
                            width: 220,
                            height: 80,
                            flexShrink: 0,
                            borderRadius: 14,
                            background: "#f7f7f7",
                            padding: 14,
                            boxSizing: "border-box",
                            cursor: "pointer",
                            textAlign: "left",
                            border: "none",
                            fontFamily: "inherit",
                          }}
                          onMouseDown={(e) => {
                            (e.currentTarget as HTMLDivElement).style.opacity = "0.85";
                          }}
                          onMouseUp={(e) => {
                            (e.currentTarget as HTMLDivElement).style.opacity = "1";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLDivElement).style.opacity = "1";
                          }}
                        >
                          <p
                            style={{
                              margin: 0,
                              fontSize: 14,
                              fontWeight: 600,
                              color: "#1a1a2e",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              paddingRight: 24,
                            }}
                          >
                            {course.title}
                          </p>
                          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#777" }}>
                            장소 {course.place_count}곳 · {formatCourseDate(course.created_at)}
                          </p>
                          <button
                            type="button"
                            aria-label="코스 옵션"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCourseActionTarget(course);
                            }}
                            style={{
                              position: "absolute",
                              top: 8,
                              right: 8,
                              width: 28,
                              height: 28,
                              border: "none",
                              borderRadius: 6,
                              background: "transparent",
                              color: "#666",
                              fontSize: 16,
                              lineHeight: 1,
                              cursor: "pointer",
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "#ececec";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                            }}
                          >
                            ⋯
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <PostGrid
                  empty={myMypagePosts.length === 0}
                  emptyMessage="아직 작성한 게시물이 없어요"
                >
                  {myMypagePosts.map((post) => (
                    <PostGridCell
                      key={post.id}
                      imageUrl={post.images[0]}
                      titleLine={(post.title || post.placeName || "").trim()}
                      placeName={post.placeName}
                      address={post.address}
                      likeCount={post.likes_count}
                      onClick={() => {
                        setDetailReturnTo({ type: "mypage" });
                        setActiveTab("mypage");
                        setDetailPostId(post.id);
                      }}
                    />
                  ))}
                </PostGrid>
              </div>
            </div>
          )}
        </section>
        <BottomTabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          hidden={activeTab === "messages" && !!activeChatRoom}
          keyboardHidden={tabBarHiddenByKeyboard}
          messageUnreadCount={messageUnreadTotal}
        />
        {selectedPlace && !mapExpanded && (
          <>
            <div
              className="placeDetailSheetBackdrop"
              onClick={() => {
                setSelectedPlace(null);
                setSelectedMapPlace(null);
              }}
            />
            <PlaceDetailSheet
              place={selectedPlace as PlaceSheetData}
              isSaved={!!resolveSavedMatch(selectedPlace)}
              layout="overlay"
              showDirections={!!(selectedPlace.y && selectedPlace.x)}
              directionsMode={directionsMode}
              directionsLoading={directionsLoading}
              directionsInfo={directionsInfo}
              onClose={() => {
                setSelectedPlace(null);
                setSelectedMapPlace(null);
              }}
              onToggleSave={() => { void togglePlaceSheetSave(selectedPlace as PlaceSheetData); }}
              onCurationClick={(postId) => {
                setDetailPostId(postId);
                setSelectedPlace(null);
              }}
              onImageLightbox={setLightboxImg}
              timeAgoLabel={timeAgo}
              onOpenAppleMaps={() =>
                openAppleMapsPlace(
                  selectedPlace.place_name,
                  selectedPlace.road_address_name || selectedPlace.address_name,
                  selectedPlace.y,
                  selectedPlace.x,
                )
              }
              onDirectionsModeChange={(mode) => {
                setMapExpanded(true);
                setDirectionsMode(mode);
                setTimeout(
                  () => drawRoute(parseFloat(selectedPlace.y), parseFloat(selectedPlace.x), mode),
                  600,
                );
              }}
              onOpenTransit={() =>
                openTransitInKakaoMap(
                  selectedPlace.place_name,
                  parseFloat(selectedPlace.y),
                  parseFloat(selectedPlace.x),
                )
              }
            />
          </>
        )}
        {homePlaceSheet &&
          createPortal(
            <>
              <div className="placeDetailSheetBackdrop" onClick={() => setHomePlaceSheet(null)} />
              <PlaceDetailSheet
                place={homePlaceSheet}
                isSaved={!!resolveSavedMatch(homePlaceSheet)}
                layout="overlay"
                onClose={() => setHomePlaceSheet(null)}
                onToggleSave={() => { void togglePlaceSheetSave(homePlaceSheet); }}
                onCurationClick={(postId) => {
                  setHomePlaceSheet(null);
                  setDetailPostId(postId);
                }}
                onImageLightbox={setLightboxImg}
                timeAgoLabel={timeAgo}
                onOpenAppleMaps={() =>
                  openAppleMapsPlace(
                    homePlaceSheet.place_name,
                    homePlaceSheet.road_address_name || homePlaceSheet.address_name,
                    homePlaceSheet.y,
                    homePlaceSheet.x,
                  )
                }
              />
            </>,
            document.body,
          )}
        {courseShareModalEl}
        {sharePostModalEl}
        {notificationModalEl}
        {user?.id && showFollowList && (
          <FollowListModal
            open
            onClose={() => setShowFollowList(null)}
            userId={user.id}
            type={showFollowList}
            onUserClick={(username) => {
              setShowFollowList(null);
              if (username === user.username) return;
              router.push(`/profile/${encodeURIComponent(username)}`);
            }}
          />
        )}
        {courseActionTarget && !showCourseDeleteConfirm && (
          <div
            onClick={closeCourseActionSheet}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99999,
              background: "rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "flex-end",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                width: "100%",
                borderRadius: "20px 20px 0 0",
                padding: "24px 20px 40px",
                boxSizing: "border-box",
              }}
            >
              <p style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#1a1a2e" }}>
                {courseActionTarget.title}
              </p>
              <button
                type="button"
                onClick={() => setShowCourseDeleteConfirm(true)}
                style={{
                  width: "100%",
                  padding: "14px",
                  borderRadius: "10px",
                  border: "none",
                  background: "#fff",
                  color: "#e53935",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  marginBottom: 8,
                }}
              >
                삭제
              </button>
              <button
                type="button"
                onClick={closeCourseActionSheet}
                style={{
                  width: "100%",
                  padding: "14px",
                  borderRadius: "10px",
                  border: "none",
                  background: "#f5f5f5",
                  color: "#666",
                  fontSize: 14,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                취소
              </button>
            </div>
          </div>
        )}
        {showCourseDeleteConfirm && courseActionTarget && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 100001,
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              boxSizing: "border-box",
            }}
            onClick={() => {
              if (!courseDeleting) {
                setShowCourseDeleteConfirm(false);
              }
            }}
          >
            <div
              role="dialog"
              style={{
                width: "100%",
                maxWidth: 320,
                background: "#fff",
                borderRadius: 16,
                padding: "24px 20px",
                boxSizing: "border-box",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <p style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: "#1a1a2e" }}>
                정말 삭제할까요?
              </p>
              <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 500, color: "#333" }}>
                {courseActionTarget.title}
              </p>
              <p style={{ margin: "0 0 20px", fontSize: 12, color: "#888" }}>
                이 작업은 되돌릴 수 없어요
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={courseDeleting}
                  onClick={() => setShowCourseDeleteConfirm(false)}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                    color: "#666",
                    fontSize: 13,
                    cursor: courseDeleting ? "wait" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={courseDeleting}
                  onClick={() => { void handleConfirmDeleteCourse(); }}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 10,
                    border: "none",
                    background: "#e53935",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: courseDeleting ? "wait" : "pointer",
                    fontFamily: "inherit",
                    opacity: courseDeleting ? 0.7 : 1,
                  }}
                >
                  {courseDeleting ? "삭제 중..." : "삭제"}
                </button>
              </div>
            </div>
          </div>
        )}
        {showMypageSettingsSheet && (
          <div
            onClick={() => setShowMypageSettingsSheet(false)}
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end" }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: "#fff", width: "100%", borderRadius: "20px 20px 0 0", padding: "8px 0 40px", boxSizing: "border-box" }}
            >
              <div style={{ padding: "12px 20px 8px", borderBottom: "0.5px solid #efefef" }}>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>설정</span>
              </div>
              <button
                type="button"
                className="settingItem"
                style={{ width: "100%", padding: "16px 20px" }}
                onClick={() => {
                  setShowMypageSettingsSheet(false);
                  openProfileEdit();
                }}
              >
                프로필 편집
              </button>
              <button
                type="button"
                className="settingItem"
                style={{ width: "100%", padding: "16px 20px" }}
                onClick={() => {
                  setShowMypageSettingsSheet(false);
                  showToast("준비 중이에요", "info");
                }}
              >
                알림 설정
              </button>
              <button
                type="button"
                className="settingItem"
                style={{ width: "100%", padding: "16px 20px" }}
                onClick={() => {
                  setShowMypageSettingsSheet(false);
                  showToast("준비 중이에요", "info");
                }}
              >
                공개 범위 설정
              </button>
              <button
                type="button"
                className="settingItem"
                style={{ width: "100%", padding: "16px 20px", color: "#d32f2f", fontWeight: 600 }}
                onClick={() => {
                  setShowMypageSettingsSheet(false);
                  openDeleteAccountModal();
                }}
              >
                계정 삭제
              </button>
              <button
                type="button"
                className="settingItem"
                style={{ width: "100%", padding: "16px 20px" }}
                onClick={() => {
                  setShowMypageSettingsSheet(false);
                  void handleLogoutClick();
                }}
              >
                로그아웃
              </button>
            </div>
          </div>
        )}
        {showProfileEditModal && (
          <div
            onClick={closeProfileEditModal}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 99999,
              background: "rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "flex-end",
              paddingBottom: keyboardHeight > 0 ? keyboardHeight : 0,
              transition: "padding-bottom 0.25s ease",
              boxSizing: "border-box",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                width: "100%",
                borderRadius: "20px 20px 0 0",
                display: "flex",
                flexDirection: "column",
                boxSizing: "border-box",
                padding: keyboardHeight > 0 ? "0 20px 16px" : "0 20px calc(16px + env(safe-area-inset-bottom, 0px))",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 16 }}>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>프로필 편집</span>
                <button type="button" onClick={closeProfileEditModal} disabled={profileEditSaving} style={{ border: "none", background: "transparent", color: "#bbb", fontSize: "20px", cursor: profileEditSaving ? "wait" : "pointer" }}>×</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 24 }}>
                <div style={{ position: "relative" }}>
                  <ProfileAvatar
                    avatarUrl={profileEditAvatarPreview}
                    username={profileEditName || user?.username || ""}
                    size={96}
                    fontSize={38}
                  />
                  <button
                    type="button"
                    aria-label="프로필 사진 변경"
                    disabled={profileEditSaving}
                    onClick={() => profileAvatarFileInputRef.current?.click()}
                    style={{
                      position: "absolute",
                      right: 0,
                      bottom: 0,
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      border: "2px solid #fff",
                      background: "#1a2a7a",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: profileEditSaving ? "wait" : "pointer",
                      padding: 0,
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M3 7h2l1.4-2.4a1 1 0 0 1 .9-.6h9.4a1 1 0 0 1 .9.6L19 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <input
                    ref={profileAvatarFileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleProfileAvatarFileChange}
                  />
                </div>
                <span style={{ marginTop: 10, marginBottom: 28, fontSize: 12, color: "#8a8a8a" }}>사진은 저장 버튼을 누르면 반영돼요</span>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0 }}>
                <span style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px" }}>닉네임</span>
                <input className="profileEditField" value={profileEditName} onChange={(e) => setProfileEditName(e.target.value)} placeholder="닉네임 입력" />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                <span style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px" }}>소개</span>
                <textarea
                  className="profileEditField profileEditBioField"
                  value={profileEditBio}
                  onChange={(e) => setProfileEditBio(e.target.value.slice(0, PROFILE_BIO_MAX_LENGTH))}
                  placeholder="자기소개를 입력해주세요"
                  rows={3}
                  maxLength={PROFILE_BIO_MAX_LENGTH}
                  disabled={profileEditSaving}
                />
                <span
                  style={{
                    alignSelf: "flex-end",
                    marginTop: 6,
                    fontSize: 11,
                    color: profileEditBio.length >= PROFILE_BIO_MAX_LENGTH ? "#e07070" : "#999",
                  }}
                >
                  {profileEditBio.length}/{PROFILE_BIO_MAX_LENGTH}
                </span>
              </div>
              <button type="button" onClick={saveProfileEdit} disabled={profileEditSaving} className="profileEditSaveBtn" style={{ marginTop: 28 }}>
                {profileEditSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        )}
        {showDeleteAccountModal && (
          <div onClick={closeDeleteAccountFlow} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxWidth: "400px", borderRadius: "16px", padding: "24px 20px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "14px" }}>
              <p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a1a2e" }}>정말 계정을 삭제하시겠습니까?</p>
              <p style={{ margin: 0, fontSize: "13px", color: "#555", lineHeight: 1.65, whiteSpace: "pre-line" }}>
                {`계정을 삭제하면 다음 데이터가 영구적으로 삭제됩니다:\n• 저장한 모든 핀\n• 만든 코스\n• 프로필 정보\n• 활동 기록\n이 작업은 되돌릴 수 없습니다.`}
              </p>
              <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
                <button type="button" onClick={closeDeleteAccountFlow} style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "1px solid #ddd", background: "#f5f5f5", color: "#666", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>
                  취소
                </button>
                <button type="button" onClick={goToFinalDeleteConfirmation} style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none", background: "#d32f2f", color: "#fff", fontSize: "14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                  삭제
                </button>
              </div>
            </div>
          </div>
        )}
        {showDeleteAccountFinalModal && (
          <div
            onClick={() => { if (!deleteAccountLoading) closeDeleteAccountFlow(); }}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 99999,
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
              paddingBottom: keyboardHeight > 0 ? 20 + keyboardHeight : 20,
              transition: "padding-bottom 0.25s ease",
              boxSizing: "border-box",
            }}
          >
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxWidth: "400px", borderRadius: "16px", padding: "24px 20px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "14px" }}>
              <p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a1a2e" }}>최종 확인</p>
              <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "13px", color: "#444" }}>계정을 삭제하려면 &apos;삭제&apos;를 입력하세요</span>
                <input className="mapInput" value={deleteAccountPhraseInput} onChange={(e) => setDeleteAccountPhraseInput(e.target.value)} placeholder="삭제" autoComplete="off" disabled={deleteAccountLoading} />
              </label>
              <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
                <button type="button" onClick={closeDeleteAccountFlow} disabled={deleteAccountLoading} style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "1px solid #ddd", background: "#f5f5f5", color: "#666", fontSize: "14px", cursor: deleteAccountLoading ? "wait" : "pointer", fontFamily: "inherit" }}>
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void executePermanentAccountDeletion()}
                  disabled={deleteAccountLoading || deleteAccountPhraseInput.trim() !== "삭제"}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: "10px",
                    border: "none",
                    background: deleteAccountPhraseInput.trim() !== "삭제" || deleteAccountLoading ? "#e57373" : "#b71c1c",
                    color: "#fff",
                    fontSize: "14px",
                    cursor: deleteAccountLoading || deleteAccountPhraseInput.trim() !== "삭제" ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    fontWeight: 600,
                  }}
                >
                  {deleteAccountLoading ? "처리 중..." : "계정 영구 삭제"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
    {isHomeSearchOpen && activeTab === "home" && (
      <HomeSearchScreen
        isOpen={isHomeSearchOpen}
        query={homeSearchQuery}
        onQueryChange={setHomeSearchQuery}
        debouncedQuery={debouncedHomeSearchQuery}
        onClose={closeHomeSearch}
        resultCount={homeSearchResultPosts.length}
      >
        {debouncedHomeSearchQuery.trim() && homeSearchResultPosts.length === 0 ? (
          <EmptyState
            variant="feed"
            icon="🔍"
            title={`'${debouncedHomeSearchQuery.trim()}'에 대한 큐레이션이 없어요`}
            description="다른 키워드로 검색해보세요"
          />
        ) : (
          <PostGrid columns={2} className="homeFeedGrid homeSearchFeedGrid">
            {homeSearchResultPosts.map((post) => (
              <PostGridCell
                key={post.id}
                variant="home"
                imageUrl={post.images[0]}
                titleLine={(post.title || post.comment || post.placeName || "").trim()}
                placeName={post.placeName}
                address={post.address}
                likeCount={post.likes_count}
                imageCount={post.images.length}
                showUsername
                showMultiIcon
                username={post.user}
                onProfileClick={() =>
                  router.push(`/profile/${encodeURIComponent(post.user)}?from=search`)
                }
                onClick={() => setDetailPostId(post.id)}
              />
            ))}
          </PostGrid>
        )}
      </HomeSearchScreen>
    )}
    {inAppNotificationCurrent &&
      typeof document !== "undefined" &&
      createPortal(
        <InAppNotificationToast
          key={inAppNotificationCurrent.id}
          type={inAppNotificationCurrent.type}
          actorName={inAppNotificationCurrent.actorName}
          actorAvatarUrl={inAppNotificationCurrent.actorAvatarUrl}
          text={inAppNotificationCurrent.text}
          onClick={() => {
            void navigateFromInAppNotification(inAppNotificationCurrent);
          }}
          onDismiss={handleInAppNotificationDismiss}
        />,
        document.body,
      )}
    </>
  );
}