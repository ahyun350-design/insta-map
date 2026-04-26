"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type TabId = "home" | "messages" | "map" | "saved" | "mypage";
type Category = "맛집" | "카페" | "쇼핑" | "숙소";
type Place = { id: string; name: string; address: string; category: Category };
type KakaoStatus = "idle" | "loading" | "ready" | "error";
type Comment = { id: string; user: string; text: string; createdAt: string };
type FeedPost = {
  id: string; user: string; title: string; placeName: string; address: string;
  category: Category; comment: string; images: string[]; createdAt: string;
  archived?: boolean; likes: string[]; comments: Comment[];
};

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
const MY_USER = "ahyun";
const CATEGORY_CLASS: Record<Category, string> = { 맛집: "restaurant", 카페: "cafe", 쇼핑: "shopping", 숙소: "stay" };
const CATEGORY_PIN: Record<Category, { color: string; emoji: string }> = {
  맛집: { color: "#513229", emoji: "🍽️" }, 카페: { color: "#FCE6B7", emoji: "☕" },
  쇼핑: { color: "#D8EBF9", emoji: "🛍️" }, 숙소: { color: "#D7D4B1", emoji: "🏠" },
};
const CATEGORY_COLORS: Record<Category, string> = { 맛집: "#513229", 카페: "#b08d57", 쇼핑: "#4a7fa5", 숙소: "#7a7a50" };

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

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [savedPlaces, setSavedPlaces] = useState<Place[]>([]);
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [kakaoStatus, setKakaoStatus] = useState<KakaoStatus>("idle");
  const [mapExpanded, setMapExpanded] = useState(false);
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

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null); const mapExpandedRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null); const expandedMapRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null); const markersRef = useRef<any[]>([]);
  const expandedMarkersRef = useRef<any[]>([]); const feedMarkersRef = useRef<any[]>([]);
  const searchMarkersRef = useRef<any[]>([]); const mapKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

  const hideFromMap = (id: string) => setHiddenIds(prev => new Set([...prev, id]));
  const canSubmit = useMemo(() => instagramUrl.trim().length > 0 && !isSubmitting, [instagramUrl, isSubmitting]);
  const canPost = postTitle.trim().length > 0 && postPlaceName.trim().length > 0 && postComment.trim().length > 0 && postImages.length > 0;
  const detailPost = detailPostId ? feedPosts.find(p => p.id === detailPostId) ?? null : null;

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: placesData } = await supabase.from("places").select("*").order("created_at", { ascending: false });
      if (placesData) setSavedPlaces(placesData.map(p => ({ id: p.id, name: p.name, address: p.address, category: p.category as Category })));
      const { data: postsData } = await supabase.from("feed_posts").select("*, comments(*)").order("created_at", { ascending: false });
      if (postsData) {
        setFeedPosts(postsData.map(p => ({
          id: p.id, user: p.user_name, title: p.title, placeName: p.place_name,
          address: p.address, category: p.category as Category, comment: p.comment,
          images: p.images ?? [], createdAt: p.created_at, archived: p.archived,
          likes: p.likes ?? [],
          comments: (p.comments ?? []).map((c: any) => ({ id: c.id, user: c.user_name, text: c.text, createdAt: c.created_at })),
        })));
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const addPlace = async (place: Place) => {
    await supabase.from("places").upsert({ id: place.id, name: place.name, address: place.address, category: place.category });
    setSavedPlaces(prev => [place, ...prev.filter(p => p.id !== place.id)]);
  };
  const deletePlace = async (id: string) => {
    await supabase.from("places").delete().eq("id", id);
    setSavedPlaces(prev => prev.filter(p => p.id !== id));
  };
  const submitPost = async (post: FeedPost) => {
    await supabase.from("feed_posts").insert({ id: post.id, user_name: post.user, title: post.title, place_name: post.placeName, address: post.address, category: post.category, comment: post.comment, images: post.images, likes: [], archived: false });
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
    const liked = post.likes.includes(MY_USER);
    const newLikes = liked ? post.likes.filter(u => u !== MY_USER) : [...post.likes, MY_USER];
    await supabase.from("feed_posts").update({ likes: newLikes }).eq("id", postId);
    setFeedPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: newLikes } : p));
  };
  const addComment = async (postId: string) => {
    if (!newComment.trim()) return;
    const c = { id: Date.now().toString(), post_id: postId, user_name: MY_USER, text: newComment.trim() };
    await supabase.from("comments").insert(c);
    const newC: Comment = { id: c.id, user: MY_USER, text: newComment.trim(), createdAt: new Date().toISOString() };
    setFeedPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: [...p.comments, newC] } : p));
    setNewComment("");
  };
  const deleteComment = async (postId: string, commentId: string) => {
    await supabase.from("comments").delete().eq("id", commentId);
    setFeedPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: p.comments.filter(c => c.id !== commentId) } : p));
  };

  const handleAddFromInstagram = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true); setStatus("Instagram 링크를 분석해서 장소를 추출하는 중..."); setError("");
    try {
      const response = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instagramUrl: instagramUrl.trim() }) });
      const data = await response.json() as { places?: Array<Omit<Place, "id">>; error?: string };
      if (!response.ok || !data.places?.length) throw new Error(data.error ?? "장소 추출에 실패했습니다.");
      for (const p of data.places) { await addPlace({ id: Math.random().toString(36).substring(2) + Date.now().toString(36), ...p }); }
      setInstagramUrl(""); setStatus(`${data.places.length}개 장소를 지도에 추가했어요.`);
    } catch (e) { setStatus(""); setError(e instanceof Error ? e.message : "요청 처리 중 오류가 발생했습니다."); }
    finally { setIsSubmitting(false); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).slice(0, 6 - postImages.length).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => { if (ev.target?.result) setPostImages(prev => [...prev, ev.target!.result as string]); };
      reader.readAsDataURL(file);
    }); e.target.value = "";
  };
  const handlePostSearch = () => {
    if (!postSearchQuery.trim() || !window.kakao?.maps?.services) return;
    new window.kakao.maps.services.Places().keywordSearch(postSearchQuery.trim(), (data: any[], st: string) => {
      if (st === window.kakao.maps.services.Status.OK) setPostSearchResults(data.slice(0, 5)); else alert("검색 결과가 없습니다.");
    });
  };
  const handleSelectPostPlace = (place: any) => {
    setPostPlaceName(place.place_name); setPostAddress(place.road_address_name || place.address_name || "");
    const cat: Category = place.category_name?.includes("카페") ? "카페" : place.category_name?.includes("음식") || place.category_name?.includes("맛집") ? "맛집" : place.category_name?.includes("숙박") || place.category_name?.includes("호텔") ? "숙소" : "쇼핑";
    setPostCategory(cat); setPostSearchResults([]); setPostSearchQuery("");
  };
  const handleSubmitPost = async () => {
    if (!canPost) return;
    const newPost: FeedPost = { id: Math.random().toString(36).substring(2) + Date.now().toString(36), user: MY_USER, title: postTitle, placeName: postPlaceName, address: postAddress, category: postCategory, comment: postComment, images: postImages, createdAt: new Date().toISOString(), likes: [], comments: [] };
    await submitPost(newPost);
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
  const initMap = () => {
    if (!mapContainerRef.current || mapRef.current) return;
    mapRef.current = new window.kakao.maps.Map(mapContainerRef.current, { center: new window.kakao.maps.LatLng(37.5665, 126.978), level: 12 });
    geocoderRef.current = new window.kakao.maps.services.Geocoder();
    addMyLocation(mapRef.current);
    setKakaoStatus("ready");
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

  const handleSearch = () => {
    if (!searchQuery.trim() || !expandedMapRef.current || !window.kakao?.maps) return;
    const ps = new window.kakao.maps.services.Places(); const geocoder = new window.kakao.maps.services.Geocoder();
    const doSearch = (data: any[], st: string) => {
      if (st !== window.kakao.maps.services.Status.OK) { alert("검색 결과가 없습니다."); return; }
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
    if (!mapKey) return;
    if (window.kakao?.maps) { setKakaoStatus("ready"); return; }
    setKakaoStatus("loading");
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${mapKey}&autoload=false&libraries=services`; script.async = true;
    script.onload = () => {
      if (!window.kakao?.maps) { setKakaoStatus("error"); return; }
      window.kakao.maps.load(() => { setKakaoStatus("ready"); });
    };
    script.onerror = () => setKakaoStatus("error");
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch {} };
  }, [mapKey]);

  // 지도 탭이 활성화될 때 지도 초기화 (DOM이 준비된 후)
  useEffect(() => {
    if (activeTab !== "map" || kakaoStatus !== "ready") return;
    setTimeout(() => { initMap(); }, 50);
  }, [activeTab, kakaoStatus]);

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
  }, [feedPosts, mapExpanded]);

  useEffect(() => { if (!openMenuId) return; const handler = () => setOpenMenuId(null); document.addEventListener("click", handler); return () => document.removeEventListener("click", handler); }, [openMenuId]);

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
              const saved = savedPlaces.find(p => p.name === selectedPlace.place_name);
              return (
                <button onClick={async () => {
                  if (saved) {
                    await deletePlace(saved.id);
                  } else {
                    const category: Category = selectedPlace.category_name?.includes("카페") ? "카페" : selectedPlace.category_name?.includes("음식") || selectedPlace.category_name?.includes("맛집") ? "맛집" : selectedPlace.category_name?.includes("숙박") || selectedPlace.category_name?.includes("호텔") ? "숙소" : "쇼핑";
                    await addPlace({ id: Math.random().toString(36).substring(2) + Date.now().toString(36), name: selectedPlace.place_name, address: selectedPlace.road_address_name || selectedPlace.address_name || "", category });
                  }
                }} type="button" style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill={saved ? "#1a2a7a" : "none"}>
                    <path d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
                  <span style={{ fontSize: "11px", color: post.likes.includes(MY_USER) ? "#e05555" : "#ccc" }}>♥ {post.likes.length}</span>
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

  if (detailPost) {
    const liked = detailPost.likes.includes(MY_USER);
    return (
      <main className="mobileRoot">
        <section className="phoneFrame">
          <header style={{ height: "56px", display: "flex", alignItems: "center", padding: "0 20px", borderBottom: "0.5px solid #efefef", background: "#fff", gap: "12px", flexShrink: 0 }}>
            <button onClick={() => setDetailPostId(null)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#1a2a7a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detailPost.title || detailPost.placeName}</span>
          </header>
          <div style={{ flex: 1, overflowY: "auto", background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "16px 20px 0" }}>
              <div className="avatar">{detailPost.user.slice(0, 1).toUpperCase()}</div>
              <div><p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#1a1a2e" }}>{detailPost.user}</p><p style={{ margin: 0, fontSize: "11px", color: "#aaa" }}>{timeAgo(detailPost.createdAt)}</p></div>
            </div>
            <div style={{ padding: "14px 20px 0" }}><p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "22px", color: "#1a2a7a", lineHeight: 1.3 }}>{detailPost.title || detailPost.placeName}</p></div>
            <div style={{ margin: "12px 20px 0", padding: "12px 14px", background: "#f8f8fc", borderRadius: "8px", display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "22px" }}>{CATEGORY_PIN[detailPost.category].emoji}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: "14px", fontFamily: "'Playfair Display', serif", color: "#1a1a2e" }}>{detailPost.placeName}</p>
                <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detailPost.address}</p>
              </div>
              <span style={{ fontSize: "10px", color: "#fff", background: CATEGORY_COLORS[detailPost.category], padding: "3px 8px", borderRadius: "10px", flexShrink: 0 }}>{detailPost.category}</span>
            </div>
            {detailPost.images.length > 0 && (
              <div style={{ display: "flex", gap: "6px", margin: "14px 20px 0", overflowX: "auto", paddingBottom: "4px" }}>
                {detailPost.images.map((img, i) => <img key={i} src={img} onClick={() => setLightboxImg(img)} style={{ width: "200px", height: "200px", objectFit: "cover", borderRadius: "10px", flexShrink: 0, cursor: "pointer" }} />)}
              </div>
            )}
            <div style={{ padding: "16px 20px 0" }}><p style={{ margin: 0, fontSize: "14px", color: "#333", lineHeight: 1.9 }}>{detailPost.comment}</p></div>
            <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", gap: "14px", borderTop: "0.5px solid #f0f0f0", marginTop: "16px" }}>
              <button onClick={() => toggleLike(detailPost.id)} style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", padding: 0 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill={liked ? "#e05555" : "none"}><path d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z" stroke={liked ? "#e05555" : "#aaa"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span style={{ fontSize: "13px", color: liked ? "#e05555" : "#aaa" }}>{detailPost.likes.length}</span>
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#aaa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span style={{ fontSize: "13px", color: "#aaa" }}>{detailPost.comments.length}</span>
              </div>
            </div>
            <div style={{ padding: "14px 20px 0" }}>
              <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px" }}>댓글 {detailPost.comments.length}</p>
              {detailPost.comments.map((c) => (
                <div key={c.id} style={{ display: "flex", gap: "10px", marginBottom: "14px", alignItems: "flex-start" }}>
                  <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: "#1a2a7a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", flexShrink: 0 }}>{c.user.slice(0, 1).toUpperCase()}</div>
                  <div style={{ flex: 1, background: "#f8f8fc", borderRadius: "10px", padding: "8px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#1a1a2e" }}>{c.user}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "10px", color: "#bbb" }}>{timeAgo(c.createdAt)}</span>
                        {c.user === MY_USER && <button onClick={() => deleteComment(detailPost.id, c.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ccc", fontSize: "13px", padding: 0, lineHeight: 1 }}>×</button>}
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: "13px", color: "#444", lineHeight: 1.5 }}>{c.text}</p>
                  </div>
                </div>
              ))}
              {detailPost.comments.length === 0 && <p style={{ fontSize: "12px", color: "#ccc", textAlign: "center", padding: "10px 0" }}>첫 댓글을 남겨보세요 💬</p>}
            </div>
            <div style={{ padding: "14px 20px 30px", display: "flex", gap: "8px" }}>
              <input className="mapInput" placeholder="댓글을 입력하세요..." value={newComment} onChange={(e) => setNewComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComment(detailPost.id)} style={{ flex: 1 }} />
              <button className="primaryButton" type="button" disabled={!newComment.trim()} onClick={() => addComment(detailPost.id)} style={{ padding: "0 16px", opacity: newComment.trim() ? 1 : 0.4 }}>등록</button>
            </div>
          </div>
          {lightboxImg && <div onClick={() => setLightboxImg(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999999, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center" }}><img src={lightboxImg} style={{ maxWidth: "95%", maxHeight: "90vh", objectFit: "contain", borderRadius: "4px" }} /></div>}
        </section>
      </main>
    );
  }

  return (
    <main className="mobileRoot">
      <section className="phoneFrame">
        <header className="appHeader">
          <h1 className="appTitle">InstaMap</h1>
          <button className="headerAction" type="button" onClick={() => setShowPostModal(true)}><span>＋</span></button>
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
              {loading && <p className="hintText" style={{ textAlign: "center" }}>불러오는 중...</p>}
              {!loading && visibleFeedPosts.length === 0 && (<div style={{ textAlign: "center", padding: "40px 20px", color: "#bbb" }}><p style={{ fontSize: "32px", marginBottom: "8px" }}>✍️</p><p style={{ fontSize: "13px" }}>아직 큐레이션이 없어요.</p><p style={{ fontSize: "12px", marginTop: "4px" }}>오른쪽 위 + 버튼으로 첫 장소를 올려보세요!</p></div>)}
              {visibleFeedPosts.map((post) => (
                <article key={post.id} className="feedCard" style={{ position: "relative", cursor: "pointer", overflow: "hidden" }} onClick={() => setDetailPostId(post.id)}>
                  <div className="feedTop" onClick={(e) => e.stopPropagation()}>
                    <div className="avatar">{post.user.slice(0, 1).toUpperCase()}</div>
                    <div style={{ flex: 1 }}><p className="feedUser">{post.user}</p><p className="feedMeta">{timeAgo(post.createdAt)}</p></div>
                    {post.user === MY_USER && (
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
                      <svg width="18" height="18" viewBox="0 0 24 24" fill={post.likes.includes(MY_USER) ? "#e05555" : "none"}><path d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z" stroke={post.likes.includes(MY_USER) ? "#e05555" : "#ccc"} strokeWidth="1.5"/></svg>
                      <span style={{ fontSize: "12px", color: post.likes.includes(MY_USER) ? "#e05555" : "#ccc" }}>{post.likes.length}</span>
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      <span style={{ fontSize: "12px", color: "#ccc" }}>{post.comments.length}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {activeTab === "messages" && (<div className="screen"><p className="screenTitle">메시지</p>{CHAT_LIST.map((chat) => (<article key={chat.id} className="chatItem"><div className="avatar">{chat.name.slice(0, 1)}</div><div className="chatBody"><p className="chatName">{chat.name}</p><p className="chatPreview">{chat.preview}</p></div><span className="chatTime">{chat.time}</span></article>))}</div>)}

          {activeTab === "map" && (
            <div className="screen">
              <p className="screenTitle">지도</p>
              <div className="mapInputWrap">
                <input className="mapInput" placeholder="Instagram 릴스/게시물 URL 붙여넣기" value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} />
                <button className="primaryButton" onClick={handleAddFromInstagram} type="button" disabled={!canSubmit}>{isSubmitting ? "분석 중..." : "핀 추가"}</button>
              </div>
              {status && <p className="hintText">{status}</p>}
              {error && <p className="emptyText">{error}</p>}
              {kakaoStatus === "loading" && <p className="hintText">카카오맵을 불러오는 중...</p>}
              {kakaoStatus === "error" && <p className="emptyText">카카오맵 로딩에 실패했습니다.</p>}
              <div ref={mapContainerRef} className="kakaoMap" />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
                <button onClick={() => setMapExpanded(true)} style={{ background: "transparent", border: "0.5px solid #ddd", borderRadius: "4px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#1a2a7a", letterSpacing: "0.5px", fontFamily: "'Inter', sans-serif" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 5V1H5M7 1H11V5M11 7V11H7M5 11H1V7" stroke="#1a2a7a" strokeWidth="1.2" strokeLinecap="round"/></svg>전체화면
                </button>
              </div>
              {mapExpanded && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, background: "#fff", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "0.5px solid #efefef", display: "flex", justifyContent: "center", alignItems: "center", background: "#fff", position: "relative" }}>
                    <button onClick={() => { setMapExpanded(false); setSelectedPlace(null); }} style={{ position: "absolute", left: "20px", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>InstaMap</span>
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
                  <article key={place.id} className="miniItem">
                    <span className={`dot ${CATEGORY_CLASS[place.category]}`} />
                    <div style={{ flex: 1 }}><p className="miniName">{place.name}</p><p className="miniMeta">{place.address} · {place.category}</p></div>
                    <button onClick={() => hideFromMap(place.id)} type="button" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ccc", fontSize: "16px", padding: "0 4px", lineHeight: 1, flexShrink: 0 }}>×</button>
                  </article>
                ))}
                {savedPlaces.filter(p => !hiddenIds.has(p.id)).length === 0 && savedPlaces.length > 0 && (<p className="hintText" style={{ textAlign: "center" }}>모든 장소가 숨겨졌어요.{" "}<button onClick={() => setHiddenIds(new Set())} style={{ border: "none", background: "none", color: "#1a2a7a", cursor: "pointer", fontSize: "12px", textDecoration: "underline" }}>다시 보기</button></p>)}
                {savedPlaces.length === 0 && <p className="emptyText">아직 핀이 없습니다. URL을 입력해 시작해보세요.</p>}
              </div>
            </div>
          )}

          {activeTab === "saved" && (<div className="screen"><p className="screenTitle">저장한 장소</p>{savedPlaces.map((place) => (<article key={place.id} className="savedItem"><span className={`dot ${CATEGORY_CLASS[place.category]}`} /><div className="savedBody"><p className="savedName">{place.name}</p><p className="savedMeta">{place.address} · {place.category}</p></div><button className="ghostButton" type="button" onClick={() => deletePlace(place.id)}>삭제</button></article>))}{savedPlaces.length === 0 && <p className="emptyText">저장된 장소가 아직 없어요.</p>}</div>)}

          {activeTab === "mypage" && (<div className="screen"><p className="screenTitle">마이페이지</p><article className="profileCard"><div className="profileAvatar">A</div><div><p className="profileName">ahyun</p><p className="profileHandle">@ahyun_travelnote</p></div></article><div className="settingList"><button type="button" className="settingItem">프로필 편집</button><button type="button" className="settingItem">알림 설정</button><button type="button" className="settingItem">공개 범위 설정</button><button type="button" className="settingItem">로그아웃</button></div></div>)}
        </section>
        <nav className="tabBar">
          {TABS.map((tab) => (<button key={tab.id} type="button" className={`tabItem ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}><span className="tabIcon">{tab.icon}</span><span>{tab.label}</span></button>))}
        </nav>
      </section>
    </main>
  );
}