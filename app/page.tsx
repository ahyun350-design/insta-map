"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { debugLog, dlog, logPerf, perfNow } from "@/lib/debugLog";
import { withAutoRetry, withAutoRetryAndMessageSendRecovery } from "@/lib/connectionRecovery";
import { useUser } from "@/lib/useUser";
import { hideNativeSplash } from "@/lib/nativeSplash";
import {
  clearHomeBootstrapCache,
  placesAreEqual,
  readCachedMapView,
  readCachedPlaces,
  writeCachedMapView,
  writeCachedPlaces,
  type CachedMapView,
} from "@/lib/homeBootstrapCache";
import { fetchChatRoomList } from "@/lib/fetchChatRoomList";
import {
  getGeocodeCacheSync,
  hydrateGeocodeCache,
  setGeocodeCache,
} from "@/lib/geocodeAddressCache";
import {
  loadLastBootTimingReport,
  mark,
  type BootTimingReport,
} from "@/lib/bootTiming";
import { loadBootFailReport, type BootFailReport } from "@/lib/webviewRecovery";
import { usePushNotifications } from "@/lib/usePushNotifications";
import { InAppNotificationToast } from "@/components/InAppNotificationToast";
import { ExtractLoadingOverlay, EXTRACT_EMPTY_RESULT_RAW } from "@/components/ExtractLoadingOverlay";
import { mapExtractErrorToUserMessage } from "@/lib/extractUserError";
import { toUserMessage } from "@/lib/userErrorMessage";

const ADMIN_USER_ID = "63772749-e01b-4396-a41c-c17a4d3acfe6";
const ADMIN_STATUS_CARD_OPEN_KEY = "pindmap_admin_status_card_open";

/** 관리자 코스맵 실험 임시 진단 로그 — ADMIN_USER_ID일 때만 */
function logAdminCourseMap(userId: string | null | undefined, ...args: unknown[]) {
  if (userId !== ADMIN_USER_ID) return;
  console.log("[crs][admin-map]", ...args);
}

function readAdminStatusCardOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(ADMIN_STATUS_CARD_OPEN_KEY);
    if (v === null) return false; // 기본: 접힘
    return v === "1";
  } catch {
    return false;
  }
}

function writeAdminStatusCardOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADMIN_STATUS_CARD_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** 웹 코스 지도 순번 핀 SVG */
function buildWebCoursePinSvg(order: number, total: number): { svg: string; width: number; height: number } {
  const emphasize = order === 1 || order === total;
  const width = emphasize ? 35 : 32;
  const height = emphasize ? 44 : 40;
  const stroke = emphasize ? 2.5 : 1.5;
  const fontSize = emphasize ? 16 : 15;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 32 40"><path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24S32 28 32 16C32 7.16 24.84 0 16 0z" fill="#1a2a7a" stroke="#fff" stroke-width="${stroke}"/><circle cx="16" cy="16" r="11" fill="#fff"/><text x="16" y="21" text-anchor="middle" font-size="${fontSize}" font-weight="800" fill="#1a2a7a">${order}</text></svg>`;
  return { svg, width, height };
}

function truncateCourseLabelName(name: string, max = 16): string {
  const t = name.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

type AdminStatusPayload = {
  today: { attempts: number; success: number; failed: number };
  last7Days: { attempts: number; successRate: number };
  lastSuccessAt: string | null;
  stuckJobs: number;
  recentFailures: Array<{ error_message: string | null; at: string | null }>;
  signups: { today: number; total: number };
  activeUsers7d: number;
  userEventsTotal: number;
};

function formatAdminHoursAgo(iso: string | null): string {
  if (!iso) return "없음";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "없음";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return "방금";
  if (hours < 48) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}
import {
  formatInAppNotificationFromRow,
  formatMessageInAppText,
  type InAppNotificationItem,
} from "@/lib/inAppNotification";
import { useInAppNotifications } from "@/lib/useInAppNotifications";
import { resolveUnauthenticatedPath } from "@/lib/onboarding";
import { track } from "@/lib/track";
import { cleanInstagramUrl } from "@/lib/instagramUrl";
import { useClipboardInstagramSuggest } from "@/lib/useClipboardInstagramSuggest";
import { maybeRunAdminCleanup, readAdminLastCleanupAt } from "@/lib/adminCleanup";
import FeedSkeleton from "@/components/FeedSkeleton";
import EmptyState from "@/components/EmptyState";
import { useToast } from "@/components/Toast";
import { prepareImageForUpload } from "@/lib/prepareImageForUpload";
import {
  DEFAULT_CURATION_ASPECT_RATIO,
  resolveCurationAspectRatioFromSrc,
} from "@/lib/curationAspectRatio";
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
  clearFullscreenNativeRoute,
  setFullscreenNativeCourseNavigation,
  clearFullscreenNativeCourseNavigation,
  setFullscreenNativeSearchResults,
  clearFullscreenNativeSearchResults,
  setFullscreenNativePlaceSaved,
  setFullscreenNativeDirectionsInfo,
  showFullscreenNativePlaceSheet,
  setFullscreenNativeMyLocation,
  setNativeCamera,
  setNativeMarkerClickHandler,
} from "@/lib/nativeMap";
import { PindmapNativeMap } from "@pindmap/native-map";
import { uploadAvatar } from "@/lib/uploadAvatar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import type { FollowListType } from "@/components/FollowListModal";
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
import { CourseMapDesignOverlay } from "@/components/CourseMapDesignOverlay";
import {
  PlacePostsListScreen,
  type PlacePostsListData,
} from "@/components/PlacePostsListScreen";
import { MapSearchResultsSheet, type MapSearchPlaceResult } from "@/components/MapSearchResultsSheet";
import { MapResearchAreaButton } from "@/components/MapResearchAreaButton";
import { Coachmark } from "@/components/Coachmark";
import { nextCoachToShow, setCoachSeen, COACHMARK_DEFS } from "@/lib/coachmarks";
import {
  buildCourseWalkNavigationFromTmap,
  parseTmapWalkGeoJsonToPath,
  type CourseWalkNavigation,
} from "@/lib/courseWalkNavigation";
import { feedPostToPlaceSheet, placeRefFromPlaceSheet, type PlaceSheetData } from "@/lib/placeSheet";
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
  updateCourseInviteImage,
  updateCourseTitle,
  resolveCourseInviteImage,
  type SavedCourse,
  type SavedCourseItem,
} from "@/lib/courses";
import {
  getCurrentPositionForMapStage1,
  getCurrentPositionForMapStage2,
  isGeolocationPermissionDenied,
} from "@/lib/getCurrentPositionForMap";
import { getDisplayFriendName } from "@/lib/friendDisplay";
import { searchUsersByUsername, type UserSearchHit } from "@/lib/userSearch";
import {
  copyTextToClipboard,
  getCourseShareUrl,
  shareViaNavigatorShare,
} from "@/lib/pindmapLinks";
import { parseFeedPostFromRow, feedCommentCount, isOwnFeedAuthor, FEED_PAGE_SIZE, FEED_POST_LIST_SELECT, FEED_POST_DETAIL_SELECT, type FeedPost, type PhotoPlaceTag } from "@/lib/feedPost";
import {
  getDisplayPlaceForPhoto,
  getFirstMatchingPhotoIndex,
  getRelatedPostImagesForPlace,
  getRepresentativePhotoPlaceTag,
  getRepresentativePlaceForPost,
  hasPhotoPlaceTags,
  buildUniqueCourseItemsFromPhotoPlaceTags,
  mergeRelatedFeedPostsForPlaceSheet,
  type PlaceRefForPhotoTagMatch,
} from "@/lib/photoPlaceTag";

const FollowListModal = dynamic(
  () => import("@/components/FollowListModal").then((m) => ({ default: m.FollowListModal })),
  { ssr: false, loading: () => null },
);
const CourseNavigationOverlay = dynamic(
  () =>
    import("@/components/CourseNavigationOverlay").then((m) => ({
      default: m.CourseNavigationOverlay,
    })),
  { ssr: false, loading: () => null },
);
const ChatCourseCard = dynamic(
  () => import("@/components/ChatCourseCard").then((m) => ({ default: m.ChatCourseCard })),
  { ssr: false, loading: () => null },
);
const MessageUserSearchRow = dynamic(
  () =>
    import("@/components/MessageUserSearchRow").then((m) => ({
      default: m.MessageUserSearchRow,
    })),
  { ssr: false, loading: () => null },
);

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
  devLog("[PindMap:kakao] calling maps.load()", { origin, readyState });

  let polls = 0;
  const pollId = window.setInterval(() => {
    polls += 1;
    const rs = (window.kakao?.maps as { readyState?: number })?.readyState;
    devLog("[PindMap:kakao] maps.load poll", {
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
      devLog("[PindMap:kakao] maps.load callback fired", {
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

async function timedLoadQuery<T>(label: string, query: PromiseLike<T>): Promise<T> {
  const t0 = perfNow();
  const result = await query;
  logPerf(`loadData.${label}`, perfNow() - t0);
  return result;
}

type Message = { id: string; senderId: string; text: string; createdAt: string; read?: boolean; status?: "pending" | "sent" | "failed"; };

const CHAT_MESSAGES_PAGE_SIZE = 50;
const PROFILE_BIO_MAX_LENGTH = 150;
const REALTIME_REMOUNT_DEBOUNCE_MS = 1000;
const REALTIME_REMOUNT_BACKOFFS_MS = [1000, 3000, 10000] as const;
/** 동일 유저·짧은 시간 내 auth 이벤트 중복으로 loadData가 2회+ 실행되는 것 방지 */
const LOAD_DATA_DEDUP_MS = 2000;
/** 메시지 탭 방 목록 재조회 TTL — Realtime은 별도로 즉시 반영 */
const CHAT_ROOMS_LIST_TTL_MS = 30_000;
/** 마이페이지 탭(코스·좋아요·팔로우 수) 재조회 TTL */
const MYPAGE_TAB_TTL_MS = 30_000;
/** 프로덕션 핫패스 console.log 노이즈 방지 — error/warn은 유지 */
const __pageConsoleLog = console.log.bind(console);
function devLog(...args: Parameters<typeof console.log>) {
  if (process.env.NODE_ENV === "development") {
    __pageConsoleLog(...args);
  }
}
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

function getMarkerPhotoMetaForPlaceRef(
  posts: FeedPost[],
  placeRef: PlaceRefForPhotoTagMatch,
  debugName?: string,
): { photos: string[]; postCount: number; photoPostIds: string[] } {
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

function getMarkerPhotoMetaForPlace(
  posts: FeedPost[],
  place: Place,
  coords?: LatLng,
): { photos: string[]; postCount: number; photoPostIds: string[] } {
  const placeRef = placeRefFromPlace(place, coords?.lat, coords?.lng);
  return getMarkerPhotoMetaForPlaceRef(posts, placeRef, place.name);
}

function getMarkerPhotoMetaForKakaoPlace(
  posts: FeedPost[],
  place: {
    id?: string;
    place_name?: string;
    y?: string | number;
    x?: string | number;
    road_address_name?: string;
    address_name?: string;
  },
): { photos: string[]; postCount: number; photoPostIds: string[] } {
  const placeRef = placeRefFromKakaoPlace(place);
  return getMarkerPhotoMetaForPlaceRef(posts, placeRef, place.place_name);
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
  _hiddenPlaceIds: Set<string>,
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
  // 지도 핀은 hiddenIds와 무관하게 전부 표시되므로 탭 히트도 전체 장소 대상
  for (const p of places) {
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

function courseNavigationToNativePayload(navigation: CourseWalkNavigation) {
  return {
    placeCount: navigation.placeCount,
    totalTimeSec: navigation.totalTimeSec,
    totalDistanceM: navigation.totalDistanceM,
    fullPath: navigation.mergedPath,
    segments: navigation.segments.map((segment) => ({
      index: segment.index,
      fromName: segment.fromName,
      toName: segment.toName,
      distanceM: segment.distanceM,
      timeSec: segment.timeSec,
      path: segment.path,
      steps: segment.steps.map((step) => ({
        description: step.description,
        lat: step.lat,
        lng: step.lng,
      })),
    })),
  };
}

function latLngBoundsFromPath(path: LatLng[]) {
  if (!path.length || !window.kakao?.maps) return null;
  const bounds = new window.kakao.maps.LatLngBounds();
  path.forEach((point) => bounds.extend(new window.kakao.maps.LatLng(point.lat, point.lng)));
  return bounds;
}

// 좌표가 있는 장소들에서 가까운 순으로 코스 짜기 (Nearest Neighbor 알고리즘)
type CoursePlace = Place & { lat: number; lng: number };

type FullscreenNativeCamera = { lat: number; lng: number; zoom: number };

type FullscreenSearchMarkerSnapshot = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  address?: string;
  category?: string;
  isSaved?: boolean;
  photos?: string[];
  postCount?: number;
  photoPostIds?: string[];
  order?: number;
};

type FullscreenReturnSnapshot =
  | { mode: "saved"; camera: FullscreenNativeCamera | null; selectedMarkerId?: string }
  | {
      mode: "course";
      coursePlaces: CoursePlace[];
      courseMarkers: FullscreenSearchMarkerSnapshot[];
      camera: FullscreenNativeCamera | null;
      selectedMarkerId?: string;
    }
  | {
      mode: "search";
      query: string;
      camera: FullscreenNativeCamera;
      searchBiasCenter: { lat: number; lng: number };
      selectedMarkerId?: string;
      markers: FullscreenSearchMarkerSnapshot[];
      searchResults: Array<{
        id: string;
        name: string;
        address: string;
        lat: number;
        lng: number;
        category?: string;
      }>;
      searchPinPlaces: [string, unknown][];
    };

function defaultFullscreenNativeCamera(): FullscreenNativeCamera {
  return { lat: 37.5665, lng: 126.978, zoom: FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM };
}

/** Allow native map view to finish applyInitialContent before markers/route updates. */
function waitForFullscreenNativeMapReady(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 400));
}

function buildCourseFullscreenMarkers(coursePlaces: CoursePlace[]): FullscreenSearchMarkerSnapshot[] {
  return coursePlaces.flatMap((place, index) => {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return [];
    return [{
      id: `course-${index}`,
      lat: place.lat,
      lng: place.lng,
      category: place.category,
      title: place.name,
      address: place.address,
      order: index + 1,
    }];
  });
}

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

  const redirectUnauthenticated = useCallback(async () => {
    router.push(await resolveUnauthenticatedPath());
  }, [router]);

  useEffect(() => {
    void hydrateGeocodeCache();
  }, []);

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
      await clearHomeBootstrapCache();
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
  const [courseInviteImageBusy, setCourseInviteImageBusy] = useState(false);
  const courseInviteImageInputRef = useRef<HTMLInputElement>(null);
  const [activeCoach, setActiveCoach] = useState<string | null>(null);
  const [coachTick, setCoachTick] = useState(0);
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
  const [adminStatus, setAdminStatus] = useState<AdminStatusPayload | null>(null);
  const [adminStatusLoading, setAdminStatusLoading] = useState(false);
  const [adminLastCleanupAt, setAdminLastCleanupAt] = useState<string | null>(null);
  /** 관리자 상태 카드 접이 — localStorage 기본 접힘 */
  const [adminCardOpen, setAdminCardOpen] = useState(false);
  const adminAlertAutoOpenedRef = useRef(false);
  const [lastBootTiming, setLastBootTiming] = useState<BootTimingReport | null>(null);
  const [bootFailReport, setBootFailReport] = useState<BootFailReport | null>(null);
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
    // 프로필→상세 진입 시 밑바닥이 map 으로 떨어지지 않게
    if (searchParams?.get("from") === "profile") return "home";
    return "map";
  });
  const [instagramUrl, setInstagramUrl] = useState("");
  const instagramUrlInputRef = useRef<HTMLInputElement | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<Place[]>([]);
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  /** 마이페이지 「게시」전용 — 전역 feedPosts 와 분리 */
  const [myMypagePosts, setMyMypagePosts] = useState<FeedPost[]>([]);
  const [myMypagePostsCount, setMyMypagePostsCount] = useState(0);
  const [myMypagePostsLoading, setMyMypagePostsLoading] = useState(false);
  const myMypagePostsLoadingRef = useRef(false);
  const myMypagePostsRef = useRef<FeedPost[]>([]);
  myMypagePostsRef.current = myMypagePosts;
  const mypageTabScrollRef = useRef<HTMLDivElement | null>(null);
  const mypagePostsLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const MYPAGE_POSTS_PAGE_SIZE = 30;
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [detailCommentsLoading, setDetailCommentsLoading] = useState(false);
  const feedNextOffsetRef = useRef(0);
  const feedLoadMoreInFlightRef = useRef(false);
  const feedHasMoreRef = useRef(true);
  const homeFeedScrollRef = useRef<HTMLDivElement | null>(null);
  const feedLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const myLikedPostIdsRef = useRef<Set<string>>(new Set());
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
  const [reelInputExpanded, setReelInputExpanded] = useState(false);
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
  const handleOpenFullscreenNativeMapRef = useRef<() => Promise<void>>(async () => {});
  const fullscreenGeocodeRunRef = useRef(0);
  /** iOS 전체화면 Native 코스 모드 — showCourseOnMap에서 설정, 닫을 때 null */
  const fullscreenCourseRef = useRef<CoursePlace[] | null>(null);
  /** 코스 경로 비동기(Tmap) 취소용 — 닫기/코스 종료 시 증가 */
  const fullscreenCourseRouteSessionRef = useRef(0);
  const mapExpandedLiveRef = useRef(false);
  const fullscreenCourseNavigationRef = useRef<CourseWalkNavigation | null>(null);
  const [expandedNativeMapId, setExpandedNativeMapId] = useState<string | null>(null);
  /** 확장 지도 인스턴스가 생길 때마다 증가 — 핀만 별도 effect에서 단일 경로로 그리기 */
  const [expandedMapPinsTick, setExpandedMapPinsTick] = useState(0);
  const [showJobsModal, setShowJobsModal] = useState(false);
  const [activeJobs, setActiveJobs] = useState<ActiveExtractJob[]>([]);
  const clipboardActiveUrls = useMemo(
    () => activeJobs.map((j) => j.instagramUrl),
    [activeJobs],
  );
  const {
    suggestedUrl: clipboardSuggestedUrl,
    dismiss: dismissClipboardSuggest,
    accept: acceptClipboardSuggest,
  } = useClipboardInstagramSuggest({
    userId: user?.id,
    activeInstagramUrls: clipboardActiveUrls,
  });
  const [showExtractOverlay, setShowExtractOverlay] = useState(false);
  const [extractOverlayComplete, setExtractOverlayComplete] = useState(false);
  const [extractOverlayError, setExtractOverlayError] = useState<string | null>(null);
  /** extract_jobs.error_message 원문 — 오버레이 사유 분기용 */
  const [extractOverlayErrorRaw, setExtractOverlayErrorRaw] = useState<string | null>(null);
  const [extractOverlayCompleteVariant, setExtractOverlayCompleteVariant] = useState<
    "success" | "all_saved"
  >("success");
  const [extractRetryUrl, setExtractRetryUrl] = useState<string | null>(null);
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
  /** 장소→상세 진입 시 FeedPostMedia 시작 사진 인덱스 (그 외 오픈은 0) */
  const [detailEntryPhotoIndex, setDetailEntryPhotoIndex] = useState(0);
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
  const [placePostsList, setPlacePostsList] = useState<PlacePostsListData | null>(null);
  const placePostsListReturnFullscreenRef = useRef(false);
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
  /** 관리자 코스맵 실험 — 카카오 마커 대신 HTML 오버레이에 그릴 경로 */
  const [courseDesignPath, setCourseDesignPath] = useState<LatLng[] | null>(null);
  const courseMapDesignActiveRef = useRef(false);
  courseMapDesignActiveRef.current =
    showCourseRoute && userIdRef.current === ADMIN_USER_ID;
  const [courseNavigation, setCourseNavigation] = useState<CourseWalkNavigation | null>(null);
  const [courseNavSegmentIndex, setCourseNavSegmentIndex] = useState<number | null>(null);
  const [courseNavFocusMode, setCourseNavFocusMode] = useState(false);
  /** 관리자 턴바이턴 — 현재 강조 step (GPS 자동 갱신 예정) */
  const [courseNavStepIndex, setCourseNavStepIndex] = useState<number | null>(null);
  /** 전체 경로 보기면 true — 세그먼트 선택 시 false (핀 필터용) */
  const [courseNavFullRouteView, setCourseNavFullRouteView] = useState(true);
  /** 턴 패널 하단 패딩(px) — setBounds bottom에 사용 */
  const courseNavBottomPadRef = useRef(280);
  const courseDesignPathRef = useRef<LatLng[] | null>(null);
  courseDesignPathRef.current = courseDesignPath;
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
  /** Native 전체화면 지도 → 큐레이션 포스트 상세 진입 시, 닫으면 지도로 복귀 */
  const returnToFullscreenMapAfterDetailRef = useRef(false);
  /** 큐레이션 진입 직전 지도 스냅샷 — 포스트 상세 닫을 때 복원 */
  const fullscreenReturnStateRef = useRef<FullscreenReturnSnapshot | null>(null);
  const fullscreenRestorePendingRef = useRef(false);
  const lastFullscreenNativeCameraRef = useRef<FullscreenNativeCamera | null>(null);
  const lastFullscreenSearchMarkersRef = useRef<FullscreenSearchMarkerSnapshot[]>([]);
  const lastFullscreenSearchResultsRef = useRef<
    Array<{ id: string; name: string; address: string; lat: number; lng: number; category?: string }>
  >([]);
  const drawCourseRouteRetryRef = useRef(0);
  const courseTitleOriginalRef = useRef("");
  const courseTitleInlineInputRef = useRef<HTMLInputElement>(null);
  const pollAttemptsRef = useRef<Record<string, number>>({});
  const extractPollStartRef = useRef<Record<string, number>>({});
  const detailOpenPerfRef = useRef<{ postId: string; t: number } | null>(null);
  const detailOpenLoggedRef = useRef<string | null>(null);
  const pollInFlightRef = useRef<Set<string>>(new Set());
  const handleAddSubmittingRef = useRef(false);
  const postSubmittingRef = useRef(false);
  const [isPostSubmitting, setIsPostSubmitting] = useState(false);
  /** 프로필→상세가 router.push 로 열린 경우 close 시 router.back() 사용 */
  const detailReturnUseBackRef = useRef(false);
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
  /** 미니맵 Kakao 마커 id→인스턴스 (diff 갱신용). expanded는 기존 배열 경로 유지 */
  const mainPlaceMarkersByIdRef = useRef<
    Map<string, { marker: any; category: Category; lat: number; lng: number; address: string }>
  >(new Map());
  const searchMarkersRef = useRef<any[]>([]);
  /** 코스 이름 CustomOverlay (웹) */
  const courseLabelOverlaysRef = useRef<any[]>([]);
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
  const loadDataInFlightRef = useRef(false);
  const lastLoadDataSuccessAtRef = useRef(0);
  const lastLoadDataUserIdRef = useRef("");
  /** 채팅방 목록 배치 조회 성공 시각 — 메시지 탭 TTL 스킵용 */
  const chatRoomsListFetchedAtRef = useRef(0);
  const chatRoomsListFetchInFlightRef = useRef<Promise<ChatRoom[]> | null>(null);
  /** 마이페이지 탭 묶음 조회 성공 시각 — 30s TTL */
  const mypageTabFetchedAtRef = useRef(0);
  /** Preferences places 캐시 히트 — loadData silent refresh / 스플래시 조기 hide */
  const bootstrapCacheHitRef = useRef(false);
  const bootstrapCacheUserIdRef = useRef<string | null>(null);
  const mapViewBootstrapRef = useRef<CachedMapView | null>(null);
  const mapViewSaveTimerRef = useRef<number | null>(null);
  const [bootstrapCacheResolved, setBootstrapCacheResolved] = useState(false);
  const [bootstrapCacheHit, setBootstrapCacheHit] = useState(false);
  const initialPinTriggeredRef = useRef(false);
  const prevSavedPlacesKeyRef = useRef("");
  const relayoutTriggeredRef = useRef(false);
  const compactMapResizeObserverRef = useRef<ResizeObserver | null>(null);
  const compactMapRelayoutTimersRef = useRef<number[]>([]);
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

  const hideFromMap = (id: string) => setHiddenIds(prev => new Set([...prev, id]));
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
        lastFullscreenSearchMarkersRef.current = [];
        lastFullscreenSearchResultsRef.current = [];
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
                lastFullscreenSearchMarkersRef.current = [];
                lastFullscreenSearchResultsRef.current = [];
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
                const { photos, postCount, photoPostIds } = getMarkerPhotoMetaForKakaoPlace(
                  feedPostsRef.current,
                  place,
                );
                return [{
                  id: `search-${index}`,
                  lat,
                  lng,
                  title: String(place.place_name ?? ""),
                  address: String(place.road_address_name || place.address_name || ""),
                  category: typeof place.category_name === "string" ? place.category_name : undefined,
                  isSaved,
                  ...(photos.length > 0 ? { photos } : {}),
                  ...(postCount > 0 ? { postCount } : {}),
                  ...(photoPostIds.length > 0 ? { photoPostIds } : {}),
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
                lastFullscreenSearchMarkersRef.current = [];
                lastFullscreenSearchResultsRef.current = [];
                await updateFullscreenNativeMarkers(
                  { markers: [], clearPrefix: "search-" },
                  { silent: false },
                );
                await clearFullscreenNativeSearchResults({ silent: false });
                resolve();
                return;
              }

              await setFullscreenNativeSearchResults(
                { results: searchResults },
                { silent: false },
              );

              await updateFullscreenNativeMarkers(
                { markers, clearPrefix: "search-" },
                { silent: false },
              );

              lastFullscreenSearchMarkersRef.current = markers;
              lastFullscreenSearchResultsRef.current = searchResults;

              const searchCamera = computeFullscreenNativeSearchCamera(
                markers.map((marker) => ({ lat: marker.lat, lng: marker.lng })),
                { preserveView: isResearchSearch },
              );
              if (searchCamera) {
                lastFullscreenNativeCameraRef.current = searchCamera;
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
  }) => {
    try {
      const destLat = Number(destination.lat);
      const destLng = Number(destination.lng);
      if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
        return;
      }

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

      const runWithOrigin = async (origin: { lat: number; lng: number }) => {
        setDirectionsMode("walk");
        await fetchAndDrawWalkRoute(origin);
      };

      const stored = myLocationLatLngRef.current;
      if (
        stored &&
        Number.isFinite(stored.lat) &&
        Number.isFinite(stored.lng)
      ) {
        try {
          await runWithOrigin({ lat: stored.lat, lng: stored.lng });
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
              await runWithOrigin({
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

  const registerFullscreenNativeListeners = useCallback(() => {
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
        void runFullscreenNativeDirections({ id: e.id, lat: e.lat, lng: e.lng });
      }).catch((err) => {
        fullscreenDirectionsListenerRegisteredRef.current = false;
        console.error("[fullscreen] fullscreenDirections listener failed", err);
      });
    }
  }, [runFullscreenNativeSearch, runFullscreenNativeDirections]);

  const captureFullscreenReturnSnapshot = useCallback((selectedMarkerId?: string): FullscreenReturnSnapshot => {
    const fallbackCamera = lastFullscreenNativeCameraRef.current ?? defaultFullscreenNativeCamera();

    const coursePlaces = fullscreenCourseRef.current;
    if (coursePlaces?.length) {
      const courseMarkers = buildCourseFullscreenMarkers(coursePlaces);
      let camera: FullscreenNativeCamera = lastFullscreenNativeCameraRef.current ?? fallbackCamera;
      if (selectedMarkerId?.startsWith("course-")) {
        const index = Number.parseInt(selectedMarkerId.slice("course-".length), 10);
        const place = Number.isFinite(index) ? coursePlaces[index] : undefined;
        if (place && Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
          camera = { lat: place.lat, lng: place.lng, zoom: FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM };
        }
      } else if (selectedMarkerId?.startsWith("place-")) {
        const place = placePinByIdRef.current.get(selectedMarkerId);
        const stored = place ? savedPlaceCoordsRef.current[place.id] ?? latLngFromRow(place) : null;
        if (stored && Number.isFinite(stored.lat) && Number.isFinite(stored.lng)) {
          camera = { lat: stored.lat, lng: stored.lng, zoom: FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM };
        }
      }
      return {
        mode: "course",
        coursePlaces: coursePlaces.map((place) => ({ ...place })),
        courseMarkers: courseMarkers.map((marker) => ({ ...marker })),
        camera,
        selectedMarkerId,
      };
    }

    const query = lastFullscreenQueryRef.current.trim();
    const searchMarkers = lastFullscreenSearchMarkersRef.current;
    if (query && searchMarkers.length > 0) {
      let camera: FullscreenNativeCamera = { ...fallbackCamera };
      if (selectedMarkerId?.startsWith("search-")) {
        const place = searchPinPlaceByIdRef.current.get(selectedMarkerId);
        const lat = Number(place?.y);
        const lng = Number(place?.x);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          camera = { lat, lng, zoom: FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM };
        }
      }
      return {
        mode: "search",
        query,
        camera,
        searchBiasCenter: { lat: camera.lat, lng: camera.lng },
        selectedMarkerId,
        markers: searchMarkers.map((marker) => ({ ...marker })),
        searchResults: lastFullscreenSearchResultsRef.current.map((result) => ({ ...result })),
        searchPinPlaces: Array.from(searchPinPlaceByIdRef.current.entries()),
      };
    }

    let camera = lastFullscreenNativeCameraRef.current;
    if (selectedMarkerId?.startsWith("place-")) {
      const place = placePinByIdRef.current.get(selectedMarkerId);
      const stored = place ? savedPlaceCoordsRef.current[place.id] ?? latLngFromRow(place) : null;
      if (stored && Number.isFinite(stored.lat) && Number.isFinite(stored.lng)) {
        camera = { lat: stored.lat, lng: stored.lng, zoom: FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM };
      }
    }

    return { mode: "saved", camera: camera ?? null, selectedMarkerId };
  }, []);

  const scheduleRestoreFullscreenPlaceSheet = useCallback((markerId?: string) => {
    const id = String(markerId ?? "").trim();
    if (!id) return;
    window.setTimeout(() => {
      void showFullscreenNativePlaceSheet({ id }, { silent: false });
    }, 400);
  }, []);

  const drawFullscreenNativeCourseRoute = useCallback(async (
    courseRoutePath: LatLng[],
    courseMarkers: FullscreenSearchMarkerSnapshot[],
    sessionId: number,
  ) => {
    if (courseRoutePath.length < 2) {
      // TEMP crs-debug
      devLog("[crs] drawCourseRoute skip path too short", courseRoutePath.length);
      return;
    }

    const isSessionStillValid = () =>
      sessionId === fullscreenCourseRouteSessionRef.current &&
      mapExpandedLiveRef.current &&
      Boolean(fullscreenCourseRef.current?.length);

    const applyRouteAndRefreshMarkers = async (path: LatLng[], label: string) => {
      if (!isSessionStillValid()) {
        // TEMP crs-debug
        devLog("[crs] skip route draw — session invalid", label, "session", sessionId);
        return false;
      }
      // TEMP crs-debug
      devLog("[crs] setRoute call path", path.length, "mode course", label);
      await setFullscreenNativeRoute({ path, mode: "course" }, { silent: false });
      if (!isSessionStillValid()) {
        // TEMP crs-debug
        devLog("[crs] skip marker refresh — session invalid after setRoute", label);
        return false;
      }
      await updateFullscreenNativeMarkers(
        { markers: courseMarkers.map((marker) => ({ ...marker })) },
        { silent: false },
      );
      // TEMP crs-debug
      devLog("[crs] setRoute resolved path", path.length, label, "markers", courseMarkers.length);
      return true;
    };

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

      await applyRouteAndRefreshMarkers(courseRoutePath, "preview-straight");

      const coursePlaces = fullscreenCourseRef.current;
      const stopNames =
        coursePlaces?.length === courseRoutePath.length
          ? coursePlaces.map((place) => place.name)
          : courseRoutePath.map((_, index) => `장소 ${index + 1}`);
      const navigation = await buildCourseWalkNavigationFromTmap(courseRoutePath, stopNames);
      if (!isSessionStillValid()) {
        // TEMP crs-debug
        devLog("[crs] skip after tmap — session invalid", sessionId);
        return;
      }
      fullscreenCourseNavigationRef.current = navigation;
      setCourseNavigation(navigation);
      setCourseNavSegmentIndex(navigation.segments.length > 0 ? 0 : null);
      setCourseNavFocusMode(false);
      setCourseNavStepIndex(navigation.segments[0]?.steps.length ? 0 : null);
      const routePath =
        navigation.mergedPath.length >= 2 ? navigation.mergedPath : courseRoutePath;
      await applyRouteAndRefreshMarkers(routePath, "walk-final");
      await setFullscreenNativeCourseNavigation(
        courseNavigationToNativePayload(navigation),
        { silent: false },
      );
    } catch (err) {
      console.error("[course] failed", err);
      if (!isSessionStillValid()) {
        // TEMP crs-debug
        devLog("[crs] skip fallback — session invalid", sessionId);
        return;
      }
      try {
        // TEMP crs-debug
        devLog("[crs] setRoute fallback call path", courseRoutePath.length);
        await applyRouteAndRefreshMarkers(courseRoutePath, "fallback-straight");
      } catch (setRouteErr) {
        console.error("[course] setRoute failed", setRouteErr);
      }
    } finally {
      setDirectionsLoading(false);
    }
  }, [showToast]);

  const restoreFullscreenNativeMyLocation = useCallback(async () => {
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
  }, []);

  const handleOpenFullscreenNativeMap = useCallback(async () => {
    const restoreSnapshot = fullscreenRestorePendingRef.current
      ? fullscreenReturnStateRef.current
      : null;
    const selectedMarkerIdForRestore =
      restoreSnapshot && "selectedMarkerId" in restoreSnapshot
        ? restoreSnapshot.selectedMarkerId
        : undefined;
    if (fullscreenRestorePendingRef.current) {
      fullscreenRestorePendingRef.current = false;
      fullscreenReturnStateRef.current = null;
    }
    if (restoreSnapshot?.mode === "course") {
      fullscreenCourseRef.current = restoreSnapshot.coursePlaces.map((place) => ({ ...place }));
    }

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
        order: index + 1,
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
        initialMarkers =
          restoreSnapshot?.mode === "course" && restoreSnapshot.courseMarkers.length > 0
            ? restoreSnapshot.courseMarkers.map((marker) => ({ ...marker }))
            : courseEntries.map((entry) => entry.marker);
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

      registerFullscreenNativeListeners();

      if (restoreSnapshot?.mode === "search") {
        searchPinPlaceByIdRef.current = new Map(
          restoreSnapshot.searchPinPlaces as [string, unknown][],
        );
        const searchMarkers = restoreSnapshot.markers;
        const searchResults = restoreSnapshot.searchResults;
        const camera = restoreSnapshot.camera;
        lastFullscreenNativeCameraRef.current = camera;
        await presentFullscreenNativeMap(
          {
            lat: camera.lat,
            lng: camera.lng,
            zoom: camera.zoom,
            markers: [...initialMarkers, ...searchMarkers],
          },
          { silent: false },
        );
        await waitForFullscreenNativeMapReady();
        await setFullscreenNativeSearchResults(
          { results: searchResults },
          { silent: false },
        );
        await updateFullscreenNativeMarkers(
          { markers: searchMarkers, clearPrefix: "search-" },
          { silent: false },
        );
        await setFullscreenNativeCamera({
          lat: camera.lat,
          lng: camera.lng,
          zoom: camera.zoom,
          animated: false,
        });
        void restoreFullscreenNativeMyLocation();
        scheduleRestoreFullscreenPlaceSheet(restoreSnapshot.selectedMarkerId);
        return;
      }

      const geocodeRunId = ++fullscreenGeocodeRunRef.current;
      const accumulatedMarkers = [...initialMarkers];

      const storedMyLocation = myLocationLatLngRef.current;
      const computedEntryCamera = computeFullscreenNativeEntryCamera(
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
      const entryCamera =
        restoreSnapshot?.mode === "course" && restoreSnapshot.camera
          ? restoreSnapshot.camera
          : restoreSnapshot?.mode === "saved" && restoreSnapshot.camera
            ? restoreSnapshot.camera
            : computedEntryCamera;
      lastFullscreenNativeCameraRef.current = entryCamera;
      await presentFullscreenNativeMap(
        { lat: entryCamera.lat, lng: entryCamera.lng, zoom: entryCamera.zoom, markers: initialMarkers },
        { silent: false },
      );

      await waitForFullscreenNativeMapReady();

      if (isFullscreenCourseMode && courseRoutePath.length >= 2) {
        const courseSessionId = ++fullscreenCourseRouteSessionRef.current;
        const courseMarkersForRoute = initialMarkers.map((marker) => ({ ...marker })) as FullscreenSearchMarkerSnapshot[];
        await drawFullscreenNativeCourseRoute(courseRoutePath, courseMarkersForRoute, courseSessionId);
      }

      void restoreFullscreenNativeMyLocation();

      if (isFullscreenCourseMode) {
        scheduleRestoreFullscreenPlaceSheet(selectedMarkerIdForRestore);
        return;
      }

      if (restoreSnapshot?.mode === "saved") {
        scheduleRestoreFullscreenPlaceSheet(selectedMarkerIdForRestore);
      }

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
  }, [savedPlaces, runFullscreenNativeSearch, runFullscreenNativeDirections, showToast, registerFullscreenNativeListeners, restoreFullscreenNativeMyLocation, scheduleRestoreFullscreenPlaceSheet, drawFullscreenNativeCourseRoute]);

  handleOpenFullscreenNativeMapRef.current = handleOpenFullscreenNativeMap;

  useEffect(() => {
    mapExpandedLiveRef.current = mapExpanded;
  }, [mapExpanded]);

  useEffect(() => {
    if (!isNativeMapAvailable()) return;

    if (mapExpanded) {
      // 관리자 코스 실험: 웹 딤 오버레이를 써야 하므로 네이티브 자동 present 금지
      // (showCourseOnMap에서 네이티브를 스킵해도, 여기 effect가 다시 네이티브를 띄우고 있었음)
      if (showCourseRoute && userIdRef.current === ADMIN_USER_ID) {
        logAdminCourseMap(
          userIdRef.current,
          "mapExpanded effect: SKIP native auto-open (admin course design)",
          { showCourseRoute, mapExpanded },
        );
        return;
      }
      if (fullscreenAutoOpenedRef.current) return;
      fullscreenAutoOpenedRef.current = true;
      logAdminCourseMap(userIdRef.current, "mapExpanded effect: opening native fullscreen");
      void handleOpenFullscreenNativeMapRef.current();
      return;
    }

    if (!fullscreenAutoOpenedRef.current) return;
    fullscreenAutoOpenedRef.current = false;
    fullscreenCourseRouteSessionRef.current += 1;
    fullscreenCourseRef.current = null;
    fullscreenCourseNavigationRef.current = null;
    setCourseNavigation(null);
    setCourseNavSegmentIndex(null);
    setCourseNavFocusMode(false);
    setCourseNavStepIndex(null);
    void clearFullscreenNativeRoute({ silent: true });
    void clearFullscreenNativeCourseNavigation({ silent: true });
    void dismissFullscreenNativeMap({ silent: true });
  }, [mapExpanded, showCourseRoute]);

  useEffect(() => {
    if (!isNativeMapAvailable()) return;
    if (fullscreenDismissListenerRegisteredRef.current) return;
    fullscreenDismissListenerRegisteredRef.current = true;
    void PindmapNativeMap.addListener("fullscreenMapDismissed", () => {
      fullscreenAutoOpenedRef.current = false;
      fullscreenCourseRouteSessionRef.current += 1;
      fullscreenCourseRef.current = null;
      fullscreenCourseNavigationRef.current = null;
      setCourseNavigation(null);
      setCourseNavSegmentIndex(null);
      setCourseNavFocusMode(false);
      setCourseNavStepIndex(null);
      void clearFullscreenNativeRoute({ silent: true });
      void clearFullscreenNativeCourseNavigation({ silent: true });
      if (returnToCourseSheetRef.current) {
        returnToCourseSheetRef.current = false;
        setMapExpanded(false);
        clearRoute();
        setShowCourseRoute(false);
        setCourseDesignPath(null);
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
    const savedPlacesSnapshot = savedPlacesRef.current;
    const candidateId = String(candidate._savedPlaceId || "").trim();
    if (candidateId) {
      const byId = savedPlacesSnapshot.find((p) => p.id === candidateId);
      if (byId) return byId;
    }
    const cy = Number(candidate.y);
    const cx = Number(candidate.x);
    if (Number.isFinite(cy) && Number.isFinite(cx)) {
      const byDistance = savedPlacesSnapshot.find((p) => {
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
    return savedPlacesSnapshot.find((p) => {
      if (!namesAreSimilar(p.name, candName)) return false;
      const np = normalizeAddress(p.address);
      if (!np) return true;
      if (!nRoad && !nAddr) return true;
      return np === nRoad || np === nAddr || np.includes(nRoad) || nRoad.includes(np) || np.includes(nAddr) || nAddr.includes(np);
    });
  }, []);

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

  /** 장소 시트 _feedPosts(관련 큐레이션) → 목록/단건. 1개면 상세, 2개+면 목록 */
  const openPlaceCurationFromSheet = useCallback(
    (place: PlaceSheetData, clickedPostId: string, photoIndex?: number) => {
      const sheetPosts = place._feedPosts ?? [];
      const feedSnapshot = feedPostsRef.current;
      const resolved: FeedPost[] = [];
      const seen = new Set<string>();
      for (const sp of sheetPosts) {
        const id = String(sp.id ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const full = feedSnapshot.find((p) => p.id === id);
        if (full) {
          resolved.push(full);
        } else {
          // 시트에만 있는 경우 — FeedPost 최소 필드로 그리드 표시
          resolved.push(sp as FeedPost);
        }
      }
      if (resolved.length === 0 && clickedPostId) {
        const one = feedSnapshot.find((p) => p.id === clickedPostId);
        if (one) resolved.push(one);
      }

      if (resolved.length <= 1) {
        const id = resolved[0]?.id || clickedPostId;
        if (id) {
          const post = resolved[0] ?? feedSnapshot.find((p) => p.id === id);
          const placeRef = place._placeRef ?? placeRefFromPlaceSheet(place);
          const idx =
            typeof photoIndex === "number" && Number.isFinite(photoIndex)
              ? Math.max(0, Math.floor(photoIndex))
              : post
                ? getFirstMatchingPhotoIndex(post, placeRef)
                : 0;
          setDetailEntryPhotoIndex(idx);
          setDetailPostId(id);
        }
        return;
      }

      setPlacePostsList({
        placeName: place.place_name ?? "",
        address: place.road_address_name || place.address_name || "",
        posts: resolved,
      });
    },
    [],
  );

  const closePlacePostsList = useCallback(() => {
    if (placePostsListReturnFullscreenRef.current) {
      placePostsListReturnFullscreenRef.current = false;
      fullscreenRestorePendingRef.current = true;
      setPlacePostsList(null);
      setActiveTab("map");
      setMapExpanded(true);
      return;
    }
    setPlacePostsList(null);
  }, []);

  const closeDetailPost = useCallback(() => {
    if (returnToFullscreenMapAfterDetailRef.current) {
      returnToFullscreenMapAfterDetailRef.current = false;
      fullscreenRestorePendingRef.current = true;
      setDetailPostId(null);
      setScrollToComment(false);
      setDetailReturnTo(null);
      setActiveTab("map");
      setMapExpanded(true);
      return;
    }
    const ret = detailReturnTo;
    setScrollToComment(false);
    setDetailReturnTo(null);
    if (ret?.type === "profile") {
      // push 로 연 경우에만 back — 이전 프로필 유지(로딩 없음). 아니면 push 폴백
      const useBack = detailReturnUseBackRef.current && typeof window !== "undefined" && window.history.length > 1;
      detailReturnUseBackRef.current = false;
      setActiveTab("home");
      if (useBack) {
        router.back();
      } else {
        router.push(`/profile/${encodeURIComponent(ret.username)}`);
      }
      requestAnimationFrame(() => {
        setDetailPostId(null);
      });
      return;
    }
    if (ret?.type === "mypage") {
      // 목적 탭을 먼저 깔고 상세 제거
      setActiveTab("mypage");
      setDetailPostId(null);
      return;
    }
    setDetailPostId(null);
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
        showToast(toUserMessage(error, "코스를 저장하지 못했어요"), "error");
        return;
      }
      closeCourseSaveModal();
      track("course_create_done");
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

  /** 채팅방 목록 배치 조회 (N+1 제거). 성공 시 TTL 타임스탬프 갱신. */
  const loadChatRoomsList = async (uid: string): Promise<ChatRoom[]> => {
    if (!uid) return [];
    if (chatRoomsListFetchInFlightRef.current) {
      return chatRoomsListFetchInFlightRef.current;
    }
    const run = (async () => {
      const rooms = await fetchChatRoomList({
        uid,
        onMissingFriend: (roomId, friendId) => {
          devLog("[PindMap:chat] 유령 방 제외 roomId=%s friendId=%s", roomId, friendId);
        },
        onFriendRow: (row) => {
          userAvatarCacheRef.current.setFromRow({
            id: row.id,
            username: row.username ?? "",
            avatar_url: row.avatar_url,
          });
        },
      });
      return sortChatRoomsByRecency(rooms);
    })();
    chatRoomsListFetchInFlightRef.current = run;
    try {
      const rooms = await run;
      setChatRooms(rooms);
      chatRoomsListFetchedAtRef.current = Date.now();
      return rooms;
    } finally {
      if (chatRoomsListFetchInFlightRef.current === run) {
        chatRoomsListFetchInFlightRef.current = null;
      }
    }
  };

  const loadData = async (isRetry = false) => {
    const uid = user?.id ?? "";
    if (!isRetry) {
      if (loadDataInFlightRef.current) {
        devLog("[PindMap:home] loadData skipped (in-flight)");
        return;
      }
      const now = perfNow();
      if (
        uid.length > 0 &&
        lastLoadDataUserIdRef.current === uid &&
        lastLoadDataSuccessAtRef.current > 0 &&
        now - lastLoadDataSuccessAtRef.current < LOAD_DATA_DEDUP_MS
      ) {
        devLog("[PindMap:home] loadData skipped (recent success, dedup)");
        return;
      }
    }

    loadDataInFlightRef.current = true;
    const loadDataT0 = perfNow();
    const perfScreen = "home:initial";
    dlog.perf.start(perfScreen);
    dlog.perf.fetchStart(perfScreen);
    try {
      mark("loaddata_start");
    } catch {
      /* ignore */
    }
    devLog("[PindMap:home] 로딩 시작", { isRetry, warmCache: bootstrapCacheHitRef.current });
    // 캐시로 이미 그린 경우 스켈레톤/스피너를 다시 띄우지 않음
    if (!bootstrapCacheHitRef.current) {
      setLoading(true);
    }
    setHomeLoadError(null);
    try {
      // critical path: places / feed / follows / likes only (chat·notifications·avatar await는 스플래시 밖)
      const [placesRes, postsRes, followsRes, myLikesRes] = await withTimeout(Promise.all([
        timedLoadQuery("places", supabase.from("places").select("*").eq("user_id", uid).order("created_at", { ascending: false })),
        timedLoadQuery(
          "feed_posts",
          supabase
            .from("feed_posts")
            .select(FEED_POST_LIST_SELECT)
            .order("created_at", { ascending: false })
            .range(0, FEED_PAGE_SIZE - 1),
        ),
        timedLoadQuery("follows", supabase.from("follows").select("following_id").eq("follower_id", uid)),
        timedLoadQuery(
          "likes",
          (async () => {
            if (!uid) return { data: [] as { post_id: string }[], error: null };
            return supabase.from("likes").select("post_id").eq("user_id", uid);
          })(),
        ),
      ]), 8000);

      const myLikedSet = new Set((myLikesRes.data ?? []).map((l: { post_id: string }) => l.post_id));
      myLikedPostIdsRef.current = myLikedSet;

      setFollowingIds((followsRes.data || []).map((f: any) => f.following_id));
      syncCurrentUserToAvatarCache();

      if (placesRes.data) {
        const mappedPlaces = placesRes.data.map((p) => mapPlaceRow(p));
        mappedPlaces.forEach((place) => {
          const coords = latLngFromRow(place);
          if (coords) savedPlaceCoordsRef.current[place.id] = coords;
        });
        if (!placesAreEqual(mappedPlaces, savedPlacesRef.current)) {
          setSavedPlaces(mappedPlaces);
        }
        if (uid) {
          void writeCachedPlaces(uid, mappedPlaces);
        }
      }
      if (postsRes.data) {
        const rawPosts: FeedPost[] = postsRes.data.map((p: any) =>
          parseFeedPostFromRow(p, { likedByMe: myLikedSet.has(p.id) }),
        );
        feedNextOffsetRef.current = rawPosts.length;
        const hasMore = rawPosts.length >= FEED_PAGE_SIZE;
        feedHasMoreRef.current = hasMore;
        setFeedHasMore(hasMore);
        setFeedPosts(hydrateFeedPostsWithAvatars(rawPosts));
        void prefetchAvatarsForFeedPosts(rawPosts).then(() => {
          setFeedPosts((prev) => hydrateFeedPostsWithAvatars(prev));
        });
      } else {
        feedNextOffsetRef.current = 0;
        feedHasMoreRef.current = false;
        setFeedHasMore(false);
        setFeedPosts([]);
      }

      const map = mapRef.current;
      if (map?.getCenter && map?.getLevel) {
        try {
          const c = map.getCenter();
          const view: CachedMapView = {
            lat: c.getLat(),
            lng: c.getLng(),
            level: map.getLevel(),
          };
          if (Number.isFinite(view.lat) && Number.isFinite(view.lng)) {
            mapViewBootstrapRef.current = view;
            void writeCachedMapView(view);
          }
        } catch {
          /* ignore map snapshot errors */
        }
      }

      homeAutoRetryCountRef.current = 0;
      lastLoadDataSuccessAtRef.current = perfNow();
      lastLoadDataUserIdRef.current = uid;
      dlog.perf.fetchEnd(perfScreen);
      logPerf("loadData", perfNow() - loadDataT0);
      devLog("[PindMap:home] 로딩 완료");
    } catch (err) {
      dlog.perf.fetchEnd(perfScreen);
      logPerf("loadData.failed", perfNow() - loadDataT0);
      console.error("[PindMap:home] 로딩 실패", err);
      const friendlyMessage = "연결이 불안정해요. 다시 시도해주세요 🌐";
      setHomeLoadError(friendlyMessage);
      if (!isRetry && homeAutoRetryCountRef.current < 1) {
        homeAutoRetryCountRef.current += 1;
        devLog("[PindMap:home] 자동 재시도 시작 (1회)");
        setHomeRetrying(true);
        window.setTimeout(() => {
          void loadData(true).finally(() => setHomeRetrying(false));
        }, 350);
      }
    } finally {
      loadDataInFlightRef.current = false;
      setLoading(false);
      try {
        mark("loaddata_done");
      } catch {
        /* ignore */
      }
    }
  };

  const retryHomeLoad = () => {
    setHomeRetrying(true);
    void loadData(true).finally(() => setHomeRetrying(false));
  };

  const loadMoreFeedPosts = async () => {
    if (feedLoadMoreInFlightRef.current || !feedHasMoreRef.current) return;
    feedLoadMoreInFlightRef.current = true;
    setFeedLoadingMore(true);
    try {
      const from = feedNextOffsetRef.current;
      const to = from + FEED_PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("feed_posts")
        .select(FEED_POST_LIST_SELECT)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) {
        console.error("[PindMap:home] feed loadMore failed", error);
        return;
      }
      const rows = data ?? [];
      const liked = myLikedPostIdsRef.current;
      const rawPosts: FeedPost[] = rows.map((p: any) =>
        parseFeedPostFromRow(p, { likedByMe: liked.has(p.id) }),
      );
      feedNextOffsetRef.current = from + rawPosts.length;
      const hasMore = rawPosts.length >= FEED_PAGE_SIZE;
      feedHasMoreRef.current = hasMore;
      setFeedHasMore(hasMore);
      if (rawPosts.length === 0) return;
      setFeedPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const appended = rawPosts.filter((p) => !seen.has(p.id));
        return hydrateFeedPostsWithAvatars([...prev, ...appended]);
      });
      void prefetchAvatarsForFeedPosts(rawPosts).then(() => {
        setFeedPosts((prev) => hydrateFeedPostsWithAvatars(prev));
      });
    } finally {
      feedLoadMoreInFlightRef.current = false;
      setFeedLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!sessionChecked) return;
    if (userLoading) return;
    if (!user?.id) {
      lastLoadDataSuccessAtRef.current = 0;
      lastLoadDataUserIdRef.current = "";
    }
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
          if (!ok) {
            await redirectUnauthenticated();
            return;
          }
          return;
        }
        const ok = await reloadUserWithTimeout();
        if (cancelled) return;
        if (!ok) {
          await redirectUnauthenticated();
          return;
        }
        session = await verifySessionQuick();
        if (cancelled) return;
        if (!session?.user) {
          await redirectUnauthenticated();
        }
      } catch (e) {
        console.error("[PindMap:home][auth] login gate failed", e);
        if (!cancelled) await redirectUnauthenticated();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, userLoading, sessionChecked, router, verifySessionQuick, reloadUserWithTimeout, redirectUnauthenticated]);

  useEffect(() => {
    if (!sessionChecked || userLoading || !user || loading) return;
    dlog.perf.markRender("home:initial");
  }, [sessionChecked, userLoading, user, loading]);

  /** 네이티브 스플래시: 캐시 히트면 인증 직후 hide, 미스면 기존처럼 loadData 대기 */
  useEffect(() => {
    if (!sessionChecked || userLoading) return;
    if (!user) {
      void hideNativeSplash();
      return;
    }
    if (!bootstrapCacheResolved) return;
    if (bootstrapCacheHit) {
      void hideNativeSplash();
      track("app_open");
      return;
    }
    if (loading) return;
    void hideNativeSplash();
    track("app_open");
  }, [sessionChecked, userLoading, user, loading, bootstrapCacheResolved, bootstrapCacheHit]);

  /** 인증과 병렬: Preferences 캐시로 places/mapview 즉시 반영 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        try {
          mark("cache_read_start");
        } catch {
          /* ignore */
        }
        const [placesPayload, mapView] = await Promise.all([readCachedPlaces(), readCachedMapView()]);
        if (cancelled) return;
        if (mapView) {
          mapViewBootstrapRef.current = mapView;
        }
        if (placesPayload && placesPayload.places.length > 0) {
          const uid = userIdRef.current;
          if (uid && uid !== placesPayload.userId) {
            bootstrapCacheHitRef.current = false;
            setBootstrapCacheHit(false);
          } else {
            bootstrapCacheUserIdRef.current = placesPayload.userId;
            const asPlaces = placesPayload.places.map((p) =>
              mapPlaceRow({
                id: p.id,
                name: p.name,
                address: p.address,
                category: p.category,
                lat: p.lat,
                lng: p.lng,
              }),
            );
            asPlaces.forEach((place) => {
              const coords = latLngFromRow(place);
              if (coords) savedPlaceCoordsRef.current[place.id] = coords;
            });
            setSavedPlaces(asPlaces);
            bootstrapCacheHitRef.current = true;
            setBootstrapCacheHit(true);
            setLoading(false);
          }
        } else {
          bootstrapCacheHitRef.current = false;
          setBootstrapCacheHit(false);
        }
      } catch (err) {
        console.error("[PindMap:home] bootstrap cache read failed", err);
        bootstrapCacheHitRef.current = false;
        setBootstrapCacheHit(false);
      } finally {
        try {
          mark("cache_read_done");
        } catch {
          /* ignore */
        }
        if (!cancelled) setBootstrapCacheResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 로그인 유저가 캐시 소유자와 다르면 캐시 폐기 */
  useEffect(() => {
    if (!user?.id || !bootstrapCacheResolved) return;
    const cachedUid = bootstrapCacheUserIdRef.current;
    if (!cachedUid || cachedUid === user.id) return;
    bootstrapCacheHitRef.current = false;
    setBootstrapCacheHit(false);
    bootstrapCacheUserIdRef.current = null;
    mapViewBootstrapRef.current = null;
    setSavedPlaces([]);
    void clearHomeBootstrapCache();
  }, [user?.id, bootstrapCacheResolved]);

  /** 스플래시 비차단: 알림·채팅방(+N+1)은 loadData 종료 후 백그라운드 로드 */
  useEffect(() => {
    if (!sessionChecked || userLoading || loading) return;
    const uid = user?.id;
    if (!uid) return;
    let cancelled = false;

    const loadNotificationsBg = async () => {
      try {
        const notificationsRes = await withTimeout(
          timedLoadQuery(
            "notifications",
            supabase
              .from("notifications")
              .select("*")
              .eq("user_id", uid)
              .order("created_at", { ascending: false })
              .limit(50),
          ),
          8000,
        );
        if (cancelled) return;
        const rawNotifications = (notificationsRes.data || []) as Notification[];
        setNotifications(hydrateNotificationsWithAvatars(rawNotifications));
        void prefetchAvatarsForNotifications(rawNotifications).then(() => {
          if (cancelled) return;
          setNotifications((prev) => hydrateNotificationsWithAvatars(prev));
        });
      } catch (err) {
        console.error("[PindMap:home] background notifications load failed", err);
      }
    };

    const loadChatRoomsBg = async () => {
      try {
        await withTimeout(loadChatRoomsList(uid), 8000);
      } catch (err) {
        console.error("[PindMap:home] background chat rooms load failed", err);
      }
    };

    void loadNotificationsBg();
    void loadChatRoomsBg();

    return () => {
      cancelled = true;
    };
  }, [sessionChecked, userLoading, user?.id, loading]);

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
      void redirectUnauthenticated();
      return;
    }
    const timer = window.setTimeout(() => {
      authStallRetryRef.current += 1;
      setAuthRetryPending(true);
      void (async () => {
        try {
          const ok = await reloadUserWithTimeout();
          if (!ok) await redirectUnauthenticated();
        } finally {
          setAuthRetryPending(false);
        }
      })();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [sessionChecked, userLoading, user, reloadUserWithTimeout, redirectUnauthenticated]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!user || userLoading || !sessionChecked) return;
      if (!homeLoadError) return;
      devLog("[PindMap:home] 포그라운드 복귀 - 자동 재시도");
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
    if (!detailPostId) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [detailPostId]);

  useEffect(() => {
    if (!detailPostId) setDetailEntryPhotoIndex(0);
  }, [detailPostId]);

  useEffect(() => {
    if (selectedPlace) track("place_sheet_open");
  }, [selectedPlace]);

  useEffect(() => {
    if (homePlaceSheet) track("place_sheet_open");
  }, [homePlaceSheet]);

  useEffect(() => {
    if (!detailPostId) {
      detailOpenLoggedRef.current = null;
      return;
    }
    track("curation_view");
    detailOpenPerfRef.current = { postId: detailPostId, t: perfNow() };
    detailOpenLoggedRef.current = null;
  }, [detailPostId]);

  useEffect(() => {
    if (!detailPostId || !detailPost || detailPost.id !== detailPostId) return;
    if (detailOpenLoggedRef.current === detailPostId) return;
    const start = detailOpenPerfRef.current;
    if (start?.postId === detailPostId) {
      logPerf("detail.open", perfNow() - start.t);
      detailOpenLoggedRef.current = detailPostId;
    }
  }, [detailPostId, detailPost]);

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
    let candidates: string[] = [];
    if (showCourseModal) {
      candidates = ["course_share"];
    } else if (activeTab === "map" && !mapExpanded) {
      candidates = ["reels_save", "map_search"];
    } else if (activeTab === "map" && mapExpanded) {
      candidates = [];
    } else if (activeTab === "home") {
      candidates = ["curation_new"];
    } else if (activeTab === "saved") {
      candidates = ["course_create"];
    } else if (activeTab === "messages") {
      candidates = ["message_friend"];
    }

    const overlaysOpen =
      showPostModal ||
      showCourseShareModal ||
      showCourseEditScreen ||
      showCourseSaveModal ||
      !!lightboxImg ||
      showNotifications ||
      showJobsModal ||
      !!detailPostId ||
      !!placePostsList ||
      !!sharePost ||
      !!editingPost ||
      isHomeSearchOpen ||
      showProfileEditModal ||
      !!showFollowList ||
      (showCourseModal && !candidates.includes("course_share")) ||
      mapExpanded;

    if (candidates.length === 0 || !user?.id || overlaysOpen) {
      setActiveCoach(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const next = await nextCoachToShow(candidates);
        if (cancelled) return;
        setActiveCoach(next);
      })();
    }, 800);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeTab,
    user?.id,
    showPostModal,
    showCourseModal,
    showCourseShareModal,
    showCourseEditScreen,
    showCourseSaveModal,
    mapExpanded,
    lightboxImg,
    showNotifications,
    showJobsModal,
    detailPostId,
    placePostsList,
    sharePost,
    editingPost,
    isHomeSearchOpen,
    showProfileEditModal,
    showFollowList,
    coachTick,
  ]);

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
        devLog("[PindMap:pin] pruned stale hidden ids", { before: prev.size, after: next.length });
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
    // all_saved 는 사용자가 버튼을 누를 때까지 유지
    if (!showExtractOverlay || !extractOverlayComplete || extractOverlayError) return;
    if (extractOverlayCompleteVariant === "all_saved") return;
    const timer = window.setTimeout(() => {
      setShowExtractOverlay(false);
      setExtractOverlayComplete(false);
      setExtractOverlayError(null);
      setExtractOverlayErrorRaw(null);
      setExtractOverlayCompleteVariant("success");
      setExtractRetryUrl(null);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [
    showExtractOverlay,
    extractOverlayComplete,
    extractOverlayError,
    extractOverlayCompleteVariant,
  ]);

  useEffect(() => {
    if (!user?.id) return;
    const pollingTargets = activeJobs.filter((job) => job.status === "pending" || job.status === "processing");
    if (pollingTargets.length === 0) return;

    const removeJob = (jobId: string) => {
      const pollStart = extractPollStartRef.current[jobId];
      if (pollStart !== undefined) {
        logPerf(`extract.poll.${jobId.slice(0, 8)}`, perfNow() - pollStart);
        delete extractPollStartRef.current[jobId];
      }
      delete pollAttemptsRef.current[jobId];
      pollInFlightRef.current.delete(jobId);
      setActiveJobs((prev) => prev.filter((job) => job.jobId !== jobId));
    };

    const pollJob = async (jobId: string) => {
      if (pollInFlightRef.current.has(jobId)) return;
      if (extractPollStartRef.current[jobId] === undefined) {
        extractPollStartRef.current[jobId] = perfNow();
      }

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
        devLog("[poll]", jobId.slice(0, 8), {
          status: data.status,
          step: data.progress_step,
          placesCount: data.result_places?.length ?? "no_array",
        });
        if (!res.ok) {
          throw new Error(data.error || "작업 상태를 확인할 수 없어요.");
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
          const failedUrl =
            activeJobs.find((j) => j.jobId === jobId)?.instagramUrl ?? null;
          removeJob(jobId);
          const places = data.result_places ?? [];
          if (places.length === 0) {
            // all_saved_already 는 서버가 신규 insert 없이 끝난 경우만
            if (nextStep.includes("all_saved_already")) {
              setExtractOverlayError(null);
              setExtractOverlayErrorRaw(null);
              setExtractOverlayCompleteVariant("all_saved");
              setExtractOverlayComplete(true);
              setShowExtractOverlay(true);
            } else {
              const userMsg = "장소를 찾지 못했어요. 다른 릴스로 시도해 주세요";
              setError(userMsg);
              setExtractOverlayError(userMsg);
              setExtractOverlayErrorRaw(EXTRACT_EMPTY_RESULT_RAW);
              setExtractRetryUrl(failedUrl);
              setExtractOverlayComplete(false);
              setExtractOverlayCompleteVariant("success");
              setShowExtractOverlay(true);
            }
            setStatus("");
            devLog("[PindMap:url] extraction message hidden (empty result_places)");
            return;
          }

          // 서버가 result_places 를 준 경우(= insert 성공)는 로컬 savedPlaces 와
          // 이름+주소 비교로 "이미 있음" 처리하지 않는다.
          // (폴링 전에 DB 동기화가 된 경우 성공인데도 중복 토스트가 뜨는 레이스 방지)
          const existingIds = new Set(savedPlaces.map((p) => String(p.id)));
          const merged: Place[] = places.map((p) => {
            const coords = latLngFromRow(p);
            const id =
              typeof p.id === "string" && p.id.trim().length > 0
                ? p.id.trim()
                : `${Math.random().toString(36).substring(2)}${Date.now().toString(36)}`;
            return {
              id,
              name: p.name,
              address: p.address,
              category: p.category as Category,
              ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
            };
          });
          const newlyAddedCount = merged.filter((m) => !existingIds.has(m.id)).length;
          const displayCount = newlyAddedCount > 0 ? newlyAddedCount : merged.length;
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
          showToast(`✨ ${displayCount}개 장소를 추가했어요`, "success");
          setStatus("");
          setExtractOverlayError(null);
          setExtractOverlayErrorRaw(null);
          setExtractOverlayCompleteVariant("success");
          setExtractOverlayComplete(true);
          setShowExtractOverlay(true);
          devLog("[PindMap:url] extraction message hidden (success)", {
            resultPlaces: places.length,
            newlyAddedCount,
          });
          return;
        }

        if (nextStatus === "failed") {
          const userMsg = mapExtractErrorToUserMessage(data.error_message);
          const failedUrl =
            activeJobs.find((j) => j.jobId === jobId)?.instagramUrl ?? null;
          setStatus("");
          setError(userMsg);
          setExtractOverlayError(userMsg);
          setExtractOverlayErrorRaw(
            typeof data.error_message === "string" ? data.error_message : null,
          );
          setExtractRetryUrl(failedUrl);
          setExtractOverlayComplete(false);
          setShowExtractOverlay(true);
          devLog("[PindMap:url] extraction message hidden (failed)");
          removeJob(jobId);
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : "작업 상태 확인 중 오류가 발생했어요.";
        const userMsg = mapExtractErrorToUserMessage(raw);
        const failedUrl =
          activeJobs.find((j) => j.jobId === jobId)?.instagramUrl ?? null;
        setStatus("");
        setError(userMsg);
        setExtractOverlayError(userMsg);
        setExtractOverlayErrorRaw(raw);
        setExtractRetryUrl(failedUrl);
        setExtractOverlayComplete(false);
        setShowExtractOverlay(true);
        devLog("[PindMap:url] extraction message hidden (failed)");
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
  }, [activeJobs, user?.id, showToast]);

  const addPlace = async (place: Place) => {
    if (!userIdRef.current) {
      showToast("로그인 후 이용해주세요", "info");
      return;
    }

    const optimisticPlace = { ...place };
    savedPlacesRef.current = [optimisticPlace, ...savedPlacesRef.current.filter((p) => p.id !== place.id)];
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
        savedPlacesRef.current = savedPlacesRef.current.filter((p) => p.id !== place.id);
        setSavedPlaces((prev) => prev.filter((p) => p.id !== place.id));
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string | null };
        const err = new Error(data.error || "save_failed");
        if (data.code) (err as Error & { code?: string }).code = String(data.code);
        else if (res.status === 401 || res.status === 403) (err as Error & { code?: string }).code = String(res.status);
        throw err;
      }
    } catch (err) {
      savedPlacesRef.current = savedPlacesRef.current.filter((p) => p.id !== place.id);
      setSavedPlaces((prev) => prev.filter((p) => p.id !== place.id));
      showToast(toUserMessage(err, "저장에 실패했어요"), "error");
    }
  };
  const deletePlace = async (id: string) => {
    const previous = savedPlacesRef.current.slice();
    savedPlacesRef.current = savedPlacesRef.current.filter((p) => p.id !== id);
    setSavedPlaces((prev) => prev.filter((p) => p.id !== id));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("세션 만료");

      const res = await fetch(`/api/places/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        savedPlacesRef.current = previous;
        setSavedPlaces(previous);
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string | null };
        const err = new Error(data.error || "delete_failed");
        if (data.code) (err as Error & { code?: string }).code = String(data.code);
        else if (res.status === 401 || res.status === 403) (err as Error & { code?: string }).code = String(res.status);
        throw err;
      }
    } catch (err) {
      savedPlacesRef.current = previous;
      setSavedPlaces(previous);
      showToast(toUserMessage(err, "삭제에 실패했어요"), "error");
    }
  };
  const submitPost = async (
    post: FeedPost,
  ): Promise<{ error: string | null; alreadyExists?: boolean }> => {
    if (!isCompanionTag(post.companionTag)) {
      alert("동행 태그를 선택해주세요.");
      return { error: "invalid_companion_tag" };
    }
    const coords = latLngFromRow(post);
    const uid = user?.id || "";
    const placeName = (post.placeName || "").trim();
    const address = (post.address || "").trim();
    // 연타 레이스: 조회→insert 틈 방어 — 동일 장소 60초 내 글이면 insert 생략
    if (uid && placeName) {
      const sinceIso = new Date(Date.now() - 60_000).toISOString();
      const { data: recent } = await supabase
        .from("feed_posts")
        .select("id")
        .eq("user_id", uid)
        .eq("place_name", placeName)
        .eq("address", address)
        .eq("archived", false)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recent) {
        return { error: null, alreadyExists: true };
      }
    }
    const { error } = await supabase.from("feed_posts").insert({
      id: post.id,
      user_id: uid,
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
      aspect_ratio: post.aspectRatio ?? "1:1",
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
    devLog("[PindMap:apple-maps] open place", { label, lat, lng, hasCoord, isIOSLike });
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
    devLog("[PindMap:apple-maps] open course route", { stops: coordChain.length, isIOSLike });
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
    devLog("[PindMap:mypage] profile edit button clicked", { uid: user?.id, username: user?.username });
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
    devLog("[PindMap:account] 계정 삭제 버튼 클릭");
    setShowDeleteAccountModal(true);
  };

  const closeDeleteAccountFlow = () => {
    setShowDeleteAccountModal(false);
    setShowDeleteAccountFinalModal(false);
    setDeleteAccountPhraseInput("");
    setDeleteAccountLoading(false);
  };

  const goToFinalDeleteConfirmation = () => {
    devLog("[PindMap:account] 1차 확인 — 삭제 진행");
    setShowDeleteAccountModal(false);
    setDeleteAccountPhraseInput("");
    setShowDeleteAccountFinalModal(true);
  };

  const executePermanentAccountDeletion = async () => {
    if (deleteAccountPhraseInput.trim() !== "삭제") {
      devLog("[PindMap:account] 확인 문구 불일치", deleteAccountPhraseInput);
      return;
    }
    devLog("[PindMap:account] 영구 삭제 API 호출");
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
    devLog("[PindMap:mypage] saving profile", { uid: user.id, nextName, avatarChanged, bioChanged });
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
      showToast(toUserMessage(err, "프로필 저장에 실패했어요"), "error");
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
      if (!error) {
        setMyCourses(data);
        mypageTabFetchedAtRef.current = Date.now();
      }
    } catch {
      /* keep existing list */
    } finally {
      setCoursesLoading(false);
    }
  }, [user?.id]);

  const refreshMypageFollowCounts = useCallback(async () => {
    if (!user?.id) return;
    const uid = user.id;
    const [followersRes, followingsRes] = await Promise.all([
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_id", uid),
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", uid),
    ]);
    setMypageFollowerCount(followersRes.count ?? 0);
    setMypageFollowingCount(followingsRes.count ?? 0);
  }, [user?.id]);

  /** 마이페이지 탭 묶음 조회 — 30s TTL (코스 CRUD·팔로우는 별도 즉시 갱신) */
  const runMypageTabFetchIfStale = useCallback(async () => {
    if (!user?.id) return;
    const now = Date.now();
    if (
      mypageTabFetchedAtRef.current > 0 &&
      now - mypageTabFetchedAtRef.current < MYPAGE_TAB_TTL_MS
    ) {
      return;
    }
    mypageTabFetchedAtRef.current = now;
    const perfScreen = "tab:mypage:fetch";
    dlog.perf.start(perfScreen);
    dlog.perf.fetchStart(perfScreen);
    try {
      await Promise.all([
        refreshMyTotalLikes(),
        refreshMyCourses(),
        refreshMypageFollowCounts(),
      ]);
    } finally {
      dlog.perf.fetchEnd(perfScreen);
      dlog.perf.markRender(perfScreen);
    }
  }, [user?.id, refreshMyTotalLikes, refreshMyCourses, refreshMypageFollowCounts]);

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
    track("course_view");
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
        showToast(toUserMessage(error, "코스를 수정하지 못했어요"), "error");
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
        showToast(toUserMessage(error, "제목을 변경하지 못했어요"), "error");
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
        showToast(toUserMessage(error, "코스를 삭제하지 못했어요"), "error");
        return;
      }
      showToast("코스를 삭제했어요", "success");
      setMyCourses((prev) => prev.filter((c) => c.id !== targetId));
      void refreshMyCourses();
    } finally {
      setCourseDeleting(false);
    }
  };

  const loadMyMypagePosts = useCallback(async (opts?: { append?: boolean }) => {
    const append = opts?.append === true;
    const uid = userIdRef.current;
    if (!uid) {
      setMyMypagePosts([]);
      setMyMypagePostsCount(0);
      return;
    }
    if (myMypagePostsLoadingRef.current) return;
    myMypagePostsLoadingRef.current = true;
    setMyMypagePostsLoading(true);
    try {
      const offset = append ? myMypagePostsRef.current.length : 0;
      const { data, error, count } = await supabase
        .from("feed_posts")
        .select(FEED_POST_LIST_SELECT, { count: "exact" })
        .eq("user_id", uid)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .range(offset, offset + MYPAGE_POSTS_PAGE_SIZE - 1);
      if (error) {
        console.error("[PindMap:mypage] posts load failed", error);
        return;
      }
      const liked = myLikedPostIdsRef.current;
      const rawPosts: FeedPost[] = (data ?? []).map((p: any) =>
        parseFeedPostFromRow(p, { likedByMe: liked.has(p.id) }),
      );
      const hydrated = hydrateFeedPostsWithAvatars(rawPosts);
      if (append) {
        setMyMypagePosts((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...hydrated.filter((p) => !seen.has(p.id))];
        });
      } else {
        setMyMypagePosts(hydrated);
      }
      setMyMypagePostsCount(typeof count === "number" ? count : offset + rawPosts.length);
      void prefetchAvatarsForFeedPosts(rawPosts).then(() => {
        setMyMypagePosts((prev) => hydrateFeedPostsWithAvatars(prev));
      });
    } finally {
      myMypagePostsLoadingRef.current = false;
      setMyMypagePostsLoading(false);
    }
  }, [hydrateFeedPostsWithAvatars, prefetchAvatarsForFeedPosts]);

  const deletePost = async (id: string) => {
    const deleted =
      feedPosts.find((p) => p.id === id) ?? myMypagePosts.find((p) => p.id === id);
    await supabase.from("feed_posts").delete().eq("id", id);
    setFeedPosts((prev) => prev.filter((p) => p.id !== id));
    setMyMypagePosts((prev) => prev.filter((p) => p.id !== id));
    setOpenMenuId(null);
    if (deleted?.userId === user?.id) {
      void refreshMyTotalLikes();
    }
    if (user?.id) {
      void loadMyMypagePosts();
    }
  };
  const toggleArchive = async (id: string) => {
    const post =
      feedPosts.find((p) => p.id === id) ?? myMypagePosts.find((p) => p.id === id);
    if (!post) return;
    await supabase.from("feed_posts").update({ archived: !post.archived }).eq("id", id);
    setFeedPosts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, archived: !p.archived } : p)),
    );
    setOpenMenuId(null);
    if (post.userId === user?.id) {
      void loadMyMypagePosts();
    }
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
    setFeedPosts(prev => prev.map(p => p.id === postId ? {
      ...p,
      comments: [...p.comments, newC],
      commentsCount: feedCommentCount(p) + 1,
    } : p));

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
    setFeedPosts(prev => prev.map(p => p.id === postId ? {
      ...p,
      comments: p.comments.filter(c => c.id !== commentId),
      commentsCount: Math.max(0, feedCommentCount(p) - 1),
    } : p));
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
        devLog("[PindMap:realtime] remount attempt", { channelKey, attempt: retryCount + 1 });
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
    devLog("[PindMap:message] subscription unmounted", reason);
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
    devLog("[PindMap:message] subscription mounted", roomId);
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
    track("message_room_open");
    const fromId = activeChatRoom?.id ?? null;
    const reqId = ++openChatRequestRef.current;
    devLog("[PindMap:message] chatroom switched", { from: fromId, to: room.id });
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
    devLog("[PindMap:message] send start", { id, roomId });
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
      devLog("[PindMap:message] send success", { id, roomId });
      track("message_send");
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
    devLog("[PindMap:message] resend start", { id, roomId });
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
      devLog("[PindMap:message] resend success", { id, roomId });
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

  // 저장 목록 장소 클릭 → 지도 탭 + 컴팩트 맵 이동 + 시트 (전체화면 X)
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
      return;
    }
    if (mapRef.current && geocoderRef.current) {
      geocoderRef.current.addressSearch(place.address, (result: any[], sv: string) => {
        if (sv !== window.kakao.maps.services.Status.OK || !result[0]) return;
        const markerLat = parseFloat(result[0].y);
        const markerLng = parseFloat(result[0].x);
        mapRef.current.setCenter(new window.kakao.maps.LatLng(result[0].y, result[0].x));
        mapRef.current.setLevel(4);
        savedPlaceCoordsRef.current[place.id] = { lat: markerLat, lng: markerLng };
        setSelectedPlace(toSelectedFromSavedPlace(place, relatedPosts, markerLat, markerLng));
      });
      return;
    }
    // 맵 인스턴스가 아직 없으면 시트만이라도 표시
    if (stored) {
      setSelectedPlace(toSelectedFromSavedPlace(place, relatedPosts, stored.lat, stored.lng));
    } else {
      setSelectedPlace(toSelectedFromSavedPlace(place, relatedPosts));
    }
  };

  /** 장소 시트 → 전체화면 지도 (클릭 좌표 우선, useMyLocation 무시) */
  const expandPlaceSheetToFullscreen = useCallback(
    (placeData: PlaceSheetData) => {
      const lat = parseFloat(String(placeData.y ?? ""));
      const lng = parseFloat(String(placeData.x ?? ""));
      const hasCoord = Number.isFinite(lat) && Number.isFinite(lng);
      if (hasCoord && mapRef.current && window.kakao?.maps) {
        mapRef.current.setCenter(new window.kakao.maps.LatLng(lat, lng));
        mapRef.current.setLevel(4);
      }
      if (hasCoord) {
        focusExpandedMapOnLatLng(lat, lng, 3);
        const saved = resolveSavedMatch(placeData);
        const markerId = saved ? `place-${saved.id}` : undefined;
        if (saved) {
          placePinByIdRef.current.set(`place-${saved.id}`, saved);
        }
        // 네이티브 present 진입 시 restore snapshot 으로 좌표 카메라 강제
        fullscreenRestorePendingRef.current = true;
        fullscreenReturnStateRef.current = {
          mode: "saved",
          camera: {
            lat,
            lng,
            zoom: FULLSCREEN_NATIVE_NEIGHBORHOOD_ZOOM,
          },
          selectedMarkerId: markerId,
        };
      }
      setMapExpanded(true);
    },
    [focusExpandedMapOnLatLng, resolveSavedMatch],
  );

  /** 컴팩트 시트 길찾기 — 전체화면 검색과 동일하게 네이티브 경로(또는 웹 drawRoute) 사용 */
  const startDirectionsFromPlaceSheet = useCallback(
    async (placeData: PlaceSheetData, mode: "car" | "walk" | "transit") => {
      const lat = parseFloat(String(placeData.y ?? ""));
      const lng = parseFloat(String(placeData.x ?? ""));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        showToast("이 장소는 위치 정보가 없어 길찾기를 할 수 없어요", "info");
        return;
      }
      const destName = String(placeData.place_name ?? "장소");
      if (mode === "transit") {
        openTransitInKakaoMap(destName, lat, lng);
        return;
      }

      const saved = resolveSavedMatch(placeData);
      const destId = saved ? `place-${saved.id}` : `sheet-${lat.toFixed(5)},${lng.toFixed(5)}`;

      // iOS 네이티브: 전체화면 검색 길찾기와 동일 경로
      if (isNativeMapAvailable()) {
        expandPlaceSheetToFullscreen(placeData);
        setDirectionsMode(mode);
        setDirectionsLoading(true);
        try {
          await waitForFullscreenNativeMapReady();
          if (mode === "walk") {
            await runFullscreenNativeDirections({ id: destId, lat, lng });
            return;
          }
          // 자동차: 웹 drawRoute 와 같은 /api/directions → 네이티브 폴리라인
          const resolveOrigin = async (): Promise<{ lat: number; lng: number } | null> => {
            const stored = myLocationLatLngRef.current;
            if (stored && Number.isFinite(stored.lat) && Number.isFinite(stored.lng)) {
              return stored;
            }
            return await new Promise((resolve) => {
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  const o = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                  myLocationLatLngRef.current = o;
                  resolve(o);
                },
                () => resolve(null),
              );
            });
          };
          const origin = await resolveOrigin();
          if (!origin) {
            showToast("현재 위치를 가져올 수 없어요", "error");
            return;
          }
          const res = await fetch("/api/directions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              origin,
              destination: { lat, lng },
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
          route.sections.forEach((section: any) => {
            section.roads.forEach((road: any) => {
              for (let i = 0; i < road.vertexes.length; i += 2) {
                path.push({ lat: road.vertexes[i + 1], lng: road.vertexes[i] });
              }
            });
          });
          if (path.length < 2) {
            showToast("경로를 찾을 수 없어요", "error");
            return;
          }
          await setFullscreenNativeRoute({ path, mode: "car" }, { silent: false });
          const summary = route.summary;
          if (summary) {
            setDirectionsInfo({
              duration: Math.round(summary.duration / 60),
              distance: Math.round((summary.distance / 1000) * 10) / 10,
            });
            await setFullscreenNativeDirectionsInfo(
              {
                id: destId,
                duration: Math.round(summary.duration / 60),
                distance: Math.round(summary.distance),
              },
              { silent: false },
            );
          }
        } catch (err) {
          console.error("[sheet] directions failed", err);
          showToast("길찾기에 실패했어요", "error");
        } finally {
          setDirectionsLoading(false);
        }
        return;
      }

      // 웹 확장 맵: 기존 drawRoute
      setMapExpanded(true);
      setDirectionsMode(mode);
      window.setTimeout(() => {
        void drawRoute(lat, lng, mode);
      }, 600);
    },
    [
      expandPlaceSheetToFullscreen,
      resolveSavedMatch,
      runFullscreenNativeDirections,
      showToast,
    ],
  );

  /** 큐레이션 상세 → 저장된 장소면 저장 클릭과 동일, 아니면 임시로 지도만 열고 빈 하트(미저장) */
  const goToMapFromDetailPost = () => {
    if (!detailPost) return;
    const rep = getRepresentativePlaceForPost(detailPost);
    const name = rep.placeName.trim();
    const addr = rep.address.trim();
    const matchedPlace = savedPlaces.find(
      (p) => String(p.name).trim() === name && String(p.address).trim() === addr,
    );
    if (matchedPlace) {
      handleSavedPlaceClick(matchedPlace);
      setDetailPostId(null);
      return;
    }

    const postCoords =
      rep.lat != null && rep.lng != null ? { lat: rep.lat, lng: rep.lng } : latLngFromRow(detailPost);
    setActiveTab("map");
    if (postCoords && mapRef.current) {
      mapRef.current.setCenter(new window.kakao.maps.LatLng(postCoords.lat, postCoords.lng));
      mapRef.current.setLevel(4);
      const detailRef = placeRefFromFeedPost(detailPost);
      const relatedPosts = getRelatedPostsForPlaceSheet(feedPosts, detailRef);
      setSelectedPlace({
        place_name: rep.placeName,
        category_name: rep.category,
        road_address_name: rep.address,
        address_name: rep.address,
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
      geocoderRef.current.addressSearch(rep.address, (result: any[], sv: string) => {
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
        new window.kakao.maps.services.Places().keywordSearch(rep.placeName, (data: any[], st: string) => {
          const base =
            st === window.kakao.maps.services.Status.OK && data[0]
              ? data[0]
              : {
                  place_name: rep.placeName,
                  category_name: rep.category,
                  road_address_name: rep.address,
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

  const openMapFullscreen = useCallback(() => {
    track("map_fullscreen_open");
    setMapExpanded(true);
  }, []);

  const expandReelInput = useCallback(() => {
    track("reels_input_open");
    setReelInputExpanded(true);
  }, []);

  const collapseReelInput = useCallback(() => {
    setReelInputExpanded(false);
  }, []);

  useEffect(() => {
    if (!reelInputExpanded) return;
    const timer = window.setTimeout(() => {
      instagramUrlInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reelInputExpanded]);

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
    track("follow");
    setFollowingIds(prev => [...prev, targetUser.id]);
    setMypageFollowingCount((prev) => prev + 1);
    mypageTabFetchedAtRef.current = Date.now();

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
    setMypageFollowingCount((prev) => Math.max(0, prev - 1));
    mypageTabFetchedAtRef.current = Date.now();
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
    if (courseShareLoading || courseInviteImageBusy) return;
    setShowCourseShareModal(false);
    setSharingCourse(null);
    setCourseShareFriendRooms([]);
    setCourseShareSendingRoomId(null);
    setCourseShareSearchQuery("");
    setCourseShareSentRoomIds([]);
    setCourseInviteImageBusy(false);
  };

  const applyCourseInviteImageLocal = (courseId: string, inviteImage: string | null) => {
    setSharingCourse((prev) => (prev && prev.id === courseId ? { ...prev, invite_image: inviteImage } : prev));
    setMyCourses((prev) =>
      prev.map((c) => (c.id === courseId ? { ...c, invite_image: inviteImage } : c)),
    );
    setCourseCache((prev) => {
      const hit = prev[courseId];
      if (!hit) return prev;
      return { ...prev, [courseId]: { ...hit, invite_image: inviteImage } };
    });
  };

  const openCourseInviteImagePicker = () => {
    try {
      const input = courseInviteImageInputRef.current;
      if (!input) {
        showToast("사진 선택을 열 수 없어요. 다시 시도해 주세요", "error");
        return;
      }
      input.click();
    } catch (err) {
      console.error("[course-invite-image] open picker failed", err);
      showToast("사진 선택을 열 수 없어요", "error");
    }
  };

  const handleCourseInviteImageFile = async (file: File | null) => {
    if (!file || !sharingCourse || !user?.id) return;
    if (sharingCourse.user_id !== user.id) {
      showToast("내 코스의 초대장만 바꿀 수 있어요", "info");
      return;
    }
    if (courseInviteImageBusy || courseShareLoading) return;
    if (!file.type.startsWith("image/")) {
      showToast("이미지 파일만 올릴 수 있어요", "error");
      return;
    }
    setCourseInviteImageBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        showToast("로그인이 필요합니다.", "error");
        return;
      }
      const prepared = await prepareImageForUpload(file);
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}-invite.jpg`;
      const formData = new FormData();
      formData.append("file", prepared, fileName);
      formData.append("fileName", fileName);
      const res = await fetch("/api/upload/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
        credentials: "include",
      });
      const uploadData = (await res.json().catch(() => ({}))) as {
        publicUrl?: string;
        error?: string;
      };
      if (!res.ok || !uploadData.publicUrl) {
        throw new Error(uploadData.error || `사진 업로드 실패 (${res.status})`);
      }
      const publicUrl = uploadData.publicUrl;
      const { data, error } = await updateCourseInviteImage(sharingCourse.id, publicUrl);
      if (error || !data) {
        showToast(error || "초대장 이미지를 저장하지 못했어요", "error");
        return;
      }
      applyCourseInviteImageLocal(sharingCourse.id, data.invite_image ?? publicUrl);
      showToast("초대장 이미지를 바꿨어요", "success");
    } catch (err) {
      console.error("[course-invite-image] upload failed", err);
      showToast(err instanceof Error ? err.message : "이미지 업로드에 실패했어요", "error");
    } finally {
      setCourseInviteImageBusy(false);
      if (courseInviteImageInputRef.current) courseInviteImageInputRef.current.value = "";
    }
  };

  const handleResetCourseInviteImage = async () => {
    if (!sharingCourse || !user?.id) return;
    if (sharingCourse.user_id !== user.id) return;
    if (courseInviteImageBusy || courseShareLoading) return;
    if (!sharingCourse.invite_image) {
      showToast("이미 기본 이미지예요", "info");
      return;
    }
    setCourseInviteImageBusy(true);
    try {
      const { data, error } = await updateCourseInviteImage(sharingCourse.id, null);
      if (error || !data) {
        showToast(error || "기본 이미지로 바꾸지 못했어요", "error");
        return;
      }
      applyCourseInviteImageLocal(sharingCourse.id, null);
      showToast("기본 이미지로 바꿨어요", "success");
    } finally {
      setCourseInviteImageBusy(false);
    }
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
      devLog("[PindMap:course-share] open modal blocked: no user");
      showToast("로그인 후 코스를 공유할 수 있어요", "info");
      return;
    }
    devLog("[PindMap:course-share] open modal", course.id);
    track("course_share_open");
    setSharingCourse({
      ...course,
      invite_image:
        course.invite_image ??
        myCourses.find((c) => c.id === course.id)?.invite_image ??
        courseCache[course.id]?.invite_image ??
        null,
    });
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
    devLog("[PindMap:course-share] friend rooms", rooms.length);
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
      devLog("[PindMap:course-share] blocked: no course id", {
        savedCourseId,
        refId: viewingSavedCourseIdRef.current,
      });
      showToast("코스 정보를 불러오는 중이에요. 잠시 후 다시 시도해주세요", "info");
      return;
    }
    if (!user?.id) {
      devLog("[PindMap:course-share] blocked: no user", courseId);
      showToast("로그인 후 코스를 공유할 수 있어요", "info");
      return;
    }
    if (!courseResult?.length) {
      devLog("[PindMap:course-share] blocked: empty places", courseId);
      showToast("공유할 장소가 없어요", "info");
      return;
    }
    const ownerId =
      viewedCourseUserId ?? courseCache[courseId]?.user_id ?? user.id;
    const inviteFromCache =
      myCourses.find((c) => c.id === courseId)?.invite_image ??
      courseCache[courseId]?.invite_image ??
      null;
    const tempCourse: SavedCourse = {
      id: courseId,
      user_id: ownerId,
      title: editingCourseTitle,
      items: courseResult.map(coursePlaceToSavedItem),
      place_count: courseResult.length,
      created_at: "",
      updated_at: "",
      invite_image: inviteFromCache,
    };
    devLog("[PindMap:course-share] open from sheet", courseId, courseResult.length);
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
        showToast(toUserMessage(error, "코스를 불러오지 못했어요"), "error");
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
    track("course_map_view");
    const uid = userIdRef.current;
    const nativeAvail = isNativeMapAvailable();
    const useAdminCourseMapDesign = uid === ADMIN_USER_ID;
    logAdminCourseMap(uid, "showCourseOnMap", {
      uid,
      uidLen: uid.length,
      adminId: ADMIN_USER_ID,
      uidMatch: uid === ADMIN_USER_ID,
      nativeAvail,
      useAdminCourseMapDesign,
      courseCount: courseResult.length,
      willUseWebMap: !nativeAvail || useAdminCourseMapDesign,
    });
    returnToCourseSheetRef.current = true;
    setShowCourseModal(false);
    setShowCourseRoute(true);
    setCourseNavigation(null);
    setCourseNavSegmentIndex(null);
    setCourseNavFocusMode(false);
    setCourseNavStepIndex(null);
    fullscreenCourseNavigationRef.current = null;
    setCourseDesignPath(null);
    setActiveTab("map");
    // 관리자 실험: iOS도 네이티브 대신 웹 전체화면 지도
    if (nativeAvail && !useAdminCourseMapDesign) {
      logAdminCourseMap(uid, "showCourseOnMap → native branch (non-admin)");
      fullscreenCourseRef.current = [...courseResult];
      setMapExpanded(true);
      return;
    }
    logAdminCourseMap(uid, "showCourseOnMap → web branch, schedule drawCourseRoute@800ms");
    setMapExpanded(true);
    // 지도가 그려진 후에 마커와 폴리라인 그리기 (살짝 딜레이)
    setTimeout(() => void drawCourseRoute(), 800);
  };

  // 전체화면 지도에 코스 경로 그리기
  const drawCourseRoute = async () => {
    if (!courseResult) return;
    const uid = userIdRef.current;
    if (!expandedMapRef.current || !window.kakao?.maps) {
      logAdminCourseMap(uid, "drawCourseRoute wait map", {
        hasMap: !!expandedMapRef.current,
        hasKakao: !!window.kakao?.maps,
        retry: drawCourseRouteRetryRef.current,
      });
      if (drawCourseRouteRetryRef.current < 2) {
        drawCourseRouteRetryRef.current += 1;
        window.setTimeout(
          () => void drawCourseRoute(),
          !expandedMapRef.current ? 200 : 1000,
        );
      }
      return;
    }
    drawCourseRouteRetryRef.current = 0;
    // 기존 경로·마커·라벨 지우기
    clearRoute();
    searchMarkersRef.current.forEach((m) => m.setMap(null));
    searchMarkersRef.current = [];
    courseLabelOverlaysRef.current.forEach((o) => o.setMap(null));
    courseLabelOverlaysRef.current = [];

    const useAdminCourseMapDesign = uid === ADMIN_USER_ID;
    logAdminCourseMap(uid, "drawCourseRoute start", {
      useAdminCourseMapDesign,
      courseCount: courseResult.length,
      mapNode: !!expandedMapRef.current.getNode?.(),
    });
    const stops: LatLng[] = [];
    const stopNames: string[] = [];
    const bounds = new window.kakao.maps.LatLngBounds();

    if (useAdminCourseMapDesign) {
      courseResult.forEach((place) => {
        const pos = new window.kakao.maps.LatLng(place.lat, place.lng);
        stops.push({ lat: place.lat, lng: place.lng });
        stopNames.push(place.name);
        bounds.extend(pos);
      });
      const initialPath = stops.length >= 2 ? stops : [];
      setCourseDesignPath(initialPath);
      logAdminCourseMap(uid, "drawCourseRoute admin: setCourseDesignPath (stops)", {
        stops: stops.length,
        pathPts: initialPath.length,
        sample: stops[0],
      });
      expandedMapRef.current.setBounds(bounds);
      if (stops.length < 2) return;

      setDirectionsLoading(true);
      try {
        const navigation = await buildCourseWalkNavigationFromTmap(stops, stopNames);
        if (!expandedMapRef.current || !courseResult) return;
        fullscreenCourseNavigationRef.current = navigation;
        setCourseNavigation(navigation);
        setCourseNavSegmentIndex(navigation.segments.length > 0 ? 0 : null);
        setCourseNavFocusMode(false);
        setCourseNavStepIndex(
          navigation.segments[0]?.steps.length ? 0 : null,
        );
        setCourseDesignPath(navigation.mergedPath);
        logAdminCourseMap(uid, "drawCourseRoute admin: tmap path applied", {
          merged: navigation.mergedPath.length,
          segments: navigation.segments.length,
        });
      } catch (err) {
        console.error("[course] web route failed", err);
        setCourseDesignPath(stops);
        logAdminCourseMap(uid, "drawCourseRoute admin: tmap failed, fallback stops", err);
      } finally {
        setDirectionsLoading(false);
      }
      return;
    }

    setCourseDesignPath(null);
    const mapNode = expandedMapRef.current.getNode?.() as HTMLElement | undefined;
    const mapWidth = mapNode?.clientWidth || window.innerWidth || 375;
    type LabelPlan = {
      place: CoursePlace;
      pos: any;
      idx: number;
      side: "left" | "right";
      yNudge: number;
      screenX: number;
      screenY: number;
    };
    const labelPlans: LabelPlan[] = [];
    const total = courseResult.length;

    courseResult.forEach((place, idx) => {
      const pos = new window.kakao.maps.LatLng(place.lat, place.lng);
      stops.push({ lat: place.lat, lng: place.lng });
      stopNames.push(place.name);
      bounds.extend(pos);
      const order = idx + 1;
      const { svg: numberSvg, width: pinW, height: pinH } = buildWebCoursePinSvg(order, total);
      const markerImg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(numberSvg)}`;
      const marker = new window.kakao.maps.Marker({
        map: expandedMapRef.current,
        position: pos,
        image: new window.kakao.maps.MarkerImage(markerImg, new window.kakao.maps.Size(pinW, pinH)),
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

      let screenX = mapWidth / 2;
      let screenY = 0;
      try {
        const proj = expandedMapRef.current.getProjection?.();
        const pt = proj?.containerPointFromCoords?.(pos);
        if (pt) {
          screenX = pt.x;
          screenY = pt.y;
        }
      } catch {
        /* ignore */
      }
      const side: "left" | "right" = screenX > mapWidth * 0.62 ? "left" : "right";
      let yNudge = 0;
      const approxW = Math.min(140, truncateCourseLabelName(place.name).length * 8 + 20);
      for (const prev of labelPlans) {
        if (prev.side !== side) continue;
        const dx = Math.abs(screenX - prev.screenX);
        const dy = Math.abs(screenY + yNudge - (prev.screenY + prev.yNudge));
        if (dx < approxW * 0.85 && dy < 22) {
          yNudge = prev.yNudge + (screenY >= prev.screenY ? 20 : -20);
        }
      }
      labelPlans.push({ place, pos, idx, side, yNudge, screenX, screenY });
    });

    labelPlans.forEach(({ place, pos, side, yNudge }) => {
      const label = truncateCourseLabelName(place.name);
      const el = document.createElement("div");
      el.textContent = label;
      el.style.cssText = [
        "background:#fff",
        "color:#1a1a2e",
        "font-size:13px",
        "font-weight:600",
        "line-height:1.2",
        "padding:4px 8px",
        "border-radius:6px",
        "box-shadow:0 1px 3px rgba(0,0,0,0.14)",
        "white-space:nowrap",
        "max-width:140px",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "pointer-events:none",
        "user-select:none",
        `transform:translateY(${yNudge}px)`,
        side === "right" ? "margin-left:8px" : "margin-right:8px",
      ].join(";");
      const overlay = new window.kakao.maps.CustomOverlay({
        map: expandedMapRef.current,
        position: pos,
        content: el,
        xAnchor: side === "right" ? 0 : 1,
        yAnchor: 0.55,
        zIndex: 4,
      });
      courseLabelOverlaysRef.current.push(overlay);
    });

    expandedMapRef.current.setBounds(bounds);

    if (stops.length < 2) return;

    setDirectionsLoading(true);
    try {
      applyWebCourseRoutePath(stops, false);

      const navigation = await buildCourseWalkNavigationFromTmap(stops, stopNames);
      if (!expandedMapRef.current || !courseResult) return;

      fullscreenCourseNavigationRef.current = navigation;
      setCourseNavigation(navigation);
      setCourseNavSegmentIndex(navigation.segments.length > 0 ? 0 : null);
      setCourseNavFocusMode(false);
      setCourseNavStepIndex(navigation.segments[0]?.steps.length ? 0 : null);
      applyWebCourseRoutePath(navigation.mergedPath);
    } catch (err) {
      console.error("[course] web route failed", err);
      applyWebCourseRoutePath(stops);
    } finally {
      setDirectionsLoading(false);
    }
  };

  const handleAddFromInstagram = async (urlOverride?: string) => {
    const sourceUrl = (urlOverride ?? instagramUrl).trim();
    if (!sourceUrl || isSubmitting) return;
    if (!user?.id) {
      showToast("로그인이 필요합니다.", "error");
      return;
    }
    if (handleAddSubmittingRef.current) return;
    handleAddSubmittingRef.current = true;
    track("reels_submit");
    try {
    const trimmedUrl = cleanInstagramUrl(sourceUrl);
    const perfScreen = "extract:start";
    const extractStartT0 = perfNow();
    dlog.perf.start(perfScreen);
    const controller = new AbortController();
    devLog("[PindMap:url] extraction start", { url: trimmedUrl });
    setIsSubmitting(true); setStatus(""); setError("");
    // fetch 전에 완료/에러 UI·1.8초 타이머를 끊어 이전 완료 화면이 남지 않게 함
    setExtractOverlayComplete(false);
    setExtractOverlayError(null);
    setExtractOverlayErrorRaw(null);
    setExtractOverlayCompleteVariant("success");
    setExtractRetryUrl(null);
    orchestratorSuccessKeyRef.current = "";
    window.localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY);
    // 진행 중 job 이 있으면 clear 금지 — 이전 job 완료 핸들러가 다시 complete=true 올리는 레이스 방지
    if (activeJobs.length === 0) {
      completedJobIdsRef.current.clear();
    }
    let timeout: number | undefined;
    try {
      timeout = window.setTimeout(() => controller.abort(), 10000);
      devLog("[PindMap:url] /api/extract/start request", { url: trimmedUrl, userId: user.id });
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
      logPerf("extract.start", perfNow() - extractStartT0);
      devLog("[PindMap:url] /api/extract/start response status:", response.status, "body:", data);
      if (!response.ok || !data.jobId) {
        devLog("[PindMap:url] /api/extract/start failed - status:", response.status, "error:", data?.error ?? "missing_job_id");
      }
      if (!response.ok || !data.jobId) throw new Error(`[status:${response.status}] ${data.error ?? "분석 작업 시작에 실패했습니다."}`);
      const newJob: ActiveExtractJob = {
        jobId: data.jobId,
        instagramUrl: trimmedUrl,
        status: "pending",
        progressStep: "대기 중",
      };
      setActiveJobs((prev) => [newJob, ...prev.filter((job) => job.jobId !== newJob.jobId)]);
      extractPollStartRef.current[data.jobId] = perfNow();
      setShowExtractOverlay(true);
      setExtractOverlayComplete(false);
      setExtractOverlayError(null);
      setExtractOverlayErrorRaw(null);
      setExtractOverlayCompleteVariant("success");
      setExtractRetryUrl(trimmedUrl);
      setInstagramUrl("");
      setReelInputExpanded(false);
      setStatus("분석 작업이 시작됐어요. 다른 작업하셔도 돼요!");
      devLog("[PindMap:url] extraction message shown");
      devLog("[PindMap:url] extraction success", { jobId: data.jobId });
      dlog.perf.markRender(perfScreen);
    } catch (e) {
      dlog.perf.fetchEnd(perfScreen);
      const isTimeout = e instanceof Error && e.name === "AbortError";
      devLog(`[PindMap:url] extraction ${isTimeout ? "timeout" : "failed"}`, { error: e });
      dlog.perf.markRender(perfScreen);
      const rawMessage = e instanceof Error && e.name === "AbortError"
        ? "요청이 지연되고 있어요. 잠시 후 다시 시도해주세요."
        : e instanceof Error
          ? e.message
          : "요청 처리 중 오류가 발생했습니다.";
      const message = isTimeout ? rawMessage : mapExtractErrorToUserMessage(rawMessage);
      setStatus("");
      devLog(`[PindMap:url] extraction message hidden (${isTimeout ? "timeout" : "failed"})`);
      setError(message);
      setExtractOverlayError(message);
      setExtractOverlayErrorRaw(rawMessage);
      setExtractRetryUrl(trimmedUrl);
      setShowExtractOverlay(true);
      setExtractOverlayComplete(false);
    }
    finally {
      if (typeof timeout === "number") window.clearTimeout(timeout);
      setIsSubmitting(false);
      devLog("[PindMap:url] state reset (finally)", { isSubmitting: false });
    }
    } finally {
      handleAddSubmittingRef.current = false;
    }
  };

  const handleClipboardBannerAccept = () => {
    const url = acceptClipboardSuggest();
    if (url) void handleAddFromInstagram(url);
  };

  const uploadPostImageToServer = async (file: File, accessToken: string): Promise<string> => {
    devLog("[handleImageUpload] 원본", {
      name: file.name,
      type: file.type,
      size: file.size,
    });
    const prepared = await prepareImageForUpload(file);
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}-${Math.random().toString(36).substring(2, 11)}.jpg`;
    devLog("[handleImageUpload] 압축 완료, 업로드 시작", { fileName, size: prepared.size });

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
    devLog("[handleImageUpload] Storage upload 응답", { ok: res.ok, status: res.status, hasError: uploadFailed });

    if (!res.ok) {
      console.error("[handleImageUpload] API 업로드 실패", data);
      throw new Error(data.error || `사진 업로드 실패 (${res.status})`);
    }

    devLog("[handleImageUpload] publicUrl 생성", publicUrlRaw);
    if (!publicUrlRaw || typeof publicUrlRaw !== "string") {
      console.error("[handleImageUpload] publicUrl 누락", data);
      throw new Error("사진 업로드 응답이 올바르지 않아요. 다시 시도해주세요.");
    }

    const publicUrl = publicUrlRaw;
    devLog("[handleImageUpload] 완료", publicUrl);
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
          devLog("[handleImageUpload] state 추가 완료, 총 이미지:", next.length);
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
            devLog("[handleImageUpload] state 추가 완료, 총 이미지:", next.length);
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
    if (postSubmittingRef.current) return;
    if (!canPost) return;
    if (!isCompanionTag(postCompanionTag)) {
      alert("동행 태그를 선택해주세요.");
      return;
    }
    postSubmittingRef.current = true;
    setIsPostSubmitting(true);
    try {
      const repTag = getRepresentativePhotoPlaceTag(postPhotoPlaceTags);
      const hasPhotoTags = postPhotoPlaceTags.length > 0;
      const normalizedPlaceName = (repTag?.placeName ?? (hasPhotoTags ? postPlaceName : "")).trim();
      const normalizedAddress = (repTag?.address ?? (hasPhotoTags ? postAddress : "")).trim();
      if (normalizedPlaceName) {
        const { data: existing } = await supabase
          .from("feed_posts")
          .select("id")
          .eq("user_id", user?.id || "")
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
      const postAspectRatio =
        imageUrls.length > 0
          ? await resolveCurationAspectRatioFromSrc(imageUrls[0])
          : DEFAULT_CURATION_ASPECT_RATIO;
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
            showToast(toUserMessage(courseError, "코스를 저장하지 못했어요"), "error");
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
        aspectRatio: postAspectRatio,
        createdAt: new Date().toISOString(),
        likes_count: 0,
        liked_by_me: false,
        comments: [],
        commentsCount: 0,
      };
      const { error: postError, alreadyExists } = await submitPost(newPost);
      if (alreadyExists) {
        showToast("이미 이 장소에 큐레이션을 작성하셨어요", "info");
        void loadMyMypagePosts();
        setShowPostModal(false);
        setActiveTab("home");
        return;
      }
      if (postError) {
        console.error("[PindMap:curation] submitPost failed", postError);
        showToast("큐레이션 등록에 실패했어요", "error");
        return;
      }

      track("curation_publish");
      showToast(
        linkedCourseId ? "큐레이션과 코스가 등록됐어요 ✨" : "큐레이션이 등록됐어요 ✨",
        "success",
      );
      void loadMyMypagePosts();
      setShowPostModal(false);
      setActiveTab("home");
    } finally {
      postSubmittingRef.current = false;
      setIsPostSubmitting(false);
    }
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
          devLog("[PindMap:location] map identity changed, retry on new map", { scope });
          return;
        }
        applyMyLocationOnMap(map, scope, latitude, longitude, true);
        stage1Ok = true;
        devLog("[PindMap:location] stage1 (fast) coords", latitude, longitude, { scope });
      } catch (err) {
        devLog("[PindMap:location] stage1 failed", { scope, err });
        if (isGeolocationPermissionDenied(err)) {
          showToast("위치 권한이 필요해요. 설정에서 위치를 허용해 주세요.", "info");
          return;
        }
      }

      try {
        const { latitude, longitude } = await getCurrentPositionForMapStage2();
        const currentMap = scope === "main" ? mapRef.current : expandedMapRef.current;
        if (currentMap !== map || token !== locationRenderTokenRef.current[scope]) {
          devLog("[PindMap:location] map identity changed before stage2", { scope });
          return;
        }
        applyMyLocationOnMap(map, scope, latitude, longitude, false);
        devLog("[PindMap:location] stage2 (refined) coords", latitude, longitude, { scope });
      } catch (err) {
        devLog("[PindMap:location] stage2 failed", { scope, err });
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

  const detachCompactMapResizeObserver = () => {
    compactMapResizeObserverRef.current?.disconnect();
    compactMapResizeObserverRef.current = null;
  };

  const clearCompactMapRelayoutTimers = () => {
    compactMapRelayoutTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    compactMapRelayoutTimersRef.current = [];
  };

  const attachCompactMapResizeObserver = () => {
    if (typeof ResizeObserver === "undefined") return;
    const container = mapContainerRef.current;
    if (!container) return;

    detachCompactMapResizeObserver();

    const sizeState = new Map<Element, { w: number; h: number }>();
    const seedSize = (el: Element) => {
      if (el === container) {
        const rect = container.getBoundingClientRect();
        sizeState.set(el, { w: rect.width, h: rect.height });
        return;
      }
      const htmlEl = el as HTMLElement;
      sizeState.set(el, { w: htmlEl.clientWidth, h: htmlEl.clientHeight });
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const prev = sizeState.get(entry.target) ?? { w: 0, h: 0 };
        const wasZero = prev.w <= 0 || prev.h <= 0;
        sizeState.set(entry.target, { w: width, h: height });
        if (wasZero && width > 0 && height > 0 && mapRef.current) {
          scheduleCompactMapRelayout();
        }
      }
    });

    seedSize(container);
    observer.observe(container);
    const parent = container.parentElement;
    if (parent) {
      seedSize(parent);
      observer.observe(parent);
    }
    compactMapResizeObserverRef.current = observer;
  };

  const scheduleCompactMapRectPoll = () => {
    let ticks = 0;
    const maxTicks = 10;
    let lastWasZero = true;
    let relayoutDone = false;

    const poll = () => {
      if (relayoutDone || activeTabRef.current !== "map" || !mapRef.current) return;
      ticks += 1;
      const container = mapContainerRef.current;
      if (!container) {
        lastWasZero = true;
        if (ticks < maxTicks) window.setTimeout(poll, 200);
        return;
      }
      const rect = container.getBoundingClientRect();
      const parent = container.parentElement;
      const hasSize =
        rect.width > 0 &&
        rect.height > 0 &&
        (!parent || (parent.clientWidth > 0 && parent.clientHeight > 0));
      if (lastWasZero && hasSize) {
        relayoutDone = true;
        scheduleCompactMapRelayout();
        return;
      }
      lastWasZero = !hasSize;
      if (ticks < maxTicks && !relayoutDone) window.setTimeout(poll, 200);
    };

    window.setTimeout(poll, 0);
  };

  const relayoutCompactMap = () => {
    const map = mapRef.current;
    if (!map || !isKakaoMapsApiReady()) return;
    map.relayout?.();
    try {
      const center = map.getCenter?.();
      const level = map.getLevel?.();
      if (center) map.setCenter(center);
      if (typeof level === "number") map.setLevel(level);
    } catch {
      /* noop */
    }
  };

  const scheduleCompactMapRelayout = () => {
    clearCompactMapRelayoutTimers();
    requestAnimationFrame(() => relayoutCompactMap());
    [0, 100, 300, 600, 1000, 1500, 2000].forEach((delay) => {
      const timerId = window.setTimeout(() => relayoutCompactMap(), delay);
      compactMapRelayoutTimersRef.current.push(timerId);
    });
  };

  // 카카오맵 실제 초기화 함수 (DOM이 준비된 후 호출)
  const initMap = (places: Place[], posts: FeedPost[]) => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }
    const mapTypeId = window.kakao.maps.MapTypeId?.NORMAL;
    const cachedView = mapViewBootstrapRef.current;
    const centerLat = cachedView && Number.isFinite(cachedView.lat) ? cachedView.lat : 37.5665;
    const centerLng = cachedView && Number.isFinite(cachedView.lng) ? cachedView.lng : 126.978;
    const level =
      cachedView && Number.isFinite(cachedView.level) ? cachedView.level : 9;
    mapRef.current = new window.kakao.maps.Map(mapContainerRef.current, {
      center: new window.kakao.maps.LatLng(centerLat, centerLng),
      level,
    });
    mapInstanceIdRef.current += 1;
    mapRef.current.setMapTypeId && mapRef.current.setMapTypeId(mapTypeId);
    geocoderRef.current = new window.kakao.maps.services.Geocoder();
    window.kakao.maps.event.addListener(mapRef.current, "idle", () => {
      const map = mapRef.current;
      if (!map?.getCenter || !map?.getLevel) return;
      try {
        const c = map.getCenter();
        const view: CachedMapView = {
          lat: c.getLat(),
          lng: c.getLng(),
          level: map.getLevel(),
        };
        if (!Number.isFinite(view.lat) || !Number.isFinite(view.lng)) return;
        mapViewBootstrapRef.current = view;
        if (mapViewSaveTimerRef.current !== null) {
          window.clearTimeout(mapViewSaveTimerRef.current);
        }
        mapViewSaveTimerRef.current = window.setTimeout(() => {
          mapViewSaveTimerRef.current = null;
          void writeCachedMapView(view);
        }, 400);
      } catch {
        /* ignore */
      }
    });
    addMyLocation(mapRef.current, "main");
    setCompactMapReady(true);
    try {
      mark("map_first_paint");
    } catch {
      /* ignore */
    }
    attachCompactMapResizeObserver();
    scheduleCompactMapRelayout();
    scheduleCompactMapRectPoll();
  };

  const addPlacePins = (map: any, arr: any[], posts: FeedPost[], places: Place[], scope: "main" | "expanded" = "main") => {
    if (!geocoderRef.current) return;
    const useNative = isNativeMapAvailable() && expandedNativeMapEnabled && scope === "expanded";
    const myRunId = ++placePinsRunIdRef.current[scope];

    const runSavedPlaceMarkerClick = (place: Place, markerLat: number, markerLng: number) => {
      const clickToken = Date.now();
      selectedPlaceTokenRef.current = clickToken;
      const relatedPosts = getRelatedPostsForPlaceSheet(
        feedPostsRef.current,
        placeRefFromPlace(place, markerLat, markerLng),
      );
      setSelectedPlace(toSelectedFromSavedPlace(place, relatedPosts, markerLat, markerLng));
      new window.kakao.maps.services.Places().keywordSearch(place.name, (data: any[], st: string) => {
        if (selectedPlaceTokenRef.current !== clickToken) return;
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
        if (!nearest || nearest.meters > 100) return;
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
        setSelectedPlace(mergedSafely as typeof baseSelected & { _feedPosts: typeof relatedPosts; _savedPlaceId: string });
      });
    };

    // —— 전체화면/네이티브: 기존 전량 재생성 유지 (mapRef 미니맵 diff와 분리) ——
    if (useNative || scope === "expanded") {
      arr.forEach((m) => m.setMap(null));
      arr.length = 0;
      if (useNative) {
        clearNativeMarkerClickHandlers("place-");
        placePinByIdRef.current.clear();
      }
      const nativePlacePins: { id: string; lat: number; lng: number; category?: string }[] = [];
      if (places.length === 0) return;
      let completed = 0;
      const done = () => {
        completed += 1;
        if (completed === places.length) {
          if (myRunId === placePinsRunIdRef.current[scope] && useNative) {
            void (async () => {
              if (myRunId !== placePinsRunIdRef.current[scope]) return;
              await clearNativeMarkers("place-");
              if (myRunId !== placePinsRunIdRef.current[scope]) return;
              await addNativeMarkers(nativePlacePins);
            })();
          }
        }
      };
      const attachExpandedOrNative = (
        place: Place,
        markerLat: number,
        markerLng: number,
      ) => {
        if (myRunId !== placePinsRunIdRef.current[scope]) return;
        const liveMap = expandedMapRef.current;
        if (useNative) {
          const markerId = `place-${place.id}`;
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
        if (!liveMap) {
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
          savedPlaceCoordsRef.current[place.id] = { lat: markerLat, lng: markerLng };
          window.kakao.maps.event.addListener(marker, "click", () => {
            runSavedPlaceMarkerClick(place, markerLat, markerLng);
          });
          arr.push(marker);
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
        const stored = latLngFromRow(place);
        if (stored) {
          attachExpandedOrNative(place, stored.lat, stored.lng);
          return;
        }
        const cachedId = savedPlaceCoordsRef.current[place.id];
        if (cachedId && Number.isFinite(cachedId.lat) && Number.isFinite(cachedId.lng)) {
          attachExpandedOrNative(place, cachedId.lat, cachedId.lng);
          return;
        }
        const cachedAddr = getGeocodeCacheSync(place.address);
        if (cachedAddr) {
          savedPlaceCoordsRef.current[place.id] = cachedAddr;
          attachExpandedOrNative(place, cachedAddr.lat, cachedAddr.lng);
          return;
        }
        geocoderRef.current.addressSearch(place.address, (result: any[], sv: string) => {
          try {
            if (myRunId !== placePinsRunIdRef.current[scope]) return;
            if (sv !== window.kakao.maps.services.Status.OK || !result[0]) {
              done();
              return;
            }
            const markerLat = parseFloat(result[0].y);
            const markerLng = parseFloat(result[0].x);
            if (Number.isFinite(markerLat) && Number.isFinite(markerLng)) {
              void setGeocodeCache(place.address, { lat: markerLat, lng: markerLng });
            }
            attachExpandedOrNative(place, markerLat, markerLng);
          } catch (err) {
            console.error("[PindMap:pin] addPlacePins marker setup failed", place?.name, err);
            done();
          }
        });
      });
      return;
    }

    // —— 미니맵(mapRef): id 기준 Map diff ——
    // hiddenIds는 목록(miniList) 전용. 지도 핀은 savedPlaces 전체를 유지.
    const byId = mainPlaceMarkersByIdRef.current;
    const liveMap = mapRef.current ?? map;
    const desiredPlaces = places;
    const desiredIds = new Set(desiredPlaces.map((p) => p.id));

    for (const [id, entry] of [...byId.entries()]) {
      if (desiredIds.has(id)) continue;
      try {
        entry.marker.setMap(null);
      } catch {
        /* noop */
      }
      byId.delete(id);
    }

    const syncMainMarkersArr = () => {
      arr.length = 0;
      byId.forEach((entry) => {
        arr.push(entry.marker);
      });
    };

    const upsertMainMarker = (place: Place, markerLat: number, markerLng: number) => {
      if (myRunId !== placePinsRunIdRef.current.main) return;
      if (!liveMap) return;
      const existing = byId.get(place.id);
      const sameCoords =
        existing &&
        Math.abs(existing.lat - markerLat) < 1e-7 &&
        Math.abs(existing.lng - markerLng) < 1e-7;
      const sameCategory = existing && existing.category === place.category;
      if (existing && sameCoords && sameCategory) {
        return;
      }
      if (existing) {
        try {
          existing.marker.setMap(null);
        } catch {
          /* noop */
        }
        byId.delete(place.id);
      }
      let marker: any;
      try {
        marker = new window.kakao.maps.Marker({
          position: new window.kakao.maps.LatLng(markerLat, markerLng),
          image: new window.kakao.maps.MarkerImage(makeMarkerImage(place.category), new window.kakao.maps.Size(36, 44)),
        });
        marker.setMap(liveMap);
        savedPlaceCoordsRef.current[place.id] = { lat: markerLat, lng: markerLng };
        const placeId = place.id;
        window.kakao.maps.event.addListener(marker, "click", () => {
          const latest = savedPlacesRef.current.find((p) => p.id === placeId);
          if (!latest) return;
          const coords = mainPlaceMarkersByIdRef.current.get(placeId);
          const lat = coords?.lat ?? markerLat;
          const lng = coords?.lng ?? markerLng;
          runSavedPlaceMarkerClick(latest, lat, lng);
        });
        byId.set(place.id, {
          marker,
          category: place.category,
          lat: markerLat,
          lng: markerLng,
          address: place.address,
        });
      } catch (err) {
        console.error("[PindMap:pin] addPlacePins marker setup failed", place?.name, err);
        if (marker) {
          try {
            marker.setMap(null);
          } catch {
            /* noop */
          }
        }
      }
    };

    const resolveCoords = (place: Place): LatLng | null => {
      const stored = latLngFromRow(place);
      if (stored) return stored;
      const byPlaceId = savedPlaceCoordsRef.current[place.id];
      if (
        byPlaceId &&
        Number.isFinite(byPlaceId.lat) &&
        Number.isFinite(byPlaceId.lng)
      ) {
        return byPlaceId;
      }
      return getGeocodeCacheSync(place.address);
    };

    desiredPlaces.forEach((place) => {
      const coords = resolveCoords(place);
      if (coords) {
        savedPlaceCoordsRef.current[place.id] = coords;
        upsertMainMarker(place, coords.lat, coords.lng);
        return;
      }
      geocoderRef.current.addressSearch(place.address, (result: any[], sv: string) => {
        try {
          if (myRunId !== placePinsRunIdRef.current.main) return;
          if (sv !== window.kakao.maps.services.Status.OK || !result[0]) return;
          const markerLat = parseFloat(result[0].y);
          const markerLng = parseFloat(result[0].x);
          if (!Number.isFinite(markerLat) || !Number.isFinite(markerLng)) return;
          savedPlaceCoordsRef.current[place.id] = { lat: markerLat, lng: markerLng };
          void setGeocodeCache(place.address, { lat: markerLat, lng: markerLng });
          upsertMainMarker(place, markerLat, markerLng);
          syncMainMarkersArr();
        } catch (err) {
          console.error("[PindMap:pin] addPlacePins marker setup failed", place?.name, err);
        }
      });
    });

    syncMainMarkersArr();
  };

  /** M-1 최후 안전망: 메인 지도에 보일 장소가 있는데 마커가 없을 때 한 번 더 addPlacePins */
  const runMainPinFallbackOnce = (source: string) => {
    if (activeTabRef.current !== "map") return;
    const mapNow = mapRef.current;
    if (!mapNow || !geocoderRef.current) return;
    const places = savedPlacesRef.current;
    if (places.length === 0) return;
    if (markersRef.current.length > 0 || mainPlaceMarkersByIdRef.current.size > 0) return;
    mapNow.relayout?.();
    addPlacePins(mapNow, markersRef.current, feedPostsRef.current, places, "main");

    clearMainPinFallbackVerify();
    let ticks = 0;
    mainPinFallbackVerifyIntervalRef.current = window.setInterval(() => {
      ticks += 1;
      if (markersRef.current.length > 0 || mainPlaceMarkersByIdRef.current.size > 0) {
        clearMainPinFallbackVerify();
        return;
      }
      if (ticks >= 40) {
        clearMainPinFallbackVerify();
      }
    }, 150);
  };

  const scheduleMainPinOrchestratorFallback = (reason: string, cycleId: number) => {
    clearMainPinFallbackTimer();
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
    courseLabelOverlaysRef.current.forEach((o) => {
      try {
        o.setMap(null);
      } catch {
        /* noop */
      }
    });
    courseLabelOverlaysRef.current = [];
    setDirectionsInfo(null);
  };

  const applyWebCourseRoutePath = useCallback((path: LatLng[], fitBounds = true) => {
    if (!expandedMapRef.current || !window.kakao?.maps || path.length < 2) return;
    // 관리자 실험: 카카오 Polyline 대신 HTML 오버레이 경로 갱신
    if (courseMapDesignActiveRef.current) {
      if (routePolylineRef.current) {
        routePolylineRef.current.setMap(null);
        routePolylineRef.current = null;
      }
      setCourseDesignPath(path);
      if (fitBounds) {
        const bounds = latLngBoundsFromPath(path);
        if (bounds) {
          const bottomPad = Math.max(96, courseNavBottomPadRef.current);
          // setBounds(bounds, paddingTop, paddingRight, paddingBottom, paddingLeft)
          expandedMapRef.current.setBounds(bounds, 48, 40, bottomPad, 40);
        }
      }
      return;
    }
    if (routePolylineRef.current) routePolylineRef.current.setMap(null);
    const kakaoPath = path.map(
      (point) => new window.kakao.maps.LatLng(point.lat, point.lng),
    );
    routePolylineRef.current = new window.kakao.maps.Polyline({
      path: kakaoPath,
      strokeWeight: 3,
      strokeColor: "#1a2a7a",
      strokeOpacity: 0.7,
      strokeStyle: "shortdash",
    });
    routePolylineRef.current.setMap(expandedMapRef.current);
    if (fitBounds) {
      const bounds = latLngBoundsFromPath(path);
      if (bounds) expandedMapRef.current.setBounds(bounds);
    }
  }, []);

  const handleCourseNavPanelMetrics = useCallback(
    (metrics: { heightPx: number; collapsed: boolean }) => {
      const nextPad = Math.max(96, Math.round(metrics.heightPx + 16));
      const prevPad = courseNavBottomPadRef.current;
      courseNavBottomPadRef.current = nextPad;
      // 접기/펼치기로 높이가 크게 바뀌면 현재 경로를 다시 맞춤
      if (Math.abs(nextPad - prevPad) < 28) return;
      const path = courseDesignPathRef.current;
      if (!path || path.length < 2) return;
      if (!courseMapDesignActiveRef.current) return;
      applyWebCourseRoutePath(path, true);
    },
    [applyWebCourseRoutePath],
  );

  const handleCourseNavSelectSegment = useCallback((index: number) => {
    const nav = courseNavigation ?? fullscreenCourseNavigationRef.current;
    const segment = nav?.segments[index];
    if (!segment) return;
    setCourseNavSegmentIndex(index);
    setCourseNavFullRouteView(false);
    setCourseNavStepIndex(segment.steps.length > 0 ? 0 : null);
    applyWebCourseRoutePath(segment.path);
  }, [applyWebCourseRoutePath, courseNavigation]);

  const handleCourseNavSelectStep = useCallback((stepIndex: number) => {
    const nav = courseNavigation ?? fullscreenCourseNavigationRef.current;
    if (!nav || courseNavSegmentIndex == null) return;
    const segment = nav.segments[courseNavSegmentIndex];
    const step = segment?.steps[stepIndex];
    if (!step) return;
    setCourseNavStepIndex(stepIndex);
    if (Number.isFinite(step.lat) && Number.isFinite(step.lng)) {
      applyExpandedMapCameraLatLng(step.lat, step.lng, 3);
    }
  }, [applyExpandedMapCameraLatLng, courseNavSegmentIndex, courseNavigation]);

  const handleCourseNavPrevSegment = useCallback(() => {
    if (courseNavSegmentIndex == null || courseNavSegmentIndex <= 0) return;
    setCourseNavFocusMode(true);
    handleCourseNavSelectSegment(courseNavSegmentIndex - 1);
  }, [courseNavSegmentIndex, handleCourseNavSelectSegment]);

  const handleCourseNavNextSegment = useCallback(() => {
    const nav = courseNavigation;
    if (!nav || courseNavSegmentIndex == null) return;
    if (courseNavSegmentIndex >= nav.segments.length - 1) return;
    setCourseNavFocusMode(true);
    handleCourseNavSelectSegment(courseNavSegmentIndex + 1);
  }, [courseNavigation, courseNavSegmentIndex, handleCourseNavSelectSegment]);

  const handleCourseNavToggleFocusMode = useCallback(() => {
    const nav = courseNavigation;
    if (!nav || courseNavSegmentIndex == null) return;
    setCourseNavFocusMode(true);
    setCourseNavFullRouteView(false);
    const segment = nav.segments[courseNavSegmentIndex];
    if (segment) applyWebCourseRoutePath(segment.path);
  }, [applyWebCourseRoutePath, courseNavigation, courseNavSegmentIndex]);

  const handleCourseNavShowFullRoute = useCallback(() => {
    const nav = courseNavigation;
    if (!nav) return;
    setCourseNavFocusMode(false);
    setCourseNavFullRouteView(true);
    setCourseNavStepIndex(null);
    applyWebCourseRoutePath(nav.mergedPath);
  }, [applyWebCourseRoutePath, courseNavigation]);

  const drawRoute = async (destLat: number, destLng: number, mode: "car" | "walk" = "car") => {
    if (!expandedMapRef.current || !window.kakao?.maps) return;
    track("course_directions");
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
      devLog("[PindMap:expandedMap] dedupe skip same place", source, key);
      return;
    }
    expandedSearchOpenDedupeRef.current = { t: now, key };
    devLog("[PindMap:expandedMap] open place card", source, place.place_name, { y: place.y, x: place.x });
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
      devLog("[PindMap:search] search invoked", { query: trimmed });
      if (!trimmed) {
        devLog("[PindMap:search] search blocked - reason: empty_query");
        return;
      }
      if (!expandedMapRef.current) {
        devLog("[PindMap:search] search blocked - reason: expanded_map_not_ready");
        return;
      }
      if (!window.kakao?.maps) {
        devLog("[PindMap:search] search blocked - reason: kakao_not_ready");
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
        devLog("[PindMap:expandedMap] keywordSearch ok count=", data?.length ?? 0);
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
          devLog("[PindMap:expandedMap] addressSearch marker", placeObj.place_name);
          addSearchResultPins([placeObj], (place) => openExpandedSearchPlaceCard(place, "marker-address-click"));
          setMapSearchResults([placeObj]);
          setMapSearchLabel(trimmed);
          setIsMapSearchSheetOpen(true);
          expandedMapRef.current.setCenter(new window.kakao.maps.LatLng(addr.y, addr.x));
          expandedMapRef.current.setLevel(3);
          pendingSearchCenterSyncRef.current = true;
          setSearchQuery("");
        } else {
          devLog("[PindMap:expandedMap] addressSearch fallback to keyword:", trimmed);
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
    track("map_search");
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
      devLog("[PindMap:kakao] maps.load ready", {
        hasLatLng: isKakaoMapsApiReady(),
        origin: typeof window !== "undefined" ? window.location.origin : "ssr",
      });
      try {
        mark("map_sdk_ready");
      } catch {
        /* ignore */
      }
      setIsKakaoMapLoaded(true);
      setKakaoStatus("ready");
    };
    try {
      mark("map_sdk_start");
    } catch {
      /* ignore */
    }
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
    devLog("[PindMap:kakao] injecting sdk.js", {
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
      devLog("[PindMap:kakao] script onload", {
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
    if (!mapRef.current) {
      return;
    }
    detachCompactMapResizeObserver();
    clearCompactMapRelayoutTimers();
    mapRef.current = null;
    mapInstanceIdRef.current += 1;
    myLocationMarkerRef.current.main = null;
    mainPlaceMarkersByIdRef.current.forEach((entry) => {
      try {
        entry.marker.setMap(null);
      } catch {
        /* noop */
      }
    });
    mainPlaceMarkersByIdRef.current.clear();
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
    if (mapRef.current) {
      return;
    }

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
      attachCompactMapResizeObserver();
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

  // 탭 전환·미니맵 생성 시 지도 relayout
  useEffect(() => {
    if (activeTab !== "map" || !mapRef.current || kakaoStatus !== "ready") return;
    scheduleCompactMapRelayout();
  }, [activeTab, kakaoStatus, compactMapReady]);

  useEffect(() => {
    if (activeTab !== "map") return;
    if (!compactMapReady || !mapRef.current) return;
    if (relayoutTriggeredRef.current) return;
    relayoutTriggeredRef.current = true;
    devLog("[PindMap:pin] relayout trigger (initial)");

    const runRelayoutAndRepaint = () => {
      relayoutCompactMap();
      devLog("[PindMap:pin] relayout completed");
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
      detailReturnUseBackRef.current = false;
      setActiveTab("mypage");
    } else if (searchParams.get("from") === "profile") {
      // 프로필에서 push 로 진입 → close 시 router.back()
      detailReturnUseBackRef.current = true;
      setActiveTab("home");
    }
    if (searchParams.get("tab") === "home") {
      setActiveTab("home");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!detailPostId || feedPosts.some((p) => p.id === detailPostId)) return;
    let cancelled = false;
    void (async () => {
      const fetchT0 = perfNow();
      const { data } = await supabase
        .from("feed_posts")
        .select(FEED_POST_DETAIL_SELECT)
        .eq("id", detailPostId)
        .maybeSingle();
      logPerf("detail.fetch", perfNow() - fetchT0);
      if (cancelled || !data) return;
      const likedByMe = user?.id ? await fetchIsPostLikedByUser(detailPostId, user.id) : false;
      if (cancelled) return;
      const raw = parseFeedPostFromRow(data as any, { likedByMe });
      await prefetchAvatarsForFeedPosts([raw]);
      if (cancelled) return;
      const [hydrated] = hydrateFeedPostsWithAvatars([raw]);
      setFeedPosts((prev) => (prev.some((p) => p.id === hydrated.id) ? prev : [hydrated, ...prev]));
    })();
    return () => {
      cancelled = true;
    };
  }, [detailPostId, feedPosts, prefetchAvatarsForFeedPosts, hydrateFeedPostsWithAvatars, user?.id]);

  /** 상세 열 때 댓글 목록 지연 로드 (리스트는 count만 가져옴) */
  useEffect(() => {
    if (!detailPostId) {
      setDetailCommentsLoading(false);
      return;
    }
    const post = feedPosts.find((p) => p.id === detailPostId);
    if (!post) return;
    if (post.comments.length > 0) return;
    if (post.commentsCount === 0) return;

    let cancelled = false;
    setDetailCommentsLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("comments")
          .select("id, user_name, user_id, text, created_at")
          .eq("post_id", detailPostId)
          .order("created_at", { ascending: true });
        if (cancelled || error) {
          if (error) console.error("[PindMap:feed] comments fetch failed", error);
          return;
        }
        const comments = (data ?? []).map((c) => ({
          id: c.id,
          user: c.user_name,
          userId: c.user_id ?? undefined,
          text: c.text,
          createdAt: c.created_at,
        }));
        setFeedPosts((prev) =>
          prev.map((p) =>
            p.id === detailPostId
              ? { ...p, comments, commentsCount: comments.length }
              : p,
          ),
        );
        void prefetchAvatarsForFeedPosts([
          { ...post, comments, commentsCount: comments.length },
        ]);
      } finally {
        if (!cancelled) setDetailCommentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailPostId, feedPosts, prefetchAvatarsForFeedPosts]);

  // 메시지 탭 진입 시 방 목록 갱신 (TTL 내·이미 로드됐으면 스킵, Realtime은 별도)
  useEffect(() => {
    if (activeTab !== "messages" || activeChatRoom) return;
    if (!MY_USER) return;
    const fetchedAt = chatRoomsListFetchedAtRef.current;
    if (fetchedAt > 0 && Date.now() - fetchedAt < CHAT_ROOMS_LIST_TTL_MS) {
      return;
    }
    void loadChatRoomsList(MY_USER).catch((err) => {
      console.error("[PindMap:chat] messages-tab rooms refresh failed", err);
    });
  }, [activeTab, activeChatRoom, MY_USER]);

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
        track("user_search");
        const { data, error } = await searchUsersByUsername(q, user.id, followingIds);
        if (cancelled) return;
        if (error) showToast(toUserMessage(error, "검색에 실패했어요"), "error");
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
    if (activeTab !== "map") return;
    if (kakaoStatus !== "ready") return;
    const map = mapRef.current;
    if (!map) return;
    if (!compactMapReady) return;

    // 지도 핀은 hiddenIds와 무관 — savedPlaces 전체 스냅샷으로 재핀 여부 판단
    const savedPlacesKey = savedPlaces
      .map((p) => `${p.id}:${p.category}:${p.address}:${p.lat ?? ""}:${p.lng ?? ""}`)
      .sort()
      .join("|");
    const cycleKey = `${mapInstanceIdRef.current}::${savedPlacesKey}`;
    if (orchestratorSuccessKeyRef.current === cycleKey) {
      return;
    }

    initialPinTriggeredRef.current = true;
    prevSavedPlacesKeyRef.current = savedPlacesKey;
    const cycleId = ++orchestratorCycleRef.current;

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

    const visiblePlacesCount = savedPlaces.length;
    const runAttempt = (attempt: 1 | 2 | 3) => {
      if (cancelled) return;
      clearMarkerPoll();
      map.relayout?.();
      pendingRaf = window.requestAnimationFrame(() => {
        if (cancelled) return;
        addPlacePins(map, markersRef.current, feedPosts, savedPlaces, "main");
        const pollStartedAt = Date.now();
        const pollTick = () => {
          if (cancelled) {
            clearMarkerPoll();
            return;
          }
          const markerCount = Math.max(markersRef.current.length, mainPlaceMarkersByIdRef.current.size);
          const success = visiblePlacesCount === 0 || markerCount > 0;
          if (success) {
            clearMarkerPoll();
            orchestratorSuccessKeyRef.current = cycleKey;
            return;
          }
          if (Date.now() - pollStartedAt >= MARKER_POLL_MAX_MS) {
            clearMarkerPoll();
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
  }, [activeTab, kakaoStatus, compactMapReady, savedPlaces, feedPosts]);

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
    const uid = userIdRef.current;
    const adminCourse = showCourseRoute && uid === ADMIN_USER_ID;
    const shouldCreateWebMap = mapExpanded && (!isNativeMapAvailable() || adminCourse);

    if (!shouldCreateWebMap || !mapExpandedRef.current || kakaoStatus !== "ready" || !isKakaoMapsApiReady()) {
      logAdminCourseMap(uid, "map create effect skip", {
        mapExpanded,
        showCourseRoute,
        adminCourse,
        shouldCreateWebMap,
        hasContainer: !!mapExpandedRef.current,
        containerW: mapExpandedRef.current?.clientWidth ?? null,
        containerH: mapExpandedRef.current?.clientHeight ?? null,
        kakaoStatus,
        kakaoReady: isKakaoMapsApiReady(),
      });
      return undefined;
    }

    let cancelled = false;
    const tid = window.setTimeout(() => {
      if (cancelled || !mapExpandedRef.current || !isKakaoMapsApiReady()) {
        logAdminCourseMap(uid, "map create timeout abort", {
          cancelled,
          hasContainer: !!mapExpandedRef.current,
          kakaoReady: isKakaoMapsApiReady(),
        });
        return;
      }
      const mapContainerEl = mapExpandedRef.current;
      logAdminCourseMap(uid, "map create: building Kakao Map", {
        containerW: mapContainerEl.clientWidth,
        containerH: mapContainerEl.clientHeight,
      });
      expandedMapRef.current = new window.kakao.maps.Map(mapContainerEl, {
        center: mapRef.current?.getCenter() ?? new window.kakao.maps.LatLng(37.5665, 126.978),
        level: mapRef.current?.getLevel() ?? 9,
      });
      const map = expandedMapRef.current;
      logAdminCourseMap(uid, "expanded web Map instance ready", {
        showCourseRoute,
        hasMap: !!map,
        pinsTickNext: "will +1",
      });
      devLog("[PindMap:expandedMap] Map instance ready, wiring kakao click + DOM touch fallback");

      addMyLocation(map, "expanded");
      setExpandedMapPinsTick((n) => n + 1);

      const hitFromLatLng = (lat: number, lng: number, source: string): boolean => {
        const candidates = lastExpandedSearchPlacesRef.current;
        if (!candidates.length) {
          devLog("[PindMap:expandedMap] geo tap skipped (no keyword/address pins in memory)", source);
          return false;
        }
        const picked = pickNearestExpandedSearchPlaceByPixel(map, lat, lng, candidates, 56);
        if (!picked) {
          devLog("[PindMap:expandedMap] geo tap no marker within px threshold", source, { lat, lng, nearCount: candidates.length });
          return false;
        }
        openExpandedSearchPlaceCard(picked, source);
        return true;
      };

      const listenerClick = window.kakao.maps.event.addListener(map, "click", (me: any) => {
        const ll = me?.latLng;
        if (!ll) {
          devLog("[PindMap:expandedMap] kakao map click without latLng");
          return;
        }
        const lat = ll.getLat();
        const lng = ll.getLng();
        devLog("[PindMap:expandedMap] kakao maps map.click", lat, lng);
        hitFromLatLng(lat, lng, "kakao-map-click+pixels");
      });

      const fingerStartRef = { x: 0, y: 0 };

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        const tc = e.touches[0];
        fingerStartRef.x = tc.clientX;
        fingerStartRef.y = tc.clientY;
        devLog("[PindMap:expandedMap] DOM touchstart", tc.clientX, tc.clientY);
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (e.changedTouches.length !== 1) return;
        const tc = e.changedTouches[0];
        const dx = tc.clientX - fingerStartRef.x;
        const dy = tc.clientY - fingerStartRef.y;
        if (Math.hypot(dx, dy) > 22) {
          devLog("[PindMap:expandedMap] DOM touchend ignored (drag-like)", dx, dy);
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
        devLog("[PindMap:expandedMap] DOM touchend → container px", px, pyTouch);
        const latlng = proj.coordsFromContainerPoint(new window.kakao.maps.Point(px, pyTouch));
        if (!latlng) {
          devLog("[PindMap:expandedMap] touchend coordsFromContainerPoint returned null");
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
          devLog("[PindMap:expandedMap] saved-pin touch assist skip (card already open)", pickedSaved.id);
          return;
        }
        const now = Date.now();
        const d = expandedSavedTouchAssistDedupeRef.current;
        if (d.id === pickedSaved.id && now - d.t < 280) {
          devLog("[PindMap:expandedMap] saved-pin touch assist deduped", pickedSaved.id);
          return;
        }
        expandedSavedTouchAssistDedupeRef.current = { t: now, id: pickedSaved.id };
        const c = savedPlaceCoordsRef.current[pickedSaved.id];
        if (!c) return;
        const relatedPosts = getRelatedPostsForPlaceSheet(
          feedPosts,
          placeRefFromPlace(pickedSaved, c.lat, c.lng),
        );
        devLog("[PindMap:expandedMap] saved-pin touch assist", pickedSaved.name);
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
          devLog("[PindMap:expandedMap] removeListener error", err);
        }
        mapContainerEl.removeEventListener("touchstart", onTouchStart);
        mapContainerEl.removeEventListener("touchend", onTouchEnd);
        expandedMapInteractionCleanupRef.current = null;
        devLog("[PindMap:expandedMap] teardown map click + touch listeners");
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
  }, [mapExpanded, showCourseRoute, kakaoStatus, openExpandedSearchPlaceCard, feedPosts, savedPlaces, hiddenIds, toSelectedFromSavedPlace]);

  useEffect(() => {
    if (!mapExpanded || !expandedMapRef.current || !geocoderRef.current) return;
    // 관리자 코스 디자인 오버레이: 저장 장소 카테고리 핀 전부 숨김 (코랄 핀만)
    const hideSavedPinsForAdminCourse =
      showCourseRoute && userIdRef.current === ADMIN_USER_ID;
    if (hideSavedPinsForAdminCourse) {
      expandedMarkersRef.current.forEach((m) => {
        try {
          m.setMap(null);
        } catch {
          /* noop */
        }
      });
      expandedMarkersRef.current = [];
      return;
    }
    addPlacePins(expandedMapRef.current, expandedMarkersRef.current, feedPosts, savedPlaces, "expanded");
    // addFeedPins(expandedMapRef.current, feedMarkersRef.current, feedPosts); // 비활성화: 다른 사람 큐레이션 핀 안 보이게
  }, [feedPosts, mapExpanded, savedPlaces, expandedMapPinsTick, showCourseRoute]);

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

  // 홈 피드 무한 스크롤
  useEffect(() => {
    if (activeTab !== "home" || loading || homeLoadError) return;
    const root = homeFeedScrollRef.current;
    const target = feedLoadMoreSentinelRef.current;
    if (!root || !target) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadMoreFeedPosts();
        }
      },
      { root, rootMargin: "240px 0px", threshold: 0 },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [activeTab, filteredHomeFeedPosts.length, feedHasMore, loading, homeLoadError]);

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

  useEffect(() => {
    if (activeTab !== "mypage" || !user?.id) {
      if (!user?.id) {
        setMyMypagePosts([]);
        setMyMypagePostsCount(0);
      }
      return;
    }
    void loadMyMypagePosts();
  }, [activeTab, user?.id, loadMyMypagePosts]);

  // 마이페이지 게시물 무한 스크롤
  useEffect(() => {
    if (activeTab !== "mypage" || !user?.id) return;
    if (myMypagePosts.length >= myMypagePostsCount) return;
    const root = mypageTabScrollRef.current;
    const target = mypagePostsLoadMoreSentinelRef.current;
    if (!root || !target) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (myMypagePostsLoadingRef.current) return;
        if (myMypagePostsRef.current.length >= myMypagePostsCount) return;
        void loadMyMypagePosts({ append: true });
      },
      { root, rootMargin: "240px 0px", threshold: 0 },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [
    activeTab,
    user?.id,
    myMypagePosts.length,
    myMypagePostsCount,
    loadMyMypagePosts,
  ]);

  useEffect(() => {
    if (activeTab !== "mypage" || !user?.id || user.id !== ADMIN_USER_ID) {
      setAdminStatus(null);
      setAdminLastCleanupAt(null);
      setLastBootTiming(null);
      setBootFailReport(null);
      adminAlertAutoOpenedRef.current = false;
      return;
    }
    setAdminCardOpen(readAdminStatusCardOpen());
    let cancelled = false;
    const load = async () => {
      setAdminStatusLoading(true);
      try {
        const [boot, fail, lastCleanup] = await Promise.all([
          loadLastBootTimingReport(),
          loadBootFailReport(),
          readAdminLastCleanupAt(),
        ]);
        if (!cancelled) {
          setLastBootTiming(boot);
          setBootFailReport(fail);
          setAdminLastCleanupAt(lastCleanup);
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch("/api/admin/status", {
          method: "GET",
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        if (!res.ok) {
          console.error("[PindMap:admin] status fetch failed", res.status);
          return;
        }
        const data = (await res.json()) as AdminStatusPayload;
        if (!cancelled) setAdminStatus(data);
      } catch (e) {
        console.error("[PindMap:admin] status fetch error", e);
      } finally {
        if (!cancelled) setAdminStatusLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeTab, user?.id]);

  /** 관리자: 앱 오픈 시 7일 간격 DB cleanup (백그라운드, 실패 무시) */
  useEffect(() => {
    if (!sessionChecked || userLoading || !user?.id || user.id !== ADMIN_USER_ID) return;
    let cancelled = false;
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled || !session?.access_token) return;
        await maybeRunAdminCleanup(session.access_token);
        if (!cancelled) {
          const last = await readAdminLastCleanupAt();
          setAdminLastCleanupAt(last);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionChecked, userLoading, user?.id]);

  /** 이상 신호 시 카드 자동 펼침 (한 번) */
  useEffect(() => {
    if (activeTab !== "mypage" || user?.id !== ADMIN_USER_ID) return;
    if (adminStatusLoading) return;
    const alertNoSuccess = !!adminStatus && adminStatus.today.attempts > 0 && adminStatus.today.success === 0;
    const alertRate = !!adminStatus && adminStatus.last7Days.successRate < 50;
    const lastMs = adminStatus?.lastSuccessAt
      ? Date.now() - new Date(adminStatus.lastSuccessAt).getTime()
      : Number.POSITIVE_INFINITY;
    const alertStale = !!adminStatus && (!adminStatus.lastSuccessAt || lastMs >= 24 * 60 * 60 * 1000);
    const alertStuck = !!adminStatus && adminStatus.stuckJobs >= 1;
    const alertBootFail = !!bootFailReport && bootFailReport.count > 0;
    const hasAlert = alertNoSuccess || alertRate || alertStale || alertStuck || alertBootFail;
    if (!hasAlert || adminAlertAutoOpenedRef.current) return;
    adminAlertAutoOpenedRef.current = true;
    setAdminCardOpen(true);
    writeAdminStatusCardOpen(true);
  }, [activeTab, user?.id, adminStatus, adminStatusLoading, bootFailReport]);

  useEffect(() => {
    if (activeTab !== "mypage" || !user?.id) return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await runMypageTabFetchIfStale();
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, user?.id, runMypageTabFetchIfStale]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (activeTab !== "mypage" || !user?.id) return;
      void runMypageTabFetchIfStale();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [activeTab, user?.id, runMypageTabFetchIfStale]);

  const togglePlaceSheetSave = useCallback(async (placeData: PlaceSheetData, onAfterSave?: () => void): Promise<boolean | undefined> => {
    const uid = userIdRef.current;
    if (!uid) {
      showToast("로그인 후 이용해주세요", "info");
      return undefined;
    }
    const saved = resolveSavedMatch(placeData);
    if (saved) {
      await deletePlace(saved.id);
      showToast("저장이 취소되었어요", "info");
      return false;
    }
    const category = inferCategoryFromKakaoCategoryName(placeData.category_name) as Category;
    const heartCoords = kakaoYXToLatLng(placeData.y, placeData.x);
    const placeToAdd = {
      id: Math.random().toString(36).substring(2) + Date.now().toString(36),
      name: placeData.place_name,
      address: placeData.road_address_name || placeData.address_name || "",
      category,
      ...(heartCoords ? { lat: heartCoords.lat, lng: heartCoords.lng } : {}),
    };
    if (heartCoords) {
      savedPlaceCoordsRef.current[placeToAdd.id] = heartCoords;
    }
    try {
      await addPlace(placeToAdd);
    } catch (err) {
      throw err;
    }
    track("place_save");
    showToast("저장됐어요", "success");
    onAfterSave?.();
    return true;
  }, [resolveSavedMatch, deletePlace, addPlace, showToast]);

  const resolveFullscreenMarkerPlaceSheet = useCallback((markerId: string): PlaceSheetData | null => {
    const id = String(markerId ?? "").trim();
    if (!id) {
      return null;
    }
    if (id.startsWith("place-")) {
      const place = placePinByIdRef.current.get(id);
      if (!place) {
        return null;
      }
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
      if (!place) {
        return null;
      }
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

    const currentlySaved = !!resolveSavedMatch(placeData);
    const willBeSaved = !currentlySaved;
    const previousSaved = currentlySaved;

    if (!userIdRef.current) {
      await togglePlaceSheetSave(placeData);
      return;
    }

    await setFullscreenNativePlaceSaved({ id: markerId, saved: willBeSaved }, { silent: false });

    let result: boolean | undefined;
    try {
      result = await togglePlaceSheetSave(placeData);
    } catch {
      result = undefined;
    }

    const savedAfter = !!resolveSavedMatch(placeData);
    const success = result !== undefined && result === willBeSaved && savedAfter === willBeSaved;
    if (!success) {
      await setFullscreenNativePlaceSaved({ id: markerId, saved: previousSaved }, { silent: false });
      return;
    }

    if (!mapExpandedLiveRef.current) return;

    const savedPlaceMarkers = savedPlacesRef.current.flatMap((place) => {
      const stored = latLngFromRow(place);
      const cached = savedPlaceCoordsRef.current[place.id];
      const coords = stored ?? cached;
      if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return [];
      placePinByIdRef.current.set(`place-${place.id}`, place);
      savedPlaceCoordsRef.current[place.id] = coords;
      const { photos, postCount, photoPostIds } = getMarkerPhotoMetaForPlace(feedPostsRef.current, place, coords);
      return [{
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
      }];
    });

    await updateFullscreenNativeMarkers(
      { markers: savedPlaceMarkers, clearPrefix: "place-" },
      { silent: false },
    );
  }, [resolveFullscreenMarkerPlaceSheet, resolveSavedMatch, togglePlaceSheetSave, showToast]);

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

  const handleFullscreenNativeCuration = useCallback(async (postId: string, markerId?: string) => {
    const id = String(postId ?? "").trim();
    if (!id) return;
    fullscreenReturnStateRef.current = captureFullscreenReturnSnapshot(markerId);
    await dismissFullscreenNativeMap({ silent: false });
    setMapExpanded(false);
    setSelectedPlace(null);
    setSelectedMapPlace(null);

    let placeData: PlaceSheetData | null = null;
    if (markerId) {
      placeData = resolveFullscreenMarkerPlaceSheet(markerId);
    }
    if (!placeData) {
      const post = feedPostsRef.current.find((p) => p.id === id);
      if (post) {
        const ref = placeRefFromFeedPost(post);
        const relatedPosts = getRelatedPostsForPlaceSheet(feedPostsRef.current, ref);
        const matchedSaved = savedPlacesRef.current.find(
          (p) =>
            p.name.trim() === (ref.placeName?.trim() || post.placeName.trim()) &&
            p.address.trim() === (ref.address?.trim() || post.address.trim()),
        );
        placeData = feedPostToPlaceSheet(
          {
            id: post.id,
            placeName: ref.placeName?.trim() || post.placeName,
            address: ref.address?.trim() || post.address,
            category: post.category,
            lat: ref.lat ?? post.lat,
            lng: ref.lng ?? post.lng,
          },
          relatedPosts,
          matchedSaved?.id,
          ref,
        );
      }
    }

    const relatedCount = placeData?._feedPosts?.length ?? 0;
    if (relatedCount <= 1) {
      returnToFullscreenMapAfterDetailRef.current = true;
      placePostsListReturnFullscreenRef.current = false;
      const post =
        feedPostsRef.current.find((p) => p.id === id) ??
        (placeData?._feedPosts?.[0] as FeedPost | undefined);
      const placeRef = placeData?._placeRef;
      setDetailEntryPhotoIndex(
        post && placeRef ? getFirstMatchingPhotoIndex(post, placeRef) : 0,
      );
      setDetailPostId(id);
      return;
    }

    returnToFullscreenMapAfterDetailRef.current = false;
    placePostsListReturnFullscreenRef.current = true;
    if (placeData) {
      openPlaceCurationFromSheet(placeData, id);
    } else {
      returnToFullscreenMapAfterDetailRef.current = true;
      placePostsListReturnFullscreenRef.current = false;
      setDetailEntryPhotoIndex(0);
      setDetailPostId(id);
    }
  }, [captureFullscreenReturnSnapshot, resolveFullscreenMarkerPlaceSheet, openPlaceCurationFromSheet]);

  useEffect(() => {
    if (!isNativeMapAvailable()) return;
    if (fullscreenCurationListenerRegisteredRef.current) return;
    fullscreenCurationListenerRegisteredRef.current = true;
    void PindmapNativeMap.addListener("fullscreenCuration", (e) => {
      void handleFullscreenNativeCuration(e.postId, e.id);
    }).catch((err) => {
      fullscreenCurationListenerRegisteredRef.current = false;
      console.error("[fullscreen] fullscreenCuration listener failed", err);
    });
  }, [handleFullscreenNativeCuration]);

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
        onCurationClick={(postId, photoIndex) => {
          openPlaceCurationFromSheet(placeData, postId, photoIndex);
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
                  if (!ok) await redirectUnauthenticated();
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
              if (!courseShareLoading && !courseInviteImageBusy) closeCourseShareModal();
            }}
          >
            <div className="courseShareModalSheet" onClick={(e) => e.stopPropagation()}>
              <div className="courseShareModalHeader">
                <span className="courseShareModalTitle">코스 공유하기</span>
                <button
                  type="button"
                  className="courseShareModalClose"
                  onClick={closeCourseShareModal}
                  disabled={courseShareLoading || courseInviteImageBusy}
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
              {user?.id && sharingCourse.user_id === user.id && (
                <div className="courseShareModalInviteRow">
                  <img
                    src={resolveCourseInviteImage(sharingCourse)}
                    alt=""
                    className="courseShareModalInvitePreview"
                    width={72}
                    height={108}
                    decoding="async"
                  />
                  <div className="courseShareModalInviteActions">
                    <p className="courseShareModalInviteLabel">초대장 이미지</p>
                    <div className="courseShareModalInviteBtns">
                      <button
                        type="button"
                        className="courseShareModalInviteBtn"
                        disabled={courseShareLoading || courseInviteImageBusy}
                        onClick={openCourseInviteImagePicker}
                      >
                        {courseInviteImageBusy ? "올리는 중…" : "이미지 바꾸기"}
                      </button>
                      <button
                        type="button"
                        className="courseShareModalInviteBtn courseShareModalInviteBtnGhost"
                        disabled={
                          courseShareLoading ||
                          courseInviteImageBusy ||
                          !sharingCourse.invite_image
                        }
                        onClick={() => void handleResetCourseInviteImage()}
                      >
                        기본 이미지로
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <input
                type="search"
                className="courseShareModalSearch"
                placeholder="친구 검색"
                value={courseShareSearchQuery}
                onChange={(e) => setCourseShareSearchQuery(e.target.value)}
                disabled={courseShareLoading || courseInviteImageBusy}
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
                                      data-coach="course_share"
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

  const curationDetailOverlayEl = detailPostId ? (
    <div className="curationDetailOverlay">
      <main className="mobileRoot">
        <section className="phoneFrame">
          {!detailPost ? (
            <>
              <header className="subpageHeader" style={{ height: "56px", display: "flex", alignItems: "center", padding: "0 20px", borderBottom: "0.5px solid #efefef", background: "#fff", gap: "12px", flexShrink: 0 }}>
                <button onClick={closeDetailPost} type="button" style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#1a2a7a" }}>큐레이션</span>
              </header>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
                <p style={{ margin: 0, fontSize: 13, color: "#888" }}>불러오는 중...</p>
              </div>
            </>
          ) : (() => {
    const liked = detailPost.liked_by_me;
    const detailRepPlace = getRepresentativePlaceForPost(detailPost);
    const detailShowPlaceCard = !!detailRepPlace.placeName.trim();
    const detailCommentComposerHeight = 56;
    return (
      <>
          <header className="subpageHeader" style={{ height: "56px", display: "flex", alignItems: "center", padding: "0 20px", borderBottom: "0.5px solid #efefef", background: "#fff", gap: "12px", flexShrink: 0 }}>
            <button onClick={closeDetailPost} type="button" style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#1a2a7a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detailPost.title || detailRepPlace.placeName}</span>
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
            <div style={{ padding: "16px 20px 0" }}><p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "22px", color: "#1a2a7a", lineHeight: 1.3 }}>{detailPost.title || detailRepPlace.placeName}</p></div>
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
                {!isOwnFeedAuthor(detailPost.userId, detailPost.user, MY_USER, MY_USERNAME) && detailPost.userId && !followingIds.includes(detailPost.userId) && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); followUser(detailPost.user); }}
                    style={{ border: "none", background: "#1a2a7a", color: "#fff", borderRadius: "16px", padding: "4px 12px", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginRight: "4px" }}
                  >+ 팔로우</button>
                )}
                {!isOwnFeedAuthor(detailPost.userId, detailPost.user, MY_USER, MY_USERNAME) && detailPost.userId && followingIds.includes(detailPost.userId) && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); unfollowUser(detailPost.user); }}
                    style={{ border: "1px solid #d0d4e0", background: "#fff", color: "#76809a", borderRadius: "16px", padding: "4px 12px", fontSize: "11px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", marginRight: "4px" }}
                  >팔로잉</button>
                )}
                {isOwnFeedAuthor(detailPost.userId, detailPost.user, MY_USER, MY_USERNAME) && (
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
            {detailShowPlaceCard && (
              <div style={{ margin: "12px 20px 0", padding: "12px 14px", background: "#f8f8fc", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "22px" }}>{CATEGORY_PIN[detailRepPlace.category].emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: "14px", fontFamily: "'Playfair Display', serif", color: "#1a1a2e" }}>{detailRepPlace.placeName}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detailRepPlace.address}</p>
                  </div>
                  <span style={{ fontSize: "10px", color: "#fff", background: CATEGORY_COLORS[detailRepPlace.category], padding: "3px 8px", borderRadius: "10px", flexShrink: 0 }}>{detailRepPlace.category}</span>
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
                  aspectRatio={detailPost.aspectRatio}
                  variant="detail"
                  initialIndex={detailEntryPhotoIndex}
                  mediaAriaLabel="사진"
                  onMediaClick={() => {}}
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
                <span style={{ fontSize: "13px", color: "#aaa" }}>{feedCommentCount(detailPost)}</span>
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
              <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px" }}>댓글 {feedCommentCount(detailPost)}</p>
              {detailCommentsLoading && (
                <p style={{ fontSize: "12px", color: "#ccc", textAlign: "center", padding: "10px 0" }}>댓글 불러오는 중…</p>
              )}
              {!detailCommentsLoading && detailPost.comments.map((c) => (
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
                        {isOwnFeedAuthor(c.userId, c.user, MY_USER, MY_USERNAME) && <button onClick={(e) => { e.stopPropagation(); deleteComment(detailPost.id, c.id); }} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ccc", fontSize: "13px", padding: 0, lineHeight: 1 }}>×</button>}
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: "13px", color: "#444", lineHeight: 1.5 }}>{c.text}</p>
                  </div>
                </div>
              ))}
              {!detailCommentsLoading && detailPost.comments.length === 0 && <p style={{ fontSize: "12px", color: "#ccc", textAlign: "center", padding: "10px 0" }}>첫 댓글을 남겨보세요 💬</p>}
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
      </>
    );
          })()}
        </section>
      </main>
    </div>
  ) : null;

  return (
    <>
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
            isSubmitting={isPostSubmitting}
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
              <div className="homeFeedScroll" ref={homeFeedScrollRef}>
              {!loading && !homeLoadError && (
                <div className="homeFeedStickyBar">
                  <HomeFeedTopBar
                    searchQuery={homeSearchQuery}
                    onSearchChange={setHomeSearchQuery}
                    onOpenSearch={openHomeSearch}
                    unreadNotificationCount={unreadNotificationCount}
                    onNotificationsClick={() => setShowNotifications(true)}
                    onAddClick={() => {
                      track("curation_write_open");
                      setShowPostModal(true);
                    }}
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
                  action={{
                    label: "큐레이션 작성하기",
                    onClick: () => {
                      track("curation_write_open");
                      setShowPostModal(true);
                    },
                  }}
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
                  {filteredHomeFeedPosts.map((post) => {
                    const repPlace = getRepresentativePlaceForPost(post);
                    return (
                    <PostGridCell
                      key={post.id}
                      variant="home"
                      imageUrl={post.images[0]}
                      titleLine={(post.title || post.comment || repPlace.placeName || "").trim()}
                      placeName={repPlace.placeName}
                      address={repPlace.address}
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
                    );
                  })}
                </PostGrid>
              )}
              {!loading && !homeLoadError && (
                <div
                  ref={feedLoadMoreSentinelRef}
                  style={{ height: 1, width: "100%" }}
                  aria-hidden
                />
              )}
              {feedLoadingMore && (
                <p
                  style={{
                    margin: "8px 0 16px",
                    textAlign: "center",
                    fontSize: 12,
                    color: "#9aa1bc",
                  }}
                >
                  더 불러오는 중…
                </p>
              )}
              </div>
            </div>
          )}

          {activeTab === "messages" && (
  <div
    className={activeChatRoom ? "screen messagesChatShell" : "screen messagesListShell"}
    style={{
      paddingTop: "env(safe-area-inset-top, 0px)",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      minHeight: 0,
      flex: 1,
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
              data-coach="message_friend"
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
        <div
          className="messagesListScroll"
          style={{
            paddingBottom: keyboardHeight > 0 ? `${keyboardHeight + 8}px` : undefined,
            transition: "padding-bottom 0.25s ease",
          }}
        >
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
              <div className="mapTabStickyTop">
                <div className="mapTabHeaderRow">
                  <p className="mapTabTitle">지도</p>
                  {activeJobs.length > 0 && (
                    <button
                      type="button"
                      className="mapTabJobsBtn"
                      onClick={() => setShowJobsModal(true)}
                    >
                      분석 중인 작업: {activeJobs.length}개
                    </button>
                  )}
                </div>
                <div className="mapReelInputSection">
                  {!reelInputExpanded ? (
                    <>
                      <button
                        type="button"
                        className="mapReelExpandBtn"
                        data-coach="reels_save"
                        onClick={expandReelInput}
                      >
                        <span className="mapReelExpandBtnIcon" aria-hidden>+</span>
                        릴스로 장소 추가하기
                      </button>
                      <p className="mapReelExpandHint">
                        인스타 릴스 링크를 붙여넣으면 지도에 핀이 찍혀요
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="mapReelInputPanel">
                        <div className="mapReelInputRow">
                          <span className="mapReelInstaIcon" aria-hidden>
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                              <rect x="2.5" y="2.5" width="13" height="13" rx="4" stroke="currentColor" strokeWidth="1.4" />
                              <circle cx="9" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.4" />
                              <circle cx="13.2" cy="4.8" r="0.9" fill="currentColor" />
                            </svg>
                          </span>
                          <input
                            ref={instagramUrlInputRef}
                            className="mapInputReel"
                            placeholder="릴스·게시물 링크 붙여넣기"
                            value={instagramUrl}
                            onChange={(e) => setInstagramUrl(e.target.value)}
                          />
                          <button
                            className="mapReelSubmitBtn"
                            onClick={() => { void handleAddFromInstagram(); }}
                            type="button"
                            disabled={!canSubmit}
                          >
                            {isSubmitting ? "분석 중..." : "핀 추가"}
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="mapReelCollapseBtn"
                        onClick={collapseReelInput}
                      >
                        닫기
                      </button>
                    </>
                  )}
                  {clipboardSuggestedUrl && (
                    <div className="clipboardInstagramBanner" role="status">
                      <p className="clipboardInstagramBannerText">인스타 링크를 복사하셨네요</p>
                      <button
                        type="button"
                        className="clipboardInstagramBannerSave"
                        onClick={handleClipboardBannerAccept}
                      >
                        저장하기
                      </button>
                      <button
                        type="button"
                        className="clipboardInstagramBannerClose"
                        aria-label="닫기"
                        onClick={dismissClipboardSuggest}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="mapTabScrollBody">
              <div className="mapHeroBlock">
                <div className="mapCompactWrap">
                  {(kakaoStatus === "idle" || kakaoStatus === "loading" || (kakaoStatus === "ready" && !compactMapReady)) && (
                    <div
                      className="mapCompactLoading"
                      aria-hidden={compactMapReady}
                    >
                      <span style={{ fontSize: "28px", lineHeight: 1 }}>🗺️</span>
                      <p className="mapCompactLoadingTitle">지도를 불러오는 중...</p>
                      <p className="mapCompactLoadingSub">
                        {kakaoStatus !== "ready" ? "카카오맵 SDK를 불러오고 있어요" : "지도를 그리고 있어요"}
                      </p>
                    </div>
                  )}
                  <div
                    ref={mapContainerRef}
                    className="kakaoMap mapCompactMap"
                  />
                  <button
                    type="button"
                    className="mapCompactTapLayer"
                    aria-label="지도를 열어 검색 및 길찾기"
                    onClick={openMapFullscreen}
                  />
                  <button
                    type="button"
                    className="mapCompactFeatureChip"
                    data-coach="map_search"
                    onClick={(e) => {
                      e.stopPropagation();
                      openMapFullscreen();
                    }}
                  >
                    <span className="mapCompactFeatureChipIcon" aria-hidden>🔍</span>
                    지도 열어서 검색·길찾기
                    <span className="mapCompactFeatureChipArrow" aria-hidden>→</span>
                  </button>
                </div>
              </div>
              {isAnalyzing && (
                <div className="mapTabStatusBlock">
                  <p className="mapTabStatusMain">{analyzingMainText}</p>
                  <p className="mapTabStatusSub">{analyzingSubText}</p>
                </div>
              )}
              {!isAnalyzing && status && <p className="hintText">{status}</p>}
              {error && <p className="emptyText">{error}</p>}
              {kakaoStatus === "loading" && <p className="hintText">카카오맵 SDK를 불러오는 중입니다</p>}
              {kakaoStatus === "error" && <p className="emptyText">카카오맵 로딩에 실패했습니다.</p>}
              {(() => {
                const nativeAvail = isNativeMapAvailable();
                const adminCourseWebPortal =
                  showCourseRoute &&
                  (user?.id === ADMIN_USER_ID || userIdRef.current === ADMIN_USER_ID);
                const showWebExpandedPortal =
                  mapExpanded &&
                  (!nativeAvail || adminCourseWebPortal) &&
                  typeof document !== "undefined";
                logAdminCourseMap(user?.id ?? userIdRef.current, "web expanded portal gate", {
                  mapExpanded,
                  nativeAvail,
                  showCourseRoute,
                  adminCourseWebPortal,
                  showWebExpandedPortal,
                  hasContainerRef: !!mapExpandedRef.current,
                  kakaoStatus,
                });
                if (!showWebExpandedPortal) return null;
                return createPortal(
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
                            setCourseDesignPath(null);
                            setCourseNavigation(null);
                            setCourseNavSegmentIndex(null);
                            setCourseNavFocusMode(false);
                            setCourseNavStepIndex(null);
                            fullscreenCourseNavigationRef.current = null;
                            setShowCourseModal(true);
                            return;
                          }
                          setMapExpanded(false);
                          setSelectedPlace(null);
                          setShowCourseRoute(false);
                          setCourseDesignPath(null);
                          setCourseNavigation(null);
                          setCourseNavSegmentIndex(null);
                          setCourseNavFocusMode(false);
                          setCourseNavStepIndex(null);
                          fullscreenCourseNavigationRef.current = null;
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
                    {!showCourseRoute && (
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
                    )}
                    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                      <div ref={mapExpandedRef} className="kakaoMap" style={{ width: "100%", height: "100%", touchAction: "manipulation" }} />
                      {(() => {
                        const canMountAdminOverlay =
                          !!showCourseRoute &&
                          user?.id === ADMIN_USER_ID &&
                          !!courseResult &&
                          courseResult.length > 0 &&
                          mapExpanded &&
                          expandedMapPinsTick > 0 &&
                          !!expandedMapRef.current;
                        if (user?.id === ADMIN_USER_ID && showCourseRoute) {
                          logAdminCourseMap(user.id, "render gate", {
                            showCourseRoute,
                            userId: user?.id,
                            userMatch: user?.id === ADMIN_USER_ID,
                            courseCount: courseResult?.length ?? 0,
                            mapExpanded,
                            expandedMapPinsTick,
                            hasExpandedMap: !!expandedMapRef.current,
                            courseDesignPathPts: courseDesignPath?.length ?? null,
                            canMountAdminOverlay,
                          });
                        }
                        if (!canMountAdminOverlay || !courseResult) return null;
                        const showSegmentPinsOnly =
                          !courseNavFullRouteView &&
                          courseNavSegmentIndex != null &&
                          (courseNavFocusMode ||
                            user?.id === ADMIN_USER_ID ||
                            userIdRef.current === ADMIN_USER_ID);
                        const adminCourseMapPlaces = showSegmentPinsOnly
                          ? courseResult
                              .slice(courseNavSegmentIndex, courseNavSegmentIndex + 2)
                              .map((p, i) => ({
                                id: p.id,
                                name: p.name,
                                lat: p.lat,
                                lng: p.lng,
                                order: courseNavSegmentIndex + i + 1,
                              }))
                          : courseResult.map((p, i) => ({
                              id: p.id,
                              name: p.name,
                              lat: p.lat,
                              lng: p.lng,
                              order: i + 1,
                            }));
                        return (
                          <CourseMapDesignOverlay
                            map={expandedMapRef.current}
                            places={adminCourseMapPlaces}
                            path={courseDesignPath ?? courseResult.map((p) => ({ lat: p.lat, lng: p.lng }))}
                            guideSteps={
                              !courseNavFullRouteView && courseNavSegmentIndex != null
                                ? (
                                    courseNavigation?.segments[courseNavSegmentIndex]?.steps ?? []
                                  ).map((step, i) => ({
                                    lat: step.lat,
                                    lng: step.lng,
                                    active: courseNavStepIndex === i,
                                  }))
                                : []
                            }
                            onGuideStepClick={handleCourseNavSelectStep}
                            debugAdmin
                            onPinClick={(place) => {
                              const full = courseResult.find((p) => p.id === place.id) ?? null;
                              if (!full) return;
                              const coursePlaceRef = placeRefFromPlace(
                                {
                                  id: full.id,
                                  name: full.name,
                                  address: full.address,
                                  category: full.category,
                                },
                                full.lat,
                                full.lng,
                              );
                              setSelectedPlace({
                                place_name: full.name,
                                category_name: full.category,
                                road_address_name: full.address,
                                address_name: full.address,
                                phone: "",
                                place_url: "",
                                y: String(full.lat),
                                x: String(full.lng),
                                _feedPosts: getRelatedPostsForPlaceSheet(feedPosts, coursePlaceRef),
                                _placeRef: coursePlaceRef,
                                _savedPlaceId: full.id,
                              });
                            }}
                          />
                        );
                      })()}
                      {expandedNativeMapEnabled && isNativeMapAvailable() && (
                        <>
                          <div id="extended-map-slot" className="extendedNativeMapSlot" aria-hidden />
                          <div className="extendedNativeMapDivider" aria-hidden />
                          <span className="extendedNativeMapBadge">Kakao Native · 상단 50%</span>
                        </>
                      )}
                      <MapResearchAreaButton visible={showMapResearchButton} onResearch={handleResearchThisArea} />
                      {showCourseRoute && courseNavigation && (
                        <CourseNavigationOverlay
                          navigation={courseNavigation}
                          selectedSegmentIndex={courseNavSegmentIndex}
                          segmentFocusMode={courseNavFocusMode}
                          onSelectSegment={handleCourseNavSelectSegment}
                          onPrevSegment={handleCourseNavPrevSegment}
                          onNextSegment={handleCourseNavNextSegment}
                          onToggleFocusMode={handleCourseNavToggleFocusMode}
                          onShowFullRoute={handleCourseNavShowFullRoute}
                          darkTone={
                            user?.id === ADMIN_USER_ID || userIdRef.current === ADMIN_USER_ID
                          }
                          showTurnByTurn={
                            user?.id === ADMIN_USER_ID || userIdRef.current === ADMIN_USER_ID
                          }
                          activeStepIndex={courseNavStepIndex}
                          onSelectStep={handleCourseNavSelectStep}
                          onPanelMetrics={handleCourseNavPanelMetrics}
                        />
                      )}
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
                );
              })()}
              <div className="mapPlacesPanel">
                {savedPlaces.length > 0 && (
                  <>
                    <div className="mapPlacesSectionHeader">
                      <button
                        type="button"
                        className="mapHideAllBtn"
                        title="릴스로 추가된 장소 목록을 지웁니다 (저장·핀은 유지)"
                        onClick={() => setHiddenIds(new Set(savedPlaces.map((p) => p.id)))}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path d="M2.5 4.5h11M6 4.5V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M12.5 4.5l-.6 8.2a1 1 0 0 1-1 .8H5.1a1 1 0 0 1-1-.8l-.6-8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        검색기록 삭제
                      </button>
                    </div>
                    <div className="miniList">
                      {savedPlaces.filter(p => !hiddenIds.has(p.id)).map((place) => (
                        <article key={place.id} className="miniItem" onClick={() => handleMiniListClick(place)} style={{ cursor: "pointer" }}>
                          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: CATEGORY_COLORS[place.category], flexShrink: 0, display: "inline-block" }} />
                          <div style={{ flex: 1 }}><p className="miniName">{place.name}</p><p className="miniMeta">{place.address} · {place.category}</p></div>
                          <button className="miniItemRemoveBtn" onClick={(e) => { e.stopPropagation(); hideFromMap(place.id); }} type="button" aria-label={`${place.name} 목록에서 숨기기`}>×</button>
                        </article>
                      ))}
                      {savedPlaces.filter(p => !hiddenIds.has(p.id)).length === 0 && (
                        <p className="mapPlacesEmptyHint">
                          검색기록을 지웠어요.{" "}
                          <button type="button" onClick={resetHiddenPlaces}>다시 보기</button>
                        </p>
                      )}
                    </div>
                  </>
                )}
                {savedPlaces.length === 0 && (
                  <div className="miniList">
                    <EmptyState
                      icon=""
                      title="아직 핀이 없어요"
                      description="인스타그램 릴스나 게시물 URL을 붙여넣으면 지도에 자동으로 핀이 찍혀요"
                      action={{
                        label: "릴스 붙여넣기",
                        onClick: () => {
                          setReelInputExpanded(true);
                          instagramUrlInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                          instagramUrlInputRef.current?.focus();
                        },
                      }}
                    />
                  </div>
                )}
              </div>
              </div>
          </div>

          {activeTab === "saved" && (
  <div className="screen" style={{ paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "border-box" }}>
  <div
    style={{
      paddingBottom:
        keyboardHeight > 0
          ? keyboardHeight
          : savedPlaces.length > 0 && !showCourseModal
            ? "calc(100px + env(safe-area-inset-bottom, 0px))"
            : 0,
      transition: "padding-bottom 0.25s ease",
      boxSizing: "border-box",
    }}
  >
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
    <p className="screenTitle" style={{ margin: 0 }}>저장한 장소</p>
    {savedPlaces.length > 0 && (
      <button
        type="button"
        data-coach="course_create"
        onClick={() => {
          track("course_create_open");
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
              {user?.id === ADMIN_USER_ID && (
                <div style={{ flexShrink: 0, padding: "12px 16px 0", boxSizing: "border-box" }}>
                  {(() => {
                    const alertNoSuccess =
                      !!adminStatus && adminStatus.today.attempts > 0 && adminStatus.today.success === 0;
                    const alertRate = !!adminStatus && adminStatus.last7Days.successRate < 50;
                    const lastMs = adminStatus?.lastSuccessAt
                      ? Date.now() - new Date(adminStatus.lastSuccessAt).getTime()
                      : Number.POSITIVE_INFINITY;
                    const alertStale =
                      !!adminStatus && (!adminStatus.lastSuccessAt || lastMs >= 24 * 60 * 60 * 1000);
                    const alertStuck = !!adminStatus && adminStatus.stuckJobs >= 1;
                    const alertBootFail = !!bootFailReport && bootFailReport.count > 0;
                    const hasAlert =
                      alertNoSuccess || alertRate || alertStale || alertStuck || alertBootFail;
                    const todaySummary = adminStatus
                      ? `${adminStatus.today.success}/${adminStatus.today.failed}`
                      : "–/–";
                    const bootMs =
                      lastBootTiming != null ? `${lastBootTiming.totalMs}ms` : "–";
                    const summaryLabel = adminStatusLoading
                      ? "불러오는 중"
                      : !adminStatus
                        ? "상태 없음"
                        : hasAlert
                          ? "주의"
                          : "정상";
                    const summaryText = `${summaryLabel} · 오늘 ${todaySummary} · 부팅 ${bootMs}`;
                    const dotColor = hasAlert ? "#c62828" : "#b0b3c0";
                    const summaryColor = hasAlert ? "#c62828" : "#8f93a6";
                    const row = (label: string, value: string, alert: boolean) => (
                      <p
                        key={label}
                        style={{
                          margin: "0 0 4px",
                          fontSize: 13,
                          color: alert ? "#c62828" : "#8f93a6",
                          fontWeight: alert ? 700 : 400,
                        }}
                      >
                        {label}: {value}
                      </p>
                    );
                    return (
                      <div
                        style={{
                          width: "100%",
                          border: hasAlert ? "0.5px solid #f5c2c2" : "0.5px solid #e8e8ee",
                          borderRadius: 12,
                          background: hasAlert ? "#fff8f8" : "#fafafa",
                          overflow: "hidden",
                          boxSizing: "border-box",
                        }}
                      >
                        <button
                          type="button"
                          aria-expanded={adminCardOpen}
                          onClick={() => {
                            setAdminCardOpen((v) => {
                              const next = !v;
                              writeAdminStatusCardOpen(next);
                              return next;
                            });
                          }}
                          style={{
                            width: "100%",
                            height: 40,
                            maxHeight: 40,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "0 14px",
                            margin: 0,
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            boxSizing: "border-box",
                            textAlign: "left",
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              flexShrink: 0,
                              background: dotColor,
                            }}
                          />
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: 13,
                              fontWeight: hasAlert ? 700 : 600,
                              color: summaryColor,
                            }}
                          >
                            {summaryText}
                          </span>
                          <span
                            aria-hidden
                            style={{
                              flexShrink: 0,
                              fontSize: 11,
                              color: "#b0b3c0",
                              transform: adminCardOpen ? "rotate(180deg)" : "rotate(0deg)",
                              transition: "transform 0.2s ease",
                            }}
                          >
                            ▾
                          </span>
                        </button>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateRows: adminCardOpen ? "1fr" : "0fr",
                            transition: "grid-template-rows 0.28s ease",
                          }}
                        >
                          <div style={{ overflow: "hidden", minHeight: 0 }}>
                            <div style={{ padding: "0 14px 12px" }}>
                              <p
                                style={{
                                  margin: "0 0 8px",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#8f93a6",
                                  letterSpacing: "0.02em",
                                }}
                              >
                                서비스 상태 {adminStatusLoading ? "· 불러오는 중" : ""}
                              </p>
                              {adminStatus ? (
                                <>
                                  {row(
                                    "오늘 추출",
                                    `성공 ${adminStatus.today.success} / 실패 ${adminStatus.today.failed}`,
                                    alertNoSuccess,
                                  )}
                                  {row("7일 성공률", `${adminStatus.last7Days.successRate}%`, alertRate)}
                                  {row(
                                    "마지막 성공",
                                    formatAdminHoursAgo(adminStatus.lastSuccessAt),
                                    alertStale,
                                  )}
                                  {row("멈춘 job", `${adminStatus.stuckJobs}건`, alertStuck)}
                                  {row(
                                    "오늘 가입",
                                    `${adminStatus.signups.today}명 (전체 ${adminStatus.signups.total}명)`,
                                    false,
                                  )}
                                  {row(
                                    "이벤트 로그",
                                    `${adminStatus.userEventsTotal.toLocaleString("ko-KR")}건`,
                                    false,
                                  )}
                                  {row(
                                    "마지막 정리",
                                    formatAdminHoursAgo(adminLastCleanupAt),
                                    false,
                                  )}
                                  <div
                                    style={{
                                      marginTop: 10,
                                      paddingTop: 10,
                                      borderTop: "0.5px solid #ebebf0",
                                    }}
                                  >
                                    <p
                                      style={{
                                        margin: "0 0 6px",
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: "#8f93a6",
                                      }}
                                    >
                                      최근 실패 3건
                                    </p>
                                    {adminStatus.recentFailures.length === 0 ? (
                                      <p style={{ margin: 0, fontSize: 12, color: "#8f93a6" }}>
                                        실패 기록 없음
                                      </p>
                                    ) : (
                                      adminStatus.recentFailures.map((f, i) => (
                                        <pre
                                          key={i}
                                          style={{
                                            margin: "0 0 8px",
                                            padding: 8,
                                            borderRadius: 8,
                                            background: "#fff",
                                            border: "0.5px solid #eee",
                                            fontSize: 11,
                                            color: "#c62828",
                                            whiteSpace: "pre-wrap",
                                            wordBreak: "break-word",
                                            fontFamily:
                                              "ui-monospace, SFMono-Regular, Menlo, monospace",
                                          }}
                                        >
                                          {f.error_message || "(empty)"}
                                        </pre>
                                      ))
                                    )}
                                  </div>
                                </>
                              ) : (
                                !adminStatusLoading && (
                                  <p style={{ margin: 0, fontSize: 12, color: "#8f93a6" }}>
                                    상태를 불러오지 못했어요
                                  </p>
                                )
                              )}
                              {lastBootTiming && (
                                <div
                                  style={{
                                    marginTop: 10,
                                    paddingTop: 10,
                                    borderTop: "0.5px solid #ebebf0",
                                  }}
                                >
                                  <p
                                    style={{
                                      margin: "0 0 6px",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: "#8f93a6",
                                    }}
                                  >
                                    마지막 부팅 · 총 {lastBootTiming.totalMs}ms
                                  </p>
                                  {lastBootTiming.segments.length === 0 ? (
                                    <p style={{ margin: 0, fontSize: 12, color: "#8f93a6" }}>
                                      구간 기록 없음
                                    </p>
                                  ) : (
                                    lastBootTiming.segments.map((seg) => (
                                      <p
                                        key={`${seg.from}-${seg.to}`}
                                        style={{
                                          margin: "0 0 3px",
                                          fontSize: 12,
                                          color: "#8f93a6",
                                        }}
                                      >
                                        {seg.from} → {seg.to}: {seg.ms}ms
                                      </p>
                                    ))
                                  )}
                                </div>
                              )}
                              {bootFailReport && bootFailReport.count > 0 && (
                                <p style={{ margin: "10px 0 0", fontSize: 12, color: "#c62828", fontWeight: 600 }}>
                                  부팅 실패 {bootFailReport.count}회 / 마지막{" "}
                                  {formatAdminHoursAgo(bootFailReport.lastAt)}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
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
                        { label: "게시", value: myMypagePostsCount },
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
              <div
                ref={mypageTabScrollRef}
                className="mypageTabScroll"
                style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#fff" }}
              >
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
                  {myMypagePosts.map((post) => {
                    const repPlace = getRepresentativePlaceForPost(post);
                    return (
                    <PostGridCell
                      key={post.id}
                      imageUrl={post.images[0]}
                      titleLine={(post.title || repPlace.placeName || "").trim()}
                      placeName={repPlace.placeName}
                      address={repPlace.address}
                      likeCount={post.likes_count}
                      onClick={() => {
                        setDetailReturnTo({ type: "mypage" });
                        setActiveTab("mypage");
                        setDetailPostId(post.id);
                      }}
                    />
                    );
                  })}
                </PostGrid>
                {myMypagePosts.length < myMypagePostsCount && (
                  <div
                    ref={mypagePostsLoadMoreSentinelRef}
                    style={{ height: 1, width: "100%" }}
                    aria-hidden
                  />
                )}
                {myMypagePostsLoading && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      padding: "14px 0 22px",
                    }}
                  >
                    <span className="postsGridLoadSpinner" aria-label="불러오는 중" />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
        <BottomTabBar
          activeTab={activeTab}
          onTabChange={(id) => {
            const tabEvent: Record<TabId, string> = {
              home: "tab_home",
              messages: "tab_message",
              map: "tab_map",
              saved: "tab_saved",
              mypage: "tab_mypage",
            };
            track(tabEvent[id]);
            setActiveTab(id);
          }}
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
              showDirections
              directionsMode={directionsMode}
              directionsLoading={directionsLoading}
              directionsInfo={directionsInfo}
              onClose={() => {
                setSelectedPlace(null);
                setSelectedMapPlace(null);
              }}
              onToggleSave={() => { void togglePlaceSheetSave(selectedPlace as PlaceSheetData); }}
              onCurationClick={(postId, photoIndex) => {
                openPlaceCurationFromSheet(selectedPlace as PlaceSheetData, postId, photoIndex);
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
              onExpandMap={() => expandPlaceSheetToFullscreen(selectedPlace as PlaceSheetData)}
              onDirectionsModeChange={(mode) => {
                void startDirectionsFromPlaceSheet(selectedPlace as PlaceSheetData, mode);
              }}
              onOpenTransit={() => {
                void startDirectionsFromPlaceSheet(selectedPlace as PlaceSheetData, "transit");
              }}
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
                onCurationClick={(postId, photoIndex) => {
                  setHomePlaceSheet(null);
                  openPlaceCurationFromSheet(homePlaceSheet, postId, photoIndex);
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
        {/* Stable file input outside portal — matches Step1Photos / profile avatar (no capture) */}
        <input
          ref={courseInviteImageInputRef}
          type="file"
          accept="image/*"
          className="courseShareModalInviteFileInput"
          style={{ display: "none" }}
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            try {
              const file = e.target.files?.[0] ?? null;
              void handleCourseInviteImageFile(file);
            } catch (err) {
              console.error("[course-invite-image] select failed", err);
              showToast("사진을 불러오지 못했어요", "error");
              if (courseInviteImageInputRef.current) courseInviteImageInputRef.current.value = "";
            }
          }}
        />
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
            {homeSearchResultPosts.map((post) => {
              const repPlace = getRepresentativePlaceForPost(post);
              return (
              <PostGridCell
                key={post.id}
                variant="home"
                imageUrl={post.images[0]}
                titleLine={(post.title || post.comment || repPlace.placeName || "").trim()}
                placeName={repPlace.placeName}
                address={repPlace.address}
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
              );
            })}
          </PostGrid>
        )}
      </HomeSearchScreen>
    )}
    {(() => {
      const def = COACHMARK_DEFS.find((d) => d.id === activeCoach);
      if (!def) return null;
      return (
        <Coachmark
          targetSelector={`[data-coach="${def.id}"]`}
          title={def.title}
          body={def.body}
          placement={def.placement}
          onDismiss={async () => {
            await setCoachSeen(def.id);
            setActiveCoach(null);
            setCoachTick((v) => v + 1);
          }}
          onTargetMissing={() => {
            console.warn(`[coachmark] target missing: ${def.id}`);
          }}
        />
      );
    })()}
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
    {typeof document !== "undefined" &&
      createPortal(
        <ExtractLoadingOverlay
          open={showExtractOverlay}
          complete={extractOverlayComplete}
          completeVariant={extractOverlayCompleteVariant}
          errorMessage={extractOverlayError}
          errorRaw={extractOverlayErrorRaw}
          onDismiss={() => {
            setShowExtractOverlay(false);
            setExtractOverlayComplete(false);
            setExtractOverlayError(null);
            setExtractOverlayErrorRaw(null);
            setExtractOverlayCompleteVariant("success");
          }}
          onViewMap={undefined}
          onRetry={
            extractRetryUrl
              ? () => {
                  const url = extractRetryUrl;
                  setExtractOverlayError(null);
                  setExtractOverlayErrorRaw(null);
                  setExtractOverlayComplete(false);
                  setExtractOverlayCompleteVariant("success");
                  setShowExtractOverlay(false);
                  void handleAddFromInstagram(url);
                }
              : undefined
          }
        />,
        document.body,
      )}
    {placePostsList && (
      <PlacePostsListScreen
        data={placePostsList}
        onClose={closePlacePostsList}
        onPostClick={(postId) => {
          const post = placePostsList.posts.find((p) => p.id === postId);
          setDetailEntryPhotoIndex(
            post
              ? getFirstMatchingPhotoIndex(post, {
                  placeName: placePostsList.placeName,
                  address: placePostsList.address,
                })
              : 0,
          );
          setDetailPostId(postId);
        }}
      />
    )}
    {curationDetailOverlayEl}
    </>
  );
}