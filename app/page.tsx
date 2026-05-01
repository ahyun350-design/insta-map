"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useUser, logout } from "@/lib/useUser";
import FeedSkeleton from "@/components/FeedSkeleton";
import EmptyState from "@/components/EmptyState";
import { useToast } from "@/components/Toast";
type TabId = "home" | "messages" | "map" | "saved" | "mypage";
type Category = "맛집" | "카페" | "쇼핑" | "숙소";
type Place = { id: string; name: string; address: string; category: Category };
type KakaoStatus = "idle" | "loading" | "ready" | "error";
type Comment = { id: string; user: string; text: string; createdAt: string };
type FeedPost = {
  id: string; user: string; userId: string; title: string; placeName: string; address: string;
  category: Category; comment: string; images: string[]; createdAt: string;
  archived?: boolean; likes: string[]; comments: Comment[];
};
type FriendRoom = { id: string; friendId: string; friendName: string };
type ChatRoom = { id: string; friendId: string; friendName: string; lastMessage: string; lastTime: string; unreadCount: number; };
type Message = { id: string; senderId: string; text: string; createdAt: string; read?: boolean; };
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
  result_places?: Array<Omit<Place, "id">>;
  error_message?: string | null;
  error?: string;
};
type LatLng = { lat: number; lng: number };

declare global { interface Window { kakao: any; } }

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "home", label: "홈", icon: "🏠" },
  { id: "messages", label: "메시지", icon: "💬" },
  { id: "map", label: "지도", icon: "🗺️" },
  { id: "saved", label: "저장", icon: "🔖" },
  { id: "mypage", label: "마이", icon: "👤" },
];
const CHAT_LIST = [
  { id: "1", name: "지수", preview: "이번 주말 성수 갈래?", time: "오후 4:12" },
  { id: "2", name: "민호", preview: "저장해둔 카페 링크 보내줘!", time: "오전 11:05" },
  { id: "3", name: "여행메이트", preview: "부산 맛집 리스트 공유했어", time: "어제" },
];

const CATEGORY_CLASS: Record<Category, string> = { 맛집: "restaurant", 카페: "cafe", 쇼핑: "shopping", 숙소: "stay" };
const CATEGORY_PIN: Record<Category, { color: string; emoji: string }> = {
  맛집: { color: "#513229", emoji: "🍽️" }, 카페: { color: "#FCE6B7", emoji: "☕" },
  쇼핑: { color: "#D8EBF9", emoji: "🛍️" }, 숙소: { color: "#D7D4B1", emoji: "🏠" },
};
const CATEGORY_COLORS: Record<Category, string> = { 맛집: "#513229", 카페: "#b08d57", 쇼핑: "#4a7fa5", 숙소: "#7a7a50" };
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

// 좌표가 있는 장소들에서 가까운 순으로 코스 짜기 (Nearest Neighbor 알고리즘)
type CoursePlace = Place & { lat: number; lng: number };

function buildCourse(
  origin: { lat: number; lng: number },
  candidates: CoursePlace[],
  options?: { enforceNoConsecutiveSameExceptShopping?: boolean }
): CoursePlace[] {
  const remaining = [...candidates];
  const result: CoursePlace[] = [];
  let currentLat = origin.lat;
  let currentLng = origin.lng;
  const enforce = options?.enforceNoConsecutiveSameExceptShopping === true;

  while (remaining.length > 0) {
    const lastCat = result[result.length - 1]?.category;
    const scored = remaining
      .map((p, i) => ({ i, p, d: getDistance(currentLat, currentLng, p.lat, p.lng) }))
      .sort((a, b) => a.d - b.d);

    let pickI: number;
    let pickP: CoursePlace;

    if (!enforce || !lastCat || remaining.length === 1) {
      pickI = scored[0]!.i;
      pickP = scored[0]!.p;
    } else if (lastCat === "쇼핑") {
      pickI = scored[0]!.i;
      pickP = scored[0]!.p;
    } else {
      const found = scored.find(({ p }) => p.category === "쇼핑" || p.category !== lastCat);
      if (found) {
        pickI = found.i;
        pickP = found.p;
      } else {
        pickI = scored[0]!.i;
        pickP = scored[0]!.p;
      }
    }

    result.push(pickP);
    currentLat = pickP.lat;
    currentLng = pickP.lng;
    remaining.splice(pickI, 1);
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

export default function HomePage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa" }}><p style={{ fontSize: "13px", color: "#888" }}>불러오는 중...</p></main>}>
      <HomePageContent />
    </Suspense>
  );
}

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: userLoading } = useUser();
  const MY_USER = user?.id || "";
  const MY_USERNAME = user?.username || "";
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [friendRooms, setFriendRooms] = useState<FriendRoom[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("map");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [savedPlaces, setSavedPlaces] = useState<Place[]>([]);
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [kakaoStatus, setKakaoStatus] = useState<KakaoStatus>("idle");
  /** 카카오맵 JS SDK 객체 사용 가능 (`kakao.maps.load` 콜백 이후 true) */
  const [isKakaoMapLoaded, setIsKakaoMapLoaded] = useState(false);
  /** 지도 탭 작은 지도 패널에 Map 인스턴스 생성까지 완료 */
  const [compactMapReady, setCompactMapReady] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [showJobsModal, setShowJobsModal] = useState(false);
  const [activeJobs, setActiveJobs] = useState<ActiveExtractJob[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [detailPostId, setDetailPostId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<FeedPost | null>(null);
  const [editComment, setEditComment] = useState("");
  const [showPostModal, setShowPostModal] = useState(false);
  const [postTitle, setPostTitle] = useState(""); const [postPlaceName, setPostPlaceName] = useState("");
  const [postAddress, setPostAddress] = useState(""); const [postCategory, setPostCategory] = useState<Category>("카페");
  const [postComment, setPostComment] = useState(""); const [postSearchQuery, setPostSearchQuery] = useState("");
  const [postSearchResults, setPostSearchResults] = useState<any[]>([]); const [postImages, setPostImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [activeChatRoom, setActiveChatRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [friendSearch, setFriendSearch] = useState("");
  const [friendSearchResult, setFriendSearchResult] = useState<{id: string; username: string} | null>(null);
  const [friendSearchError, setFriendSearchError] = useState("");
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [selectedMapPlace, setSelectedMapPlace] = useState<Place | null>(null);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [directionsInfo, setDirectionsInfo] = useState<{duration: number; distance: number} | null>(null);
  const [directionsMode, setDirectionsMode] = useState<"car" | "walk">("car");
  const [savedSearchQuery, setSavedSearchQuery] = useState("");

  // 코스 만들기 관련 state
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [courseCounts, setCourseCounts] = useState({ 카페: 0, 맛집: 0, 쇼핑: 0, 숙소: 0 });
  const [courseOriginMode, setCourseOriginMode] = useState<"current" | "manual">("current");
  const [courseOriginAddress, setCourseOriginAddress] = useState("");
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseResult, setCourseResult] = useState<CoursePlace[] | null>(null);
  const [showCourseRoute, setShowCourseRoute] = useState(false);
  const [courseCurrentLocation, setCourseCurrentLocation] = useState<LatLng | null>(null);
  const [courseLocationLoading, setCourseLocationLoading] = useState(false);
  const [coursePlaceCoords, setCoursePlaceCoords] = useState<Record<string, LatLng>>({});
  const pollAttemptsRef = useRef<Record<string, number>>({});
  const pollInFlightRef = useRef<Set<string>>(new Set());
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const commentInputRef = useRef<HTMLInputElement | null>(null);
  const commentSectionRef = useRef<HTMLDivElement | null>(null);
  const [scrollToComment, setScrollToComment] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null); const mapExpandedRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null); const expandedMapRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null); const markersRef = useRef<any[]>([]);
  const expandedMarkersRef = useRef<any[]>([]); const feedMarkersRef = useRef<any[]>([]);
  const searchMarkersRef = useRef<any[]>([]); const routePolylineRef = useRef<any>(null); const mapKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

  const hideFromMap = (id: string) => setHiddenIds(prev => new Set([...prev, id]));
  const canSubmit = useMemo(() => instagramUrl.trim().length > 0 && !isSubmitting, [instagramUrl, isSubmitting]);
  const canPost = postTitle.trim().length > 0 && postPlaceName.trim().length > 0 && postComment.trim().length > 0 && postImages.length > 0;
  const detailPost = detailPostId ? feedPosts.find(p => p.id === detailPostId) ?? null : null;
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
        return getDistance(courseCurrentLocation.lat, courseCurrentLocation.lng, coord.lat, coord.lng) <= 5;
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

  const loadData = async () => {
    setLoading(true);
    try {
      const uid = user?.id ?? "";
      const [placesRes, postsRes, roomsRes, followsRes] = await Promise.all([
        supabase.from("places").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
        supabase.from("feed_posts").select("*, comments(*)").order("created_at", { ascending: false }),
        supabase.from("chat_rooms").select("*").or(`user1_id.eq.${MY_USER},user2_id.eq.${MY_USER}`),
        supabase.from("follows").select("following_id").eq("follower_id", uid),
      ]);

      setFollowingIds((followsRes.data || []).map((f: any) => f.following_id));

      if (placesRes.data) {
        setSavedPlaces(placesRes.data.map((p) => ({ id: p.id, name: p.name, address: p.address, category: p.category as Category })));
      }
      if (postsRes.data) {
        setFeedPosts(postsRes.data.map((p: any) => ({
          id: p.id, user: p.user_name, userId: p.user_id ?? "", title: p.title, placeName: p.place_name,
          address: p.address, category: p.category as Category, comment: p.comment,
          images: p.images ?? [], createdAt: p.created_at, archived: p.archived,
          likes: p.likes ?? [],
          comments: (p.comments ?? []).map((c: any) => ({ id: c.id, user: c.user_name, text: c.text, createdAt: c.created_at })),
        })));
      }

      const roomsData = roomsRes.data;
      if (roomsData && roomsData.length > 0) {
        const rooms: ChatRoom[] = await Promise.all(
          roomsData.map(async (r: any) => {
            const friendId = r.user1_id === MY_USER ? r.user2_id : r.user1_id;
            const { data: friendData } = await supabase.from("users").select("username").eq("id", friendId).maybeSingle();
            const [msgsRes, unreadRes] = await Promise.all([
              supabase.from("messages").select("*").eq("room_id", r.id).order("created_at", { ascending: false }).limit(1),
              supabase.from("messages").select("*", { count: "exact", head: true }).eq("room_id", r.id).neq("sender_id", MY_USER).eq("read", false),
            ]);
            const unread = typeof unreadRes.count === "number" ? unreadRes.count : 0;
            return {
              id: r.id,
              friendId,
              friendName: friendData?.username || friendId,
              lastMessage: msgsRes.data?.[0]?.text ?? "",
              lastTime: msgsRes.data?.[0]?.created_at ?? r.created_at,
              unreadCount: unread,
            };
          }),
        );
        setChatRooms(rooms);
      } else {
        setChatRooms([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/login");
      return;
    }
    if (user) {
      loadData();
    }
  }, [user, userLoading]);

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
    if (typeof window === "undefined" || userLoading || !user) return;
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
  }, [user, userLoading]);

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
        removeJob(jobId);
        return;
      }

      pollInFlightRef.current.add(jobId);
      try {
        const res = await fetch(`/api/extract/status?jobId=${encodeURIComponent(jobId)}&userId=${encodeURIComponent(user.id)}`, {
          credentials: "include",
        });
        const data = await res.json() as ExtractStatusResponse;
        if (!res.ok) {
          throw new Error(data.error || data.error_message || "작업 상태를 확인할 수 없어요.");
        }

        const nextStatus = data.status;
        const nextStep = data.progress_step ?? "";
        setActiveJobs((prev) => prev.map((job) => job.jobId === jobId ? { ...job, status: nextStatus, progressStep: nextStep } : job));

        const shouldHandleCompleted = nextStatus === "completed"
          || (!!nextStep && nextStep.includes("완료") && Array.isArray(data.result_places));
        if (shouldHandleCompleted) {
          removeJob(jobId);
          const places = data.result_places ?? [];
          const { data: existingPlaces } = await supabase
            .from("places")
            .select("name,address")
            .eq("user_id", user.id);
          const existingSet = new Set(
            (existingPlaces ?? []).map((p) => `${String(p.name).trim()}::${String(p.address).trim()}`),
          );
          const uniquePlaces = places.filter((p) => {
            const key = `${p.name.trim()}::${p.address.trim()}`;
            if (existingSet.has(key)) return false;
            existingSet.add(key);
            return true;
          });
          const duplicateCount = places.length - uniquePlaces.length;
          const rows = uniquePlaces.map((p) => ({
            id: Math.random().toString(36).substring(2) + Date.now().toString(36),
            user_id: user.id,
            name: p.name,
            address: p.address,
            category: p.category,
          }));
          if (rows.length > 0) {
            await supabase.from("places").insert(rows);
            setSavedPlaces((prev) => [
              ...rows.map((r) => ({ id: r.id, name: r.name, address: r.address, category: r.category as Category })),
              ...prev.filter((p) => !rows.some((r) => r.id === p.id)),
            ]);
          }
          showToast(`✨ ${rows.length}개 장소를 추가했어요${duplicateCount > 0 ? ` (중복 ${duplicateCount}개 제외)` : ""}`, "success");
          setStatus(`${rows.length}개 장소를 지도에 추가했어요${duplicateCount > 0 ? ` (중복 ${duplicateCount}개 제외)` : ""}.`);
          return;
        }

        if (nextStatus === "failed") {
          const message = data.error_message || "장소 분석 작업에 실패했어요.";
          showToast(message, "error");
          removeJob(jobId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "작업 상태 확인 중 오류가 발생했어요.";
        showToast(message, "error");
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
  }, [activeJobs, user?.id]);

  const addPlace = async (place: Place) => {
    if (!user?.id) return;
    await supabase.from("places").upsert({ id: place.id, user_id: user.id, name: place.name, address: place.address, category: place.category });
    setSavedPlaces(prev => [place, ...prev.filter(p => p.id !== place.id)]);
  };
  const deletePlace = async (id: string) => {
    await supabase.from("places").delete().eq("id", id);
    setSavedPlaces(prev => prev.filter(p => p.id !== id));
  };
  const submitPost = async (post: FeedPost) => {
    await supabase.from("feed_posts").insert({ id: post.id, user_id: user?.id || "", user_name: MY_USERNAME, title: post.title, place_name: post.placeName, address: post.address, category: post.category, comment: post.comment, images: post.images, likes: [], archived: false });
    setFeedPosts(prev => [post, ...prev]);
  };
  const deletePost = async (id: string) => {
    await supabase.from("feed_posts").delete().eq("id", id);
    setFeedPosts(prev => prev.filter(p => p.id !== id)); setOpenMenuId(null);
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
    const post = feedPosts.find(p => p.id === postId); if (!post) return;
    const liked = post.likes.includes(MY_USERNAME);
    const newLikes = liked ? post.likes.filter(u => u !== MY_USERNAME) : [...post.likes, MY_USERNAME];
    await supabase.from("feed_posts").update({ likes: newLikes }).eq("id", postId);
    setFeedPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: newLikes } : p));
  };
  const addComment = async (postId: string) => {
    if (!newComment.trim()) return;
    const c = { id: Date.now().toString(), post_id: postId, user_id: user?.id || "", user_name: MY_USERNAME, text: newComment.trim() };
    await supabase.from("comments").insert(c);
    const newC: Comment = { id: c.id, user: MY_USERNAME, text: newComment.trim(), createdAt: new Date().toISOString() };
    setFeedPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: [...p.comments, newC] } : p));
    setNewComment("");
  };
  const deleteComment = async (postId: string, commentId: string) => {
    await supabase.from("comments").delete().eq("id", commentId);
    setFeedPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: p.comments.filter(c => c.id !== commentId) } : p));
  };

  const searchFriend = async () => {
    if (!friendSearch.trim()) return;
    setFriendSearchError("");
    setFriendSearchResult(null);
    const { data } = await supabase.from("users").select("*").eq("username", friendSearch.trim()).single();
    if (!data) { setFriendSearchError("유저를 찾을 수 없어요."); return; }
    if (data.username === MY_USER) { setFriendSearchError("나 자신은 추가할 수 없어요."); return; }
    setFriendSearchResult(data);
  };

  const addFriend = async () => {
    if (!friendSearchResult) return;
    // 기존 채팅방 확인
    const { data: existing } = await supabase.from("chat_rooms").select("*")
      .or(`and(user1_id.eq.${MY_USER},user2_id.eq.${friendSearchResult.id}),and(user1_id.eq.${friendSearchResult.id},user2_id.eq.${MY_USER})`);
    let roomId = existing?.[0]?.id;
    if (!roomId) {
      roomId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      await supabase.from("chat_rooms").insert({ id: roomId, user1_id: MY_USER, user2_id: friendSearchResult.id });
    }
    const newRoom: ChatRoom = { id: roomId, friendId: friendSearchResult.id, friendName: friendSearchResult.username, lastMessage: "", lastTime: new Date().toISOString(), unreadCount: 0 };
    setChatRooms(prev => [newRoom, ...prev.filter(r => r.id !== roomId)]);
    setShowAddFriend(false); setFriendSearch(""); setFriendSearchResult(null);
    setActiveChatRoom(newRoom);
  };

  const openChat = async (room: ChatRoom) => {
    setActiveChatRoom(room);
    // 채팅방 들어가면 자기 앞으로 온 메시지를 모두 읽음 처리
    await supabase.from("messages").update({ read: true }).eq("room_id", room.id).neq("sender_id", MY_USER).eq("read", false);
    setChatRooms(prev => prev.map(r => r.id === room.id ? { ...r, unreadCount: 0 } : r));
    const { data } = await supabase.from("messages").select("*").eq("room_id", room.id).order("created_at", { ascending: true });
    if (data) setMessages(data.map((m: any) => ({ id: m.id, senderId: m.sender_id, text: m.text, createdAt: m.created_at, read: m.read })));
    // Realtime 구독
    supabase.channel(`room-${room.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` }, async (payload: any) => {
      const m = payload.new;
      // 이미 화면에 있는 메시지면 무시 (본인이 보낸 메시지가 다시 돌아올 때)
      setMessages(prev => prev.some(msg => msg.id === m.id) ? prev : [...prev, { id: m.id, senderId: m.sender_id, text: m.text, createdAt: m.created_at, read: m.read }]);
      // 받은 메시지면 즉시 읽음 처리 (채팅방 열려있으니까)
      if (m.sender_id !== MY_USER) {
        await supabase.from("messages").update({ read: true }).eq("id", m.id);
      }
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` }, (payload: any) => {
      // 메시지 read 상태 변경 시 화면에 반영
      const m = payload.new;
      setMessages(prev => prev.map(msg => msg.id === m.id ? { ...msg, read: m.read } : msg));
    }).subscribe();
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeChatRoom || !user) return;
    const text = newMessage.trim();
    const id = Date.now().toString();
    const createdAt = new Date().toISOString();
    setMessages(prev => [...prev, { id, senderId: user.id, text, createdAt, read: false }]);
    setNewMessage("");
    await supabase.from("messages").insert({ id, room_id: activeChatRoom.id, sender_id: user.id, text, read: false });
  };

  // 저장 목록 장소 클릭 → 지도에서 보기
  const handleSavedPlaceClick = (place: Place) => {
    setSelectedMapPlace(place);
    setActiveTab("map");
    if (mapRef.current && geocoderRef.current) {
      geocoderRef.current.addressSearch(place.address, (result: any[], sv: string) => {
        if (sv !== window.kakao.maps.services.Status.OK || !result[0]) return;
        mapRef.current.setCenter(new window.kakao.maps.LatLng(result[0].y, result[0].x));
        mapRef.current.setLevel(4);
        const relatedPosts = feedPosts.filter(p => !p.archived && p.placeName === place.name);
        new window.kakao.maps.services.Places().keywordSearch(place.name, (data: any[], st: string) => {
          const base = (st === window.kakao.maps.services.Status.OK && data[0]) ? data[0] : { place_name: place.name, category_name: place.category, road_address_name: place.address, phone: "", place_url: "" };
          setSelectedPlace({ ...base, _feedPosts: relatedPosts });
          setMapExpanded(true);
        });
      });
    }
  };

  /** 큐레이션 상세 → 저장 목록 장소 매칭 후 지도(저장 클릭과 동일) */
  const goToMapFromDetailPost = () => {
    if (!detailPost) return;
    const name = detailPost.placeName.trim();
    const addr = detailPost.address.trim();
    const matchedPlace = savedPlaces.find(
      (p) => String(p.name).trim() === name && String(p.address).trim() === addr,
    );
    const placeForMap: Place =
      matchedPlace ??
      { id: `detail-post:${detailPost.id}`, name: detailPost.placeName, address: detailPost.address, category: detailPost.category };
    handleSavedPlaceClick(placeForMap);
    setDetailPostId(null);
  };

  // 지도 탭의 작은 목록에서 장소 클릭 → 상세 카드만 띄움 (전체화면 X)
  const handleMiniListClick = (place: Place) => {
    const relatedPosts = feedPosts.filter(p => !p.archived && p.placeName === place.name);
    if (!window.kakao?.maps?.services) {
      setSelectedPlace({
        place_name: place.name, category_name: place.category,
        road_address_name: place.address, phone: "", place_url: "",
        _feedPosts: relatedPosts,
      });
      return;
    }
    new window.kakao.maps.services.Places().keywordSearch(place.name, (data: any[], st: string) => {
      const base = (st === window.kakao.maps.services.Status.OK && data[0])
        ? data[0]
        : { place_name: place.name, category_name: place.category, road_address_name: place.address, phone: "", place_url: "" };
      setSelectedPlace({ ...base, _feedPosts: relatedPosts });
    });
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
          .select("username")
          .eq("id", friendId)
          .maybeSingle();
        return {
          id: r.id,
          friendId,
          friendName: friendData?.username ?? friendId,
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

  // 코스 만들기 실행
  const generateCourse = async () => {
    if (!geocoderRef.current) {
      showToast("지도가 아직 준비되지 않았어요. 지도 탭을 한 번 열어주세요.", "info");
      return;
    }
    const totalCount = courseCounts.카페 + courseCounts.맛집 + courseCounts.쇼핑 + courseCounts.숙소;
    if (totalCount === 0) {
      showToast("최소 한 개 이상 선택해주세요", "info");
      return;
    }
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
      const candidates = {
        카페: placesWithCoords.filter((p) => p.category === "카페"),
        맛집: placesWithCoords.filter((p) => p.category === "맛집"),
        쇼핑: placesWithCoords.filter((p) => p.category === "쇼핑"),
        숙소: placesWithCoords.filter((p) => p.category === "숙소"),
      };

      // 4. 요청한 개수가 가능한지 체크 (쇼핑은 중복 OK라고 했지만, 일단 같은 장소 2번은 X 정책으로 갔으니 후보가 부족하면 가능한 만큼만)
      const adjustedCounts = {
        카페: Math.min(courseCounts.카페, candidates.카페.length),
        맛집: Math.min(courseCounts.맛집, candidates.맛집.length),
        쇼핑: Math.min(courseCounts.쇼핑, candidates.쇼핑.length),
        숙소: Math.min(courseCounts.숙소, candidates.숙소.length),
      };

      if (courseOriginMode === "manual" && courseRegionKeyword) {
        const labels: Record<Category, string> = { 카페: "카페", 맛집: "맛집", 쇼핑: "쇼핑", 숙소: "숙소" };
        (["카페", "맛집", "쇼핑", "숙소"] as Category[]).forEach((cat) => {
          if (courseCounts[cat] > adjustedCounts[cat]) {
            showToast(`${courseRegionKeyword}에 ${labels[cat]}가 ${adjustedCounts[cat]}개뿐이에요`, "info");
          }
        });
      }

      const selectedPools = {
        카페: shufflePick(candidates.카페, adjustedCounts.카페),
        맛집: shufflePick(candidates.맛집, adjustedCounts.맛집),
        쇼핑: shufflePick(candidates.쇼핑, adjustedCounts.쇼핑),
        숙소: shufflePick(candidates.숙소, adjustedCounts.숙소),
      };
      const mergedCandidates: CoursePlace[] = [
        ...selectedPools.카페,
        ...selectedPools.맛집,
        ...selectedPools.쇼핑,
        ...selectedPools.숙소,
      ];

      const selectedCategorySlots = (["카페", "맛집", "쇼핑", "숙소"] as const).filter((c) => courseCounts[c] > 0).length;
      const enforceNoConsecutiveSameExceptShopping = selectedCategorySlots >= 2;

      // 5. 알고리즘 실행
      const course = buildCourse(
        { lat: originLat, lng: originLng },
        mergedCandidates,
        { enforceNoConsecutiveSameExceptShopping },
      );

      if (course.length === 0) {
        showToast("코스를 만들 수 없어요. 저장된 장소를 더 추가해보세요.", "info");
        return;
      }
      setCourseResult(course);

      // 부족했으면 안내
      const requested = courseCounts.카페 + courseCounts.맛집 + courseCounts.쇼핑 + courseCounts.숙소;
      if (course.length < requested) {
        showToast(`저장된 장소가 부족해서 ${course.length}곳으로 코스를 만들었어요`, "info");
      }
    } catch (e) {
      showToast("코스를 만드는 중 오류가 발생했어요", "error");
    } finally {
      setCourseLoading(false);
    }
  };

  // 코스를 전체화면 지도에 경로로 표시
  const showCourseOnMap = async () => {
    if (!courseResult || courseResult.length === 0) return;
    setShowCourseModal(false);
    setShowCourseRoute(true);
    setMapExpanded(true);
    setActiveTab("map");
    // 지도가 그려진 후에 마커와 폴리라인 그리기 (살짝 딜레이)
    setTimeout(() => drawCourseRoute(), 800);
  };

  // 전체화면 지도에 코스 경로 그리기
  const drawCourseRoute = () => {
    if (!courseResult || !expandedMapRef.current || !window.kakao?.maps) return;
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
        setSelectedPlace({
          place_name: place.name,
          category_name: place.category,
          road_address_name: place.address,
          phone: "",
          place_url: "",
          y: place.lat,
          x: place.lng,
          _feedPosts: feedPosts.filter((p) => !p.archived && p.placeName === place.name),
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
    const trimmedUrl = cleanInstagramUrl(instagramUrl.trim());
    setIsSubmitting(true); setStatus(""); setError("");
    let timeout: number | undefined;
    try {
      const controller = new AbortController();
      timeout = window.setTimeout(() => controller.abort(), 10000);
      const response = await fetch("/api/extract/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ instagramUrl: trimmedUrl, userId: user.id }),
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      const data = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !data.jobId) throw new Error(data.error ?? "분석 작업 시작에 실패했습니다.");
      const newJob: ActiveExtractJob = {
        jobId: data.jobId,
        instagramUrl: trimmedUrl,
        status: "pending",
        progressStep: "대기 중",
      };
      setActiveJobs((prev) => [newJob, ...prev.filter((job) => job.jobId !== newJob.jobId)]);
      setInstagramUrl("");
      setStatus("분석 작업이 시작됐어요. 다른 작업하셔도 돼요!");
      showToast("분석 작업을 백그라운드에서 시작했어요", "success");
    } catch (e) {
      const message = e instanceof Error && e.name === "AbortError"
        ? "요청이 지연되고 있어요. 잠시 후 다시 시도해주세요."
        : e instanceof Error
          ? e.message
          : "요청 처리 중 오류가 발생했습니다.";
      setStatus("");
      setError(message);
    }
    finally {
      if (typeof timeout === "number") window.clearTimeout(timeout);
      setIsSubmitting(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 6 - postImages.length);
    e.target.value = "";

    for (const file of files) {
      try {
        // 파일 이름을 고유하게 만들기 (시간 + 랜덤)
        const ext = file.name.split('.').pop() || 'jpg';
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${ext}`;

        // Supabase Storage에 업로드
        const { error: uploadError } = await supabase.storage
          .from('post-images')
          .upload(fileName, file);

        if (uploadError) {
          console.error("업로드 실패:", uploadError);
          showToast("사진 업로드에 실패했어요", "error");
          continue;
        }

        // 업로드된 사진의 공개 URL 가져오기
        const { data: { publicUrl } } = supabase.storage
          .from('post-images')
          .getPublicUrl(fileName);

        setPostImages(prev => [...prev, publicUrl]);
      } catch (err) {
        console.error("업로드 에러:", err);
        showToast("사진 업로드 중 오류가 발생했어요", "error");
      }
    }
  };
  const handlePostSearch = () => {
    if (!postSearchQuery.trim() || !window.kakao?.maps?.services) return;
    new window.kakao.maps.services.Places().keywordSearch(postSearchQuery.trim(), (data: any[], st: string) => {
      if (st === window.kakao.maps.services.Status.OK) setPostSearchResults(data.slice(0, 5)); else showToast("검색 결과가 없어요", "info");
    });
  };
  const handleSelectPostPlace = (place: any) => {
    setPostPlaceName(place.place_name); setPostAddress(place.road_address_name || place.address_name || "");
    const cat: Category = place.category_name?.includes("카페") ? "카페" : place.category_name?.includes("음식") || place.category_name?.includes("맛집") ? "맛집" : place.category_name?.includes("숙박") || place.category_name?.includes("호텔") ? "숙소" : "쇼핑";
    setPostCategory(cat); setPostSearchResults([]); setPostSearchQuery("");
  };
  const handleSubmitPost = async () => {
    if (!canPost) return;
    const normalizedPlaceName = postPlaceName.trim();
    const normalizedAddress = postAddress.trim();
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
    const newPost: FeedPost = { id: Math.random().toString(36).substring(2) + Date.now().toString(36), user: MY_USERNAME, userId: user?.id || "", title: postTitle, placeName: postPlaceName, address: postAddress, category: postCategory, comment: postComment, images: postImages, createdAt: new Date().toISOString(), likes: [], comments: [] };
    await submitPost(newPost);
    showToast("큐레이션이 등록됐어요 ✨", "success");
    setShowPostModal(false); setPostTitle(""); setPostPlaceName(""); setPostAddress(""); setPostComment(""); setPostCategory("카페"); setPostImages([]); setActiveTab("home");
  };
  const resetModal = () => {
    setShowPostModal(false); setPostTitle(""); setPostPlaceName(""); setPostAddress(""); setPostComment(""); setPostCategory("카페"); setPostImages([]); setPostSearchQuery(""); setPostSearchResults([]);
  };

  const addMyLocation = (map: any) => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      new window.kakao.maps.Marker({ map, position: new window.kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude), image: new window.kakao.maps.MarkerImage(makeMyLocationImage(), new window.kakao.maps.Size(24, 24), { offset: new window.kakao.maps.Point(12, 12) }) });
    });
  };

  // 카카오맵 실제 초기화 함수 (DOM이 준비된 후 호출)
  const initMap = (places: Place[], posts: FeedPost[]) => {
    if (!mapContainerRef.current || mapRef.current) return;
    const mapTypeId = window.kakao.maps.MapTypeId?.NORMAL;
    mapRef.current = new window.kakao.maps.Map(mapContainerRef.current, { center: new window.kakao.maps.LatLng(37.5665, 126.978), level: 12 });
    mapRef.current.setMapTypeId && mapRef.current.setMapTypeId(mapTypeId);
    geocoderRef.current = new window.kakao.maps.services.Geocoder();
    addMyLocation(mapRef.current);
    setCompactMapReady(true);
    setTimeout(() => { addPlacePins(mapRef.current, markersRef.current, posts); }, 300);
  };

  const addPlacePins = (map: any, arr: any[], posts: FeedPost[]) => {
    if (!geocoderRef.current) return;
    arr.forEach((m) => m.setMap(null)); arr.length = 0;
    savedPlaces.forEach((place) => {
      geocoderRef.current.addressSearch(place.address, (result: any[], sv: string) => {
        if (sv !== window.kakao.maps.services.Status.OK || !result[0]) return;
        const marker = new window.kakao.maps.Marker({ map, position: new window.kakao.maps.LatLng(result[0].y, result[0].x), image: new window.kakao.maps.MarkerImage(makeMarkerImage(place.category), new window.kakao.maps.Size(36, 44)) });
        window.kakao.maps.event.addListener(marker, "click", () => {
          const relatedPosts = posts.filter(p => !p.archived && p.placeName === place.name);
          new window.kakao.maps.services.Places().keywordSearch(place.name, (data: any[], st: string) => {
            const base = (st === window.kakao.maps.services.Status.OK && data[0]) ? data[0] : { place_name: place.name, category_name: place.category, road_address_name: place.address, phone: "", place_url: "" };
            setSelectedPlace({ ...base, _feedPosts: relatedPosts });
          });
        });
        arr.push(marker);
      });
    });
  };

  const addFeedPins = (map: any, arr: any[], posts: FeedPost[]) => {
    if (!geocoderRef.current) return;
    arr.forEach((m) => m.setMap(null)); arr.length = 0;
    const byAddress = new Map<string, FeedPost[]>();
    posts.filter(p => !p.archived && p.address).forEach(p => { if (!byAddress.has(p.address)) byAddress.set(p.address, []); byAddress.get(p.address)!.push(p); });
    byAddress.forEach((groupPosts, address) => {
      geocoderRef.current.addressSearch(address, (result: any[], sv: string) => {
        if (sv !== window.kakao.maps.services.Status.OK || !result[0]) return;
        const rep = groupPosts[0];
        const marker = new window.kakao.maps.Marker({ map, position: new window.kakao.maps.LatLng(result[0].y, result[0].x), image: new window.kakao.maps.MarkerImage(makeMarkerImage(rep.category), new window.kakao.maps.Size(36, 44)) });
        window.kakao.maps.event.addListener(marker, "click", () => { setSelectedPlace({ place_name: rep.placeName, category_name: rep.category, road_address_name: rep.address, phone: "", place_url: "", _feedPosts: groupPosts }); });
        arr.push(marker);
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

  const handleSearch = () => {
    if (!searchQuery.trim() || !expandedMapRef.current || !window.kakao?.maps) return;
    const ps = new window.kakao.maps.services.Places(); const geocoder = new window.kakao.maps.services.Geocoder();
    const doSearch = (data: any[], st: string) => {
      if (st !== window.kakao.maps.services.Status.OK) { showToast("검색 결과가 없어요", "info"); return; }
      searchMarkersRef.current.forEach((m) => m.setMap(null)); searchMarkersRef.current = [];
      const bounds = new window.kakao.maps.LatLngBounds();
      data.forEach((place) => {
        const marker = new window.kakao.maps.Marker({ map: expandedMapRef.current, position: new window.kakao.maps.LatLng(place.y, place.x) });
        window.kakao.maps.event.addListener(marker, "click", () => setSelectedPlace({ ...place, _feedPosts: feedPosts.filter(p => !p.archived && p.placeName === place.place_name) }));
        searchMarkersRef.current.push(marker); bounds.extend(new window.kakao.maps.LatLng(place.y, place.x));
      });
      expandedMapRef.current.setBounds(bounds); setSearchQuery("");
    };
    geocoder.addressSearch(searchQuery.trim(), (result: any[], st: string) => {
      if (st === window.kakao.maps.services.Status.OK && result[0]) {
        searchMarkersRef.current.forEach((m) => m.setMap(null)); searchMarkersRef.current = [];
        const marker = new window.kakao.maps.Marker({ map: expandedMapRef.current, position: new window.kakao.maps.LatLng(result[0].y, result[0].x) });
        searchMarkersRef.current.push(marker); expandedMapRef.current.setCenter(new window.kakao.maps.LatLng(result[0].y, result[0].x)); expandedMapRef.current.setLevel(3); setSearchQuery("");
      } else ps.keywordSearch(searchQuery.trim(), doSearch);
    });
  };

  // 카카오 스크립트 최초 로드 (DOM 준비와 무관하게 스크립트만 로드)
  useEffect(() => {
    if (!mapKey) {
      setIsKakaoMapLoaded(false);
      setKakaoStatus("error");
      return;
    }
    const notifySdkReady = () => {
      setIsKakaoMapLoaded(true);
      setKakaoStatus("ready");
    };
    if (window.kakao?.maps) {
      window.kakao.maps.load(() => {
        notifySdkReady();
      });
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
        window.kakao.maps.load(() => {
          notifySdkReady();
        });
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
    const failTimer = window.setTimeout(() => {
      if (!window.kakao?.maps) {
        setIsKakaoMapLoaded(false);
        setKakaoStatus("error");
      }
    }, 25000);
    script.onload = () => {
      window.clearTimeout(failTimer);
      script.setAttribute("data-loaded", "1");
      if (!window.kakao?.maps) {
        setIsKakaoMapLoaded(false);
        setKakaoStatus("error");
        return;
      }
      window.kakao.maps.load(() => {
        notifySdkReady();
      });
    };
    script.onerror = () => {
      window.clearTimeout(failTimer);
      setIsKakaoMapLoaded(false);
      setKakaoStatus("error");
    };
    document.head.appendChild(script);
    return () => {
      window.clearTimeout(failTimer);
    };
  }, [mapKey]);

  // SDK 준비 + 지도 탭일 때: 컨테이너 높이 0 등으로 initMap 스킵되던 문제를 RAF·재시도로 해소
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
  }, [kakaoStatus, activeTab, savedPlaces, feedPosts]);

  // 탭 전환 시 지도 relayout
  useEffect(() => {
    if (activeTab !== "map" || !mapRef.current) return;
    const relayoutTimers = [100, 300, 600].map((delay) => setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      map.relayout();
      const container = mapContainerRef.current;
      const parent = container?.parentElement;
      if (parent && (parent.clientWidth === 0 || parent.clientHeight === 0)) {
        const center = map.getCenter?.() ?? new window.kakao.maps.LatLng(37.5665, 126.978);
        map.setCenter(center);
      }
    }, delay));
    return () => relayoutTimers.forEach(clearTimeout);
  }, [activeTab]);

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
          const { data: friendData } = await supabase.from("users").select("username").eq("id", friendId).maybeSingle();
          targetRoom = {
            id: data.id,
            friendId,
            friendName: friendData?.username ?? friendId,
            lastMessage: "",
            lastTime: data.created_at,
            unreadCount: 0,
          };
          // chatRooms에도 추가해두기
          setChatRooms(prev => prev.some(r => r.id === targetRoom!.id) ? prev : [targetRoom!, ...prev]);
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

  // 메시지 탭 진입 시 안 읽은 개수 갱신
  useEffect(() => {
    if (activeTab !== "messages" || activeChatRoom) return;
    const refreshRooms = async () => {
      const { data: roomsData } = await supabase.from("chat_rooms").select("*").or(`user1_id.eq.${MY_USER},user2_id.eq.${MY_USER}`);
      if (!roomsData) return;
      const rooms: ChatRoom[] = await Promise.all(roomsData.map(async (r: any) => {
        const friendId = r.user1_id === MY_USER ? r.user2_id : r.user1_id;
        const { data: friendData } = await supabase.from("users").select("username").eq("id", friendId).maybeSingle();
        const { data: msgs } = await supabase.from("messages").select("*").eq("room_id", r.id).order("created_at", { ascending: false }).limit(1);
        const { count: unread } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("room_id", r.id).neq("sender_id", MY_USER).eq("read", false);
        return { id: r.id, friendId, friendName: friendData?.username || friendId, lastMessage: msgs?.[0]?.text ?? "", lastTime: msgs?.[0]?.created_at ?? r.created_at, unreadCount: unread ?? 0 };
      }));
      setChatRooms(rooms);
    };
    refreshRooms();
  }, [activeTab, activeChatRoom]);

  // 전역 메시지 구독 - 어느 탭에 있든 새 메시지 오면 알림 갱신
  useEffect(() => {
    const channel = supabase.channel(`global-messages-${MY_USER}`).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload: any) => {
        const m = payload.new;
        // 본인이 보낸 메시지면 무시
        if (m.sender_id === MY_USER) return;
        // 내가 속한 채팅방이 아니면 무시
        setChatRooms(prev => {
          const room = prev.find(r => r.id === m.room_id);
          if (!room) return prev;
          // 현재 그 채팅방을 보고 있으면 unread 증가시키지 않음
          const isViewing = activeChatRoom?.id === m.room_id;
          return prev.map(r => r.id === m.room_id ? {
            ...r,
            lastMessage: m.text,
            lastTime: m.created_at,
            unreadCount: isViewing ? 0 : r.unreadCount + 1
          } : r);
        });
      }
    ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeChatRoom]);

  useEffect(() => { if (kakaoStatus !== "ready" || !mapRef.current) return; addPlacePins(mapRef.current, markersRef.current, feedPosts); }, [savedPlaces, kakaoStatus, feedPosts]);

  useEffect(() => {
    if (!mapExpanded || !mapExpandedRef.current || !window.kakao?.maps) return;
    setTimeout(() => {
      if (!mapExpandedRef.current) return;
      expandedMapRef.current = new window.kakao.maps.Map(mapExpandedRef.current, { center: mapRef.current?.getCenter() ?? new window.kakao.maps.LatLng(37.5665, 126.978), level: mapRef.current?.getLevel() ?? 12 });
      addMyLocation(expandedMapRef.current);
      addPlacePins(expandedMapRef.current, expandedMarkersRef.current, feedPosts);
      addFeedPins(expandedMapRef.current, feedMarkersRef.current, feedPosts);
    }, 100);
  }, [mapExpanded]);

  useEffect(() => {
    if (!mapExpanded || !expandedMapRef.current || !geocoderRef.current) return;
    addPlacePins(expandedMapRef.current, expandedMarkersRef.current, feedPosts);
    addFeedPins(expandedMapRef.current, feedMarkersRef.current, feedPosts);
  }, [feedPosts, mapExpanded, savedPlaces]);

  useEffect(() => { if (!openMenuId) return; const handler = () => setOpenMenuId(null); document.addEventListener("click", handler); return () => document.removeEventListener("click", handler); }, [openMenuId]);

  useEffect(() => {
    if (detailPostId && scrollToComment) {
      setTimeout(() => {
        commentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        commentInputRef.current?.focus();
        setScrollToComment(false);
      }, 200);
    }
  }, [detailPostId, scrollToComment]);

  const visibleFeedPosts = feedPosts.filter(p => !p.archived);

  const renderPlaceCard = () => {
    if (!selectedPlace) return null;
    const relatedPosts: FeedPost[] = selectedPlace._feedPosts ?? [];
    return (
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "0.5px solid #efefef", borderRadius: "16px 16px 0 0", boxShadow: "0 -4px 20px rgba(0,0,0,0.08)", zIndex: 10, maxHeight: "60vh", overflowY: "auto" }}>
        <div style={{ padding: "20px 24px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "0.5px solid #f0f0f0" }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a1a2e", fontWeight: 400 }}>{selectedPlace.place_name}</p>
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#888" }}>{selectedPlace.category_name}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {(() => {
              const searchAddr = (selectedPlace.road_address_name || selectedPlace.address_name || "").trim();
              const saved = savedPlaces.find((p) => {
                if (p.name.trim() !== selectedPlace.place_name.trim()) return false;
                if (!searchAddr) return true;
                return p.address.trim() === searchAddr;
              });
              const heartFill = saved ? "#e53935" : "none";
              const heartStroke = saved ? "#e53935" : "#1a2a7a";
              return (
                <button onClick={async () => {
                  if (saved) {
                    await deletePlace(saved.id);
                    showToast("저장이 취소되었어요", "info");
                  } else {
                    const category: Category = selectedPlace.category_name?.includes("카페") ? "카페" : selectedPlace.category_name?.includes("음식") || selectedPlace.category_name?.includes("맛집") ? "맛집" : selectedPlace.category_name?.includes("숙박") || selectedPlace.category_name?.includes("호텔") ? "숙소" : "쇼핑";
                    await addPlace({ id: Math.random().toString(36).substring(2) + Date.now().toString(36), name: selectedPlace.place_name, address: selectedPlace.road_address_name || selectedPlace.address_name || "", category });
                  }
                }} type="button" style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill={heartFill}>
                    <path d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z" stroke={heartStroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              );
            })()}
            <button onClick={() => setSelectedPlace(null)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#bbb", fontSize: "20px", padding: 0, lineHeight: 1 }}>×</button>
          </div>
        </div>
        <div style={{ padding: "12px 24px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {selectedPlace.road_address_name && (<div style={{ display: "flex", gap: "8px" }}><span style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", textTransform: "uppercase", flexShrink: 0, marginTop: "1px" }}>주소</span><span style={{ fontSize: "13px", color: "#444" }}>{selectedPlace.road_address_name}</span></div>)}
          {selectedPlace.phone && (<div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", textTransform: "uppercase", flexShrink: 0 }}>전화</span><a href={"tel:" + String(selectedPlace.phone)} style={{ fontSize: "13px", color: "#1a2a7a", textDecoration: "none" }}>{String(selectedPlace.phone)}</a></div>)}
          {selectedPlace.place_url && (<a href={String(selectedPlace.place_url)} target="_blank" rel="noreferrer" style={{ fontSize: "12px", color: "#fff", background: "#1a2a7a", padding: "8px 16px", letterSpacing: "1px", textDecoration: "none", display: "inline-block", marginTop: "4px" }}>카카오맵에서 영업시간 보기</a>)}
          {selectedPlace.y && selectedPlace.x && (
            <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {/* 모드 토글 */}
              <div style={{ display: "flex", gap: "6px" }}>
                {([
                  { id: "car", label: "🚗 자동차" },
                  { id: "walk", label: "🚶 도보" },
                  { id: "transit", label: "🚌 대중교통" },
                ] as const).map(m => {
                  const isActive = m.id !== "transit" && directionsMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        if (m.id === "transit") {
                          openTransitInKakaoMap(selectedPlace.place_name, parseFloat(selectedPlace.y), parseFloat(selectedPlace.x));
                        } else {
                          setDirectionsMode(m.id);
                          drawRoute(parseFloat(selectedPlace.y), parseFloat(selectedPlace.x), m.id);
                        }
                      }}
                      disabled={directionsLoading}
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: `1px solid ${isActive ? "#1a2a7a" : "#ddd"}`,
                        background: isActive ? "#1a2a7a" : "#fff",
                        color: isActive ? "#fff" : "#555",
                        fontSize: "12px",
                        cursor: directionsLoading ? "wait" : "pointer",
                        fontFamily: "inherit",
                        opacity: directionsLoading ? 0.6 : 1
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              {directionsLoading && <p style={{ fontSize: "12px", color: "#888", textAlign: "center", margin: 0 }}>경로 계산 중...</p>}
              {directionsInfo && !directionsLoading && (
                <div style={{ background: "#f0f4ff", borderRadius: "8px", padding: "10px 14px", display: "flex", gap: "16px", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", color: "#1a2a7a", fontWeight: 600 }}>🕐 {directionsInfo.duration}분</span>
                  <span style={{ fontSize: "13px", color: "#1a2a7a", fontWeight: 600 }}>📍 {directionsInfo.distance}km</span>
                  <button onClick={clearRoute} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#aaa", fontSize: "12px", cursor: "pointer" }}>경로 지우기</button>
                </div>
              )}
            </div>
          )}
        </div>
        {relatedPosts.length > 0 && (
          <div style={{ borderTop: "0.5px solid #f0f0f0" }}>
            <p style={{ margin: 0, padding: "12px 24px 8px", fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px" }}>큐레이션 {relatedPosts.length}</p>
            {relatedPosts.map((post) => (
              <div key={post.id} onClick={() => { setDetailPostId(post.id); setSelectedPlace(null); setMapExpanded(false); }} style={{ padding: "12px 24px", borderTop: "0.5px solid #f8f8f8", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "#1a2a7a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", flexShrink: 0 }}>{post.user.slice(0, 1).toUpperCase()}</div>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#1a1a2e" }}>{post.user}</span>
                  <span style={{ fontSize: "10px", color: "#bbb", marginLeft: "auto" }}>{timeAgo(post.createdAt)}</span>
                </div>
                <p style={{ margin: "0 0 8px", fontFamily: "'Playfair Display', serif", fontSize: "14px", color: "#1a2a7a" }}>{post.title || post.placeName}</p>
                {post.images.length > 0 && (
                  <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: "6px", marginBottom: "8px", overflowX: "auto" }}>
                    {post.images.map((img, i) => <img key={i} src={img} onClick={() => setLightboxImg(img)} style={{ width: "80px", height: "80px", objectFit: "cover", borderRadius: "8px", flexShrink: 0, cursor: "pointer" }} />)}
                  </div>
                )}
                <p style={{ margin: "0 0 6px", fontSize: "12px", color: "#555", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>{post.comment}</p>
                <div style={{ display: "flex", gap: "12px" }}>
                  <span style={{ fontSize: "11px", color: post.likes.includes(MY_USERNAME) ? "#e05555" : "#ccc" }}>♥ {post.likes.length}</span>
                  <span style={{ fontSize: "11px", color: "#ccc" }}>💬 {post.comments.length}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {relatedPosts.length === 0 && (<div style={{ padding: "14px 24px 20px", textAlign: "center" }}><p style={{ margin: 0, fontSize: "12px", color: "#ccc" }}>아직 큐레이션이 없어요</p></div>)}
      </div>
    );
  };
  if (userLoading) {
    return (
      <main className="mobileRoot">
        <section className="phoneFrame" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#fafafa" }}>
          <header className="appHeader" style={{ opacity: 0.85 }}>
            <h1 className="appTitle" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="skeleton" style={{ width: 22, height: 22, borderRadius: 6, display: "inline-block" }} />
              <span className="skeleton" style={{ width: 88, height: 18, borderRadius: 4, display: "inline-block" }} />
            </h1>
          </header>
          <section className="appContent" style={{ flex: 1, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="skeleton" style={{ width: "40%", height: 14, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: "100%", height: 220, borderRadius: 12 }} />
            <div className="skeleton" style={{ width: "100%", height: 44, borderRadius: 8 }} />
            <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#aaa", textAlign: "center" }}>불러오는 중...</p>
          </section>
        </section>
      </main>
    );
  }

  if (!user) {
    return null;
  }

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
            <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#1a2a7a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", flexShrink: 0 }}>
              {room.friendName.slice(0, 1).toUpperCase()}
            </div>
            <span style={{ fontSize: "13px", color: "#1a1a2e", flex: 1 }}>{room.friendName}</span>
            <span style={{ fontSize: "11px", color: "#1a2a7a", fontWeight: 500 }}>보내기 →</span>
          </button>
        ))}
      </div>
    </div>
  );

  if (detailPost) {
    const liked = detailPost.likes.includes(MY_USERNAME);
    return (
      <>
      <main className="mobileRoot">
        <section className="phoneFrame">
          <header style={{ height: "56px", display: "flex", alignItems: "center", padding: "0 20px", borderBottom: "0.5px solid #efefef", background: "#fff", gap: "12px", flexShrink: 0 }}>
            <button onClick={() => setDetailPostId(null)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#1a2a7a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detailPost.title || detailPost.placeName}</span>
          </header>
          <div style={{ flex: 1, overflowY: "auto", background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", padding: "16px 20px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                <div className="avatar">{detailPost.user.slice(0, 1).toUpperCase()}</div>
                <div><p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#1a1a2e" }}>{detailPost.user}</p><p style={{ margin: 0, fontSize: "11px", color: "#aaa" }}>{timeAgo(detailPost.createdAt)}</p></div>
              </div>
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
            <div style={{ padding: "14px 20px 0" }}><p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "22px", color: "#1a2a7a", lineHeight: 1.3 }}>{detailPost.title || detailPost.placeName}</p></div>
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
            {detailPost.images.length > 0 && (
              <div style={{ display: "flex", gap: "6px", margin: "14px 20px 0", overflowX: "auto", paddingBottom: "4px" }}>
                {detailPost.images.map((img, i) => <img key={i} src={img} onClick={() => setLightboxImg(img)} style={{ width: "200px", height: "200px", objectFit: "cover", borderRadius: "10px", flexShrink: 0, cursor: "pointer" }} />)}
              </div>
            )}
            <div style={{ padding: "16px 20px 0" }}><p style={{ margin: 0, fontSize: "14px", color: "#333", lineHeight: 1.9 }}>{detailPost.comment}</p></div>
            <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", gap: "14px", borderTop: "0.5px solid #f0f0f0", marginTop: "16px" }}>
              <button type="button" onClick={(e) => { e.stopPropagation(); void toggleLike(detailPost.id); }} style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", padding: 0 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill={liked ? "#e05555" : "none"}><path d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z" stroke={liked ? "#e05555" : "#aaa"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span style={{ fontSize: "13px", color: liked ? "#e05555" : "#aaa" }}>{detailPost.likes.length}</span>
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
                    onClick={() => router.push(`/profile/${encodeURIComponent(c.user)}`)}
                    style={{ width: "30px", height: "30px", borderRadius: "50%", background: "#1a2a7a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", flexShrink: 0, border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {c.user.slice(0, 1).toUpperCase()}
                  </button>
                  <div style={{ flex: 1, background: "#f8f8fc", borderRadius: "10px", padding: "8px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <button
                        type="button"
                        onClick={() => router.push(`/profile/${encodeURIComponent(c.user)}`)}
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
            <div ref={commentSectionRef} style={{ padding: "14px 20px 30px", display: "flex", gap: "8px" }}>
              <input ref={commentInputRef} className="mapInput" placeholder="댓글을 입력하세요..." value={newComment} onChange={(e) => setNewComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { addComment(detailPost.id); } }} style={{ flex: 1 }} />
              <button className="primaryButton" type="button" disabled={!newComment.trim()} onClick={() => addComment(detailPost.id)} style={{ padding: "0 16px", opacity: newComment.trim() ? 1 : 0.4 }}>등록</button>
            </div>
          </div>
          {lightboxImg && <div onClick={() => setLightboxImg(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999999, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center" }}><img src={lightboxImg} style={{ maxWidth: "95%", maxHeight: "90vh", objectFit: "contain", borderRadius: "4px" }} /></div>}
          {sharePostModalEl}
        </section>
      </main>
      </>
    );
  }

  return (
    <>
    <main className="mobileRoot">
      <section className="phoneFrame">
        <header className="appHeader">
        <h1 className="appTitle" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
  <svg width="22" height="22" viewBox="0 0 32 32" style={{ flexShrink: 0 }}>
    <rect width="32" height="32" rx="6" fill="#1a2a7a"/>
    <path d="M16 6C12 6 9 9 9 13C9 18 16 25 16 25S23 18 23 13C23 9 20 6 16 6Z" fill="white"/>
    <circle cx="16" cy="13" r="3" fill="#1a2a7a"/>
  </svg>
  PindMap
</h1>
          {activeTab === "home" && <button className="headerAction" type="button" onClick={() => setShowPostModal(true)}><span>＋</span></button>}
        </header>
        <section className="appContent">
          {lightboxImg && <div onClick={() => setLightboxImg(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999999, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center" }}><img src={lightboxImg} style={{ maxWidth: "95%", maxHeight: "90vh", objectFit: "contain", borderRadius: "4px" }} /></div>}

          {editingPost && (
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end" }}>
              <div style={{ background: "#fff", width: "100%", borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", display: "flex", flexDirection: "column", gap: "16px", boxSizing: "border-box" }}>
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

{showCourseModal && (
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end" }}>
              <div style={{ background: "#fff", width: "100%", borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", display: "flex", flexDirection: "column", gap: "16px", maxHeight: "90vh", overflowY: "auto", boxSizing: "border-box" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>
                    {courseResult ? "✨ 추천 코스" : "🗺️ 코스 만들기"}
                  </span>
                  <button onClick={() => { setShowCourseModal(false); setCourseResult(null); }} style={{ border: "none", background: "transparent", fontSize: "20px", color: "#bbb", cursor: "pointer" }}>×</button>
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
                              ? `📍 현재 위치 반경 5km 이내 장소(${courseBasePlaces.length}곳)로 코스를 짤게요`
                              : "📍 위치 권한을 허용하면 반경 5km 이내 장소로 코스를 짤 수 있어요"}
                        </p>
                      )}
                    </div>

                    <div>
                      <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: "10px", marginTop: 0 }}>몇 곳을 방문할까요?</p>
                      {(["카페", "맛집", "쇼핑", "숙소"] as Category[]).map((cat) => {
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

                    <div style={{ display: "flex", gap: "8px" }}>
                      <button type="button" onClick={() => { void generateCourse(); }} disabled={courseLoading} style={{ flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid #ddd", background: "#fff", color: "#666", fontSize: "13px", cursor: courseLoading ? "wait" : "pointer", fontFamily: "inherit", opacity: courseLoading ? 0.6 : 1 }}>{courseLoading ? "다시 짜는 중..." : "다시 만들기"}</button>
                      <button type="button" onClick={showCourseOnMap} style={{ flex: 1, padding: "12px", borderRadius: "8px", border: "none", background: "#1a2a7a", color: "#fff", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>🗺️ 지도에서 경로 보기</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {showPostModal && (
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end" }}>
              <div style={{ background: "#fff", width: "100%", borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", display: "flex", flexDirection: "column", gap: "16px", maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>새 큐레이션</span>
                  <button onClick={resetModal} style={{ border: "none", background: "transparent", fontSize: "20px", color: "#bbb", cursor: "pointer" }}>×</button>
                </div>
                <div><p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: "6px", marginTop: 0 }}>제목</p><input className="mapInput" placeholder="한 줄로 표현해보세요" value={postTitle} onChange={(e) => setPostTitle(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} /></div>
                <div>
                  <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: "6px", marginTop: 0 }}>장소 검색</p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input className="mapInput" placeholder="장소명 검색" value={postSearchQuery} onChange={(e) => setPostSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePostSearch()} style={{ flex: 1 }} />
                    <button className="primaryButton" onClick={handlePostSearch} type="button" style={{ padding: "0 14px", flexShrink: 0 }}>검색</button>
                  </div>
                  {postSearchResults.length > 0 && (<div style={{ border: "0.5px solid #eee", borderRadius: "4px", marginTop: "6px", overflow: "hidden" }}>{postSearchResults.map((r) => (<button key={r.id} type="button" onClick={() => handleSelectPostPlace(r)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", background: "transparent", border: "none", borderBottom: "0.5px solid #f5f5f5", cursor: "pointer" }}><p style={{ margin: 0, fontSize: "13px", color: "#1a1a2e" }}>{r.place_name}</p><p style={{ margin: "2px 0 0", fontSize: "11px", color: "#999" }}>{r.road_address_name || r.address_name}</p></button>))}</div>)}
                  {postPlaceName ? (
                    <div style={{ marginTop: "8px", padding: "10px 12px", background: "#f0f4ff", borderRadius: "4px", display: "flex", alignItems: "center", gap: "8px", border: "1px solid #d0daff" }}>
                      <span style={{ fontSize: "16px" }}>{CATEGORY_PIN[postCategory].emoji}</span>
                      <div style={{ flex: 1 }}><p style={{ margin: 0, fontSize: "13px", color: "#1a2a7a", fontWeight: 500 }}>{postPlaceName}</p><p style={{ margin: "2px 0 0", fontSize: "11px", color: "#999" }}>{postAddress}</p></div>
                      <button onClick={() => { setPostPlaceName(""); setPostAddress(""); }} style={{ border: "none", background: "transparent", color: "#bbb", cursor: "pointer", fontSize: "14px" }}>×</button>
                    </div>
                  ) : <p style={{ fontSize: "11px", color: "#bbb", marginTop: "6px" }}>장소를 검색하고 선택해주세요</p>}
                </div>
                <div><p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: "8px", marginTop: 0 }}>카테고리</p><div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>{(["맛집", "카페", "쇼핑", "숙소"] as Category[]).map((cat) => (<button key={cat} type="button" onClick={() => setPostCategory(cat)} style={{ padding: "6px 14px", borderRadius: "20px", border: `1px solid ${postCategory === cat ? CATEGORY_COLORS[cat] : "#eee"}`, background: postCategory === cat ? CATEGORY_COLORS[cat] : "transparent", color: postCategory === cat ? "#fff" : "#888", fontSize: "12px", cursor: "pointer" }}>{CATEGORY_PIN[cat].emoji} {cat}</button>))}</div></div>
                <div><p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: "8px", marginTop: 0 }}>사진 추가 (최대 6장)</p>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {postImages.map((img, i) => (<div key={i} style={{ position: "relative", width: "72px", height: "72px" }}><img src={img} style={{ width: "72px", height: "72px", objectFit: "cover", borderRadius: "6px" }} /><button onClick={() => setPostImages(prev => prev.filter((_, idx) => idx !== i))} style={{ position: "absolute", top: "-6px", right: "-6px", width: "18px", height: "18px", borderRadius: "50%", background: "#333", border: "none", color: "#fff", fontSize: "11px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button></div>))}
                    {postImages.length < 6 && (<button type="button" onClick={() => imageInputRef.current?.click()} style={{ width: "72px", height: "72px", border: "1px dashed #ccc", borderRadius: "6px", background: "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", color: "#bbb" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#bbb" strokeWidth="2" strokeLinecap="round"/></svg><span style={{ fontSize: "10px" }}>사진 추가</span></button>)}
                  </div>
                  <input ref={imageInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleImageUpload} />
                </div>
                <div><p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: "6px", marginTop: 0 }}>코멘트</p><textarea placeholder="이 장소에 대한 느낌을 자유롭게 적어주세요 ✍️" value={postComment} onChange={(e) => setPostComment(e.target.value)} rows={4} style={{ width: "100%", border: "0.5px solid #ddd", borderRadius: "4px", padding: "10px 12px", fontSize: "13px", fontFamily: "inherit", resize: "none", outline: "none", boxSizing: "border-box", color: "#333" }} /></div>
                {!canPost && <p style={{ fontSize: "11px", color: "#e07070", margin: 0, textAlign: "center" }}>{!postTitle ? "제목을 입력해주세요" : !postPlaceName ? "장소를 검색하고 선택해주세요" : postImages.length === 0 ? "사진을 최소 1장 추가해주세요" : "코멘트를 입력해주세요"}</p>}
                <button className="primaryButton" type="button" disabled={!canPost} onClick={handleSubmitPost} style={{ width: "100%", padding: "14px", fontSize: "14px", letterSpacing: "1px", opacity: canPost ? 1 : 0.4 }}>올리기</button>
              </div>
            </div>
          )}

          {activeTab === "home" && (
            <div className="screen">
              <p className="screenTitle">홈 피드</p>
              {loading && <FeedSkeleton />}
              {!loading && visibleFeedPosts.length === 0 && (
  <EmptyState
    icon="✍️"
    title="아직 큐레이션이 없어요"
    description="오른쪽 위 + 버튼을 눌러 첫 번째 장소를 추가해보세요"
    action={{ label: "큐레이션 작성하기", onClick: () => setShowPostModal(true) }}
  />
)}
              {visibleFeedPosts.map((post) => (
                <article key={post.id} className="feedCard" style={{ position: "relative", cursor: "pointer", overflow: "hidden" }} onClick={() => setDetailPostId(post.id)}>
                  <div className="feedTop">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); router.push(`/profile/${encodeURIComponent(post.user)}`); }}
                      style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", minWidth: 0 }}
                    >
                      <div className="avatar">{post.user.slice(0, 1).toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}><p className="feedUser">{post.user}</p><p className="feedMeta">{timeAgo(post.createdAt)}</p></div>
                    </button>
                    {post.user !== MY_USERNAME && post.userId && !followingIds.includes(post.userId) && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); followUser(post.user); }}
                        style={{ border: "none", background: "#1a2a7a", color: "#fff", borderRadius: "16px", padding: "4px 12px", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginRight: "4px" }}
                      >+ 팔로우</button>
                    )}
                    {post.user !== MY_USERNAME && post.userId && followingIds.includes(post.userId) && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); unfollowUser(post.user); }}
                        style={{ border: "1px solid #d0d4e0", background: "#fff", color: "#76809a", borderRadius: "16px", padding: "4px 12px", fontSize: "11px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", marginRight: "4px" }}
                      >팔로잉</button>
                    )}
                    {post.user === MY_USERNAME && (
                      <div style={{ position: "relative" }}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === post.id ? null : post.id); }} style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px 6px", display: "flex", flexDirection: "column", gap: "3px", alignItems: "center" }}>
                          <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#bbb", display: "block" }} /><span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#bbb", display: "block" }} /><span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#bbb", display: "block" }} />
                        </button>
                        {openMenuId === post.id && (
                          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "28px", right: 0, background: "#fff", border: "0.5px solid #eee", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.1)", zIndex: 100, minWidth: "120px", overflow: "hidden" }}>
                            <button type="button" onClick={() => openEdit(post)} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 16px", border: "none", background: "transparent", fontSize: "13px", color: "#333", cursor: "pointer", borderBottom: "0.5px solid #f5f5f5" }}>✏️ 수정</button>
                            <button type="button" onClick={() => toggleArchive(post.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 16px", border: "none", background: "transparent", fontSize: "13px", color: "#333", cursor: "pointer", borderBottom: "0.5px solid #f5f5f5" }}>📦 보관</button>
                            <button type="button" onClick={() => deletePost(post.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 16px", border: "none", background: "transparent", fontSize: "13px", color: "#e07070", cursor: "pointer" }}>🗑️ 삭제</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p style={{ margin: "10px 0 6px", fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#1a2a7a", fontWeight: 400, lineHeight: 1.3 }}>{post.title || post.placeName}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
                    <span style={{ fontSize: "13px" }}>{CATEGORY_PIN[post.category].emoji}</span>
                    <span style={{ fontSize: "12px", color: "#888" }}>{post.placeName}</span>
                    <span style={{ fontSize: "10px", color: "#fff", background: CATEGORY_COLORS[post.category], padding: "2px 7px", borderRadius: "10px" }}>{post.category}</span>
                  </div>
                  {post.images.length > 0 && (<div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: "6px", marginBottom: "10px", overflowX: "auto" }}>{post.images.map((img, i) => <img key={i} src={img} onClick={() => setLightboxImg(img)} style={{ width: "72px", height: "72px", objectFit: "cover", borderRadius: "6px", flexShrink: 0, cursor: "pointer" }} />)}</div>)}
                  <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    <button onClick={() => toggleLike(post.id)} style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", padding: 0 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill={post.likes.includes(MY_USERNAME) ? "#e05555" : "none"}><path d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z" stroke={post.likes.includes(MY_USERNAME) ? "#e05555" : "#ccc"} strokeWidth="1.5"/></svg>
                      <span style={{ fontSize: "12px", color: post.likes.includes(MY_USERNAME) ? "#e05555" : "#ccc" }}>{post.likes.length}</span>
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer" }} onClick={() => { setDetailPostId(post.id); setScrollToComment(true); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      <span style={{ fontSize: "12px", color: "#ccc" }}>{post.comments.length}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void openShareModal(post); }}
                      style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", padding: 0 }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M12 4v12m0-12l-4 4m4-4l4 4M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span style={{ fontSize: "11px", color: "#ccc" }}>공유</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {activeTab === "messages" && (
  <div className="screen" style={activeChatRoom ? { display: "flex", flexDirection: "column", height: "100%", padding: 0 } : undefined}>
    {activeChatRoom ? (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px 14px", borderBottom: "0.5px solid #f0f0f0", flexShrink: 0 }}>
          <button onClick={() => setActiveChatRoom(null)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0 }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#1a2a7a" }}>{activeChatRoom.friendName}</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", padding: "12px 20px" }}>
          {messages.map(m => {
            const isMine = m.senderId === MY_USER;
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start", alignItems: "flex-end", gap: "4px" }}>
                {isMine && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: "10px", color: "#bbb", lineHeight: 1.3 }}>
                    {!m.read && <span style={{ color: "#1a2a7a", fontWeight: 600 }}>1</span>}
                    <span>{formatTime(m.createdAt)}</span>
                  </div>
                )}
                <div style={{ maxWidth: "70%", padding: "8px 12px", borderRadius: isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: isMine ? "#1a2a7a" : "#f0f0f5", color: isMine ? "#fff" : "#333", fontSize: "13px", lineHeight: 1.5, whiteSpace: "pre-wrap" as any }}>
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
                    return m.text;
                  })()}
                </div>
                {!isMine && (
                  <span style={{ fontSize: "10px", color: "#bbb", lineHeight: 1.3 }}>{formatTime(m.createdAt)}</span>
                )}
              </div>
            );
          })}
          {messages.length === 0 && <p style={{ textAlign: "center", color: "#bbb", fontSize: "12px", marginTop: "40px" }}>첫 메시지를 보내보세요 💬</p>}
        </div>
        <div style={{ flexShrink: 0, padding: "10px 16px", background: "#fff", borderTop: "0.5px solid #efefef", display: "flex", gap: "8px" }}>
          <input className="mapInput" placeholder="메시지 입력..." value={newMessage} onChange={e => setNewMessage(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { sendMessage(); } }} style={{ flex: 1, minWidth: 0 }} />
          <button className="primaryButton" onClick={sendMessage} disabled={!newMessage.trim()} style={{ padding: "0 16px", flexShrink: 0, opacity: newMessage.trim() ? 1 : 0.4 }}>전송</button>
        </div>
      </>
    ) : (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <p className="screenTitle" style={{ margin: 0 }}>메시지</p>
          <button onClick={() => setShowAddFriend(true)} style={{ border: "none", background: "#1a2a7a", color: "#fff", borderRadius: "20px", padding: "6px 14px", fontSize: "12px", cursor: "pointer" }}>+ 팔로우</button>
        </div>
        {showAddFriend && (
          <div style={{ background: "#fff", borderRadius: "14px", padding: "16px", marginBottom: "16px", boxShadow: "0 6px 20px rgba(20, 30, 80, 0.06)", border: "0.5px solid #eef0f6" }}>
            <p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#1a2a7a" }}>새 친구 찾기</p>
            <p style={{ margin: "6px 0 12px", fontSize: "11px", color: "#8a90a6", lineHeight: 1.5 }}>유저명을 정확히 입력해 주세요</p>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input placeholder="🔍 유저명으로 검색" value={friendSearch} onChange={e => setFriendSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && searchFriend()} style={{ flex: 1, height: "36px", border: "0.5px solid #dde2f0", borderRadius: "999px", padding: "0 12px", fontSize: "12px", color: "#333", outline: "none", fontFamily: "inherit", background: "#fbfcff" }} />
              <button onClick={searchFriend} type="button" style={{ height: "36px", border: "none", background: "#1a2a7a", color: "#fff", borderRadius: "999px", padding: "0 14px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.3px" }}>검색</button>
            </div>
            {friendSearchError && <p style={{ color: "#e07070", fontSize: "11px", marginTop: "6px" }}>{friendSearchError}</p>}
            {friendSearchResult && (
              <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", padding: "12px", background: "#f7f9ff", borderRadius: "10px", border: "0.5px solid #e1e7f7" }}>
                <div style={{ width: "34px", height: "34px", borderRadius: "50%", background: "#1a2a7a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", flexShrink: 0 }}>{friendSearchResult.username.slice(0,1).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: "13px", color: "#1a1a2e", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{friendSearchResult.username}</p>
                  <p style={{ margin: "3px 0 0", fontSize: "10px", color: "#9ca3b6" }}>검색 결과</p>
                </div>
                <button onClick={addFriend} type="button" style={{ border: "none", background: "#1a2a7a", color: "#fff", borderRadius: "16px", padding: "7px 12px", fontSize: "11px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>팔로우</button>
              </div>
            )}
            <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => { setShowAddFriend(false); setFriendSearch(""); setFriendSearchResult(null); setFriendSearchError(""); }} style={{ border: "0.5px solid #d9deec", background: "#fff", color: "#76809a", borderRadius: "999px", fontSize: "11px", cursor: "pointer", padding: "6px 12px", fontFamily: "inherit" }}>닫기</button>
            </div>
          </div>
        )}
        {chatRooms.length === 0 && !showAddFriend && (
  <EmptyState
    icon="💌"
    title="아직 메시지가 없어요"
    description="친구를 추가해 첫 대화를 시작해보세요"
    action={{ label: "친구 추가하기", onClick: () => setShowAddFriend(true) }}
  />
)}
        {chatRooms.map(room => (
          <article key={room.id} className="chatItem" onClick={() => openChat(room)} style={{ cursor: "pointer" }}>
            <div className="avatar">{room.friendName.slice(0,1).toUpperCase()}</div>
            <div className="chatBody"><p className="chatName">{room.friendName}</p><p className="chatPreview">{room.lastMessage || "대화를 시작해보세요"}</p></div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
              <span className="chatTime">{room.lastTime ? timeAgo(room.lastTime) : ""}</span>
              {room.unreadCount > 0 && (
                <span style={{ background: "#e05555", color: "#fff", borderRadius: "10px", minWidth: "18px", height: "18px", padding: "0 6px", fontSize: "10px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
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

          <div className="screen" style={{ display: activeTab === "map" ? "flex" : "none", flexDirection: "column" }}>
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
              {mapExpanded && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, background: "#fff", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "0.5px solid #efefef", display: "flex", justifyContent: "center", alignItems: "center", background: "#fff", position: "relative" }}>
                    <button onClick={() => { setMapExpanded(false); setSelectedPlace(null); }} style={{ position: "absolute", left: "20px", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>PindMap</span>
                  </div>
                  <div style={{ padding: "10px 20px", borderBottom: "0.5px solid #efefef", display: "flex", gap: "8px", background: "#fff" }}>
                    <input className="mapInput" placeholder="장소명으로 검색" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} style={{ flex: 1 }} />
                    <button className="primaryButton" onClick={handleSearch} type="button" disabled={!searchQuery.trim()} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "0 16px" }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="white" strokeWidth="1.3"/><line x1="9.5" y1="9.5" x2="13" y2="13" stroke="white" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  <div style={{ flex: 1, position: "relative" }}>
                    <div ref={mapExpandedRef} style={{ width: "100%", height: "100%" }} />
                    {selectedPlace && renderPlaceCard()}
                  </div>
                </div>
              )}
              <div className="miniList">
                {savedPlaces.filter(p => !hiddenIds.has(p.id)).map((place) => (
                  <article key={place.id} className="miniItem" onClick={() => handleMiniListClick(place)} style={{ cursor: "pointer" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: CATEGORY_COLORS[place.category], flexShrink: 0, display: "inline-block" }} />
                    <div style={{ flex: 1 }}><p className="miniName">{place.name}</p><p className="miniMeta">{place.address} · {place.category}</p></div>
                    <button onClick={(e) => { e.stopPropagation(); hideFromMap(place.id); }} type="button" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ccc", fontSize: "16px", padding: "0 4px", lineHeight: 1, flexShrink: 0 }}>×</button>
                  </article>
                ))}
                {savedPlaces.filter(p => !hiddenIds.has(p.id)).length === 0 && savedPlaces.length > 0 && (<p className="hintText" style={{ textAlign: "center" }}>모든 장소가 숨겨졌어요.{" "}<button onClick={() => setHiddenIds(new Set())} style={{ border: "none", background: "none", color: "#1a2a7a", cursor: "pointer", fontSize: "12px", textDecoration: "underline" }}>다시 보기</button></p>)}
                {savedPlaces.length === 0 && <p className="emptyText">아직 핀이 없습니다. URL을 입력해 시작해보세요.</p>}
              </div>
          </div>

          {activeTab === "saved" && (
  <div className="screen">
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
    <p className="screenTitle" style={{ margin: 0 }}>저장한 장소</p>
    {savedPlaces.length > 0 && (
      <button
        type="button"
        onClick={() => {
          setShowCourseModal(true);
          setCourseResult(null);
          setCourseCounts({ 카페: 0, 맛집: 0, 쇼핑: 0, 숙소: 0 });
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
      const CATEGORY_ORDER: Category[] = ["맛집", "카페", "쇼핑", "숙소"];
      return sorted.map(([region, regionPlaces]) => (
        <div key={region} style={{ marginBottom: "28px" }}>
          {/* 지역 헤더 */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px", padding: "0 4px", borderBottom: "1px solid #eee", paddingBottom: "10px" }}>
            <span style={{ fontSize: "16px" }}>📍</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#1a2a7a", letterSpacing: "0.5px" }}>{region}</span>
            <span style={{ fontSize: "11px", color: "#bbb", marginLeft: "4px" }}>{regionPlaces.length}</span>
          </div>
          {/* 2차: 지역 안에서 카테고리별 소그룹 */}
          {CATEGORY_ORDER.map(cat => {
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
)}

          {activeTab === "mypage" && (<div className="screen"><p className="screenTitle">마이페이지</p><article className="profileCard"><div className="profileAvatar">{(user?.username || "").slice(0,1).toUpperCase()}</div><div><p className="profileName">{user?.username || ""}</p><p className="profileHandle">@{user?.username || ""}_travelnote</p></div></article><div className="settingList"><button type="button" className="settingItem">프로필 편집</button><button type="button" className="settingItem">알림 설정</button><button type="button" className="settingItem">공개 범위 설정</button><button type="button" className="settingItem" onClick={() => { if (confirm("정말 로그아웃하시겠어요?")) logout(); }}>로그아웃</button></div></div>)}
        </section>
        <nav className="tabBar">
          {TABS.map((tab) => {
            const totalUnread = chatRooms.reduce((sum, r) => sum + (r.unreadCount ?? 0), 0);
            const showBadge = tab.id === "messages" && totalUnread > 0;
            return (
              <button key={tab.id} type="button" className={`tabItem ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                <span className="tabIcon" style={{ position: "relative", display: "inline-block" }}>
                  {tab.icon}
                  {showBadge && (
                    <span style={{ position: "absolute", top: "-4px", right: "-12px", background: "#e05555", color: "#fff", borderRadius: "10px", minWidth: "16px", height: "16px", padding: "0 4px", fontSize: "9px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
                      {totalUnread}
                    </span>
                  )}
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
        {selectedPlace && !mapExpanded && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "0.5px solid #efefef", borderRadius: "16px 16px 0 0", boxShadow: "0 -4px 20px rgba(0,0,0,0.12)", zIndex: 9998, maxHeight: "70vh", overflowY: "auto" }}>
            <div style={{ padding: "20px 24px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "0.5px solid #f0f0f0" }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a1a2e", fontWeight: 400 }}>{selectedPlace.place_name}</p>
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#888" }}>{selectedPlace.category_name}</p>
              </div>
              <button onClick={() => setSelectedPlace(null)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#bbb", fontSize: "22px", padding: 0, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: "12px 24px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {selectedPlace.road_address_name && (<div style={{ display: "flex", gap: "8px" }}><span style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", textTransform: "uppercase", flexShrink: 0, marginTop: "1px" }}>주소</span><span style={{ fontSize: "13px", color: "#444" }}>{selectedPlace.road_address_name}</span></div>)}
              {selectedPlace.phone && (<div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", textTransform: "uppercase", flexShrink: 0 }}>전화</span><a href={"tel:" + String(selectedPlace.phone)} style={{ fontSize: "13px", color: "#1a2a7a", textDecoration: "none" }}>{String(selectedPlace.phone)}</a></div>)}
              {selectedPlace.place_url && (<a href={String(selectedPlace.place_url)} target="_blank" rel="noreferrer" style={{ fontSize: "12px", color: "#fff", background: "#1a2a7a", padding: "8px 16px", letterSpacing: "1px", textDecoration: "none", display: "inline-block", marginTop: "4px", textAlign: "center", borderRadius: "6px" }}>카카오맵에서 영업시간 보기</a>)}
              {selectedPlace.y && selectedPlace.x && (
                <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      // 전체화면 지도 열고 자동차 길찾기
                      setMapExpanded(true);
                      setDirectionsMode("car");
                      setTimeout(() => drawRoute(parseFloat(selectedPlace.y), parseFloat(selectedPlace.x), "car"), 600);
                    }}
                    style={{ flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid #1a2a7a", background: "#1a2a7a", color: "#fff", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}
                  >🚗 자동차</button>
                  <button
                    type="button"
                    onClick={() => {
                      setMapExpanded(true);
                      setDirectionsMode("walk");
                      setTimeout(() => drawRoute(parseFloat(selectedPlace.y), parseFloat(selectedPlace.x), "walk"), 600);
                    }}
                    style={{ flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid #ddd", background: "#fff", color: "#555", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}
                  >🚶 도보</button>
                  <button
                    type="button"
                    onClick={() => openTransitInKakaoMap(selectedPlace.place_name, parseFloat(selectedPlace.y), parseFloat(selectedPlace.x))}
                    style={{ flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid #ddd", background: "#fff", color: "#555", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}
                  >🚌 대중교통</button>
                </div>
              )}
            </div>
            {(selectedPlace._feedPosts ?? []).length > 0 && (
              <div style={{ borderTop: "0.5px solid #f0f0f0" }}>
                <p style={{ margin: 0, padding: "12px 24px 8px", fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px" }}>큐레이션 {(selectedPlace._feedPosts as FeedPost[]).length}</p>
                {(selectedPlace._feedPosts as FeedPost[]).map((post) => (
                  <div key={post.id} onClick={() => { setDetailPostId(post.id); setSelectedPlace(null); }} style={{ padding: "12px 24px", borderTop: "0.5px solid #f8f8f8", cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "#1a2a7a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", flexShrink: 0 }}>{post.user.slice(0, 1).toUpperCase()}</div>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#1a1a2e" }}>{post.user}</span>
                      <span style={{ fontSize: "10px", color: "#bbb", marginLeft: "auto" }}>{timeAgo(post.createdAt)}</span>
                    </div>
                    <p style={{ margin: "0 0 8px", fontFamily: "'Playfair Display', serif", fontSize: "14px", color: "#1a2a7a" }}>{post.title || post.placeName}</p>
                    {post.images.length > 0 && (
                      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: "6px", marginBottom: "8px", overflowX: "auto" }}>
                        {post.images.map((img, i) => <img key={i} src={img} onClick={() => setLightboxImg(img)} style={{ width: "80px", height: "80px", objectFit: "cover", borderRadius: "8px", flexShrink: 0, cursor: "pointer" }} />)}
                      </div>
                    )}
                    <p style={{ margin: "0 0 6px", fontSize: "12px", color: "#555", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>{post.comment}</p>
                    <div style={{ display: "flex", gap: "12px" }}>
                      <span style={{ fontSize: "11px", color: post.likes.includes(MY_USERNAME) ? "#e05555" : "#ccc" }}>♥ {post.likes.length}</span>
                      <span style={{ fontSize: "11px", color: "#ccc" }}>💬 {post.comments.length}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(selectedPlace._feedPosts ?? []).length === 0 && (<div style={{ padding: "14px 24px 20px", textAlign: "center" }}><p style={{ margin: 0, fontSize: "12px", color: "#ccc" }}>아직 큐레이션이 없어요</p></div>)}
          </div>
        )}
        {sharePostModalEl}
      </section>
    </main>
    </>
  );
}