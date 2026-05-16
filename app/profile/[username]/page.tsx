"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { FollowListModal, type FollowListType } from "@/components/FollowListModal";
import { PostGrid } from "@/components/PostGrid";
import { PostGridCell } from "@/components/PostGridCell";

type ProfileUser = {
  id: string;
  username: string;
  avatar_url?: string | null;
  bio?: string | null;
  total_likes_received: number;
};

type ProfilePost = {
  id: string;
  title: string;
  place_name: string;
  address: string;
  category: string;
  comment: string;
  images: string[];
  created_at: string;
  likes_count: number;
  liked_by_me: boolean;
  commentCount: number;
};

type FriendRoom = {
  id: string;
  friendId: string;
  friendName: string;
  friendAvatarUrl?: string;
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const routeUsername = useMemo(() => decodeURIComponent(params?.username ?? ""), [params?.username]);
  const { user, loading: userLoading, sessionChecked, reloadUserFromSession, verifySessionQuick } = useUser();

  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [postCount, setPostCount] = useState(0);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [showFollowList, setShowFollowList] = useState<FollowListType | null>(null);

  // 공유 모달 상태
  const [sharePost, setSharePost] = useState<ProfilePost | null>(null);
  const [friendRooms, setFriendRooms] = useState<FriendRoom[]>([]);
  const [shareLoading, setShareLoading] = useState(false);

  const isOwnProfile = !!user && !!profile && user.id === profile.id;

  useEffect(() => {
    if (!sessionChecked) return;
    if (userLoading) return;
    if (user) return;

    let cancelled = false;
    void (async () => {
      try {
        let session = await verifySessionQuick();
        if (cancelled) return;
        if (session?.user) {
          await reloadUserFromSession();
          return;
        }
        await reloadUserFromSession();
        if (cancelled) return;
        session = await verifySessionQuick();
        if (cancelled) return;
        if (!session?.user) {
          router.push("/login");
        }
      } catch (e) {
        console.error("[PindMap:profile][auth] login gate failed", e);
        if (!cancelled) router.push("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, userLoading, sessionChecked, router, reloadUserFromSession, verifySessionQuick]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user || !routeUsername) return;

      setLoadingProfile(true);
      setNotFound(false);

      const { data: profileData } = await supabase
        .from("users")
        .select("id, username, avatar_url, bio, total_likes_received")
        .eq("username", routeUsername)
        .maybeSingle();

      if (!profileData) {
        setProfile(null);
        setPosts([]);
        setPostCount(0);
        setFollowerCount(0);
        setFollowingCount(0);
        setIsFollowing(false);
        setNotFound(true);
        setLoadingProfile(false);
        return;
      }

      const target: ProfileUser = {
        id: profileData.id,
        username: profileData.username,
        avatar_url: profileData.avatar_url,
        bio: profileData.bio,
        total_likes_received: Math.max(0, Number(profileData.total_likes_received) || 0),
      };
      setProfile(target);

      const postsPromise = supabase
        .from("feed_posts")
        .select("id, title, place_name, address, category, comment, images, created_at, likes_count, comments(id)", { count: "exact" })
        .eq("user_name", target.username)
        .eq("archived", false)
        .order("created_at", { ascending: false });

      const myLikesPromise = supabase.from("likes").select("post_id").eq("user_id", user.id);

      const followersPromise = supabase
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("following_id", target.id);

      const followingsPromise = supabase
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("follower_id", target.id);

      const myFollowPromise = user.id === target.id
        ? Promise.resolve({ count: 0 } as { count: number })
        : supabase
            .from("follows")
            .select("*", { count: "exact", head: true })
            .eq("follower_id", user.id)
            .eq("following_id", target.id);

      const [postsRes, followersRes, followingsRes, myFollowRes, myLikesRes] = await Promise.all([
        postsPromise,
        followersPromise,
        followingsPromise,
        myFollowPromise,
        myLikesPromise,
      ]);

      const myLikedSet = new Set((myLikesRes.data ?? []).map((l: { post_id: string }) => l.post_id));

      const enrichedPosts: ProfilePost[] = (postsRes.data ?? []).map((p: any) => ({
        id: p.id,
        title: p.title,
        place_name: p.place_name,
        address: p.address ?? "",
        category: p.category,
        comment: p.comment,
        images: p.images ?? [],
        created_at: p.created_at,
        likes_count: p.likes_count ?? 0,
        liked_by_me: myLikedSet.has(p.id),
        commentCount: (p.comments ?? []).length,
      }));

      setPosts(enrichedPosts);
      setPostCount(postsRes.count ?? enrichedPosts.length);
      setFollowerCount(followersRes.count ?? 0);
      setFollowingCount(followingsRes.count ?? 0);
      setIsFollowing((myFollowRes.count ?? 0) > 0);
      setLoadingProfile(false);
    };

    if (!sessionChecked || userLoading || !user) return;
    void loadProfile();
  }, [user, userLoading, sessionChecked, routeUsername]);

  const toggleFollow = async () => {
    if (!user || !profile || user.id === profile.id || followLoading) return;
    setFollowLoading(true);
    if (isFollowing) {
      await supabase
        .from("follows")
        .delete()
        .eq("follower_id", user.id)
        .eq("following_id", profile.id);
      setIsFollowing(false);
      setFollowerCount((prev) => Math.max(0, prev - 1));
    } else {
      await supabase
        .from("follows")
        .insert({ follower_id: user.id, following_id: profile.id });
      setIsFollowing(true);
      setFollowerCount((prev) => prev + 1);
    }
    setFollowLoading(false);
  };

  const startMessage = async () => {
    if (!user || !profile || user.id === profile.id || messageLoading) return;
    setMessageLoading(true);
    try {
      const { data: existing } = await supabase
        .from("chat_rooms")
        .select("*")
        .or(`and(user1_id.eq.${user.id},user2_id.eq.${profile.id}),and(user1_id.eq.${profile.id},user2_id.eq.${user.id})`);

      let roomId = existing?.[0]?.id;
      if (!roomId) {
        roomId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        await supabase.from("chat_rooms").insert({ id: roomId, user1_id: user.id, user2_id: profile.id });
      }
      router.push(`/?openChatRoom=${roomId}`);
    } finally {
      setMessageLoading(false);
    }
  };

  // 공유 모달 열기 - 내 친구 목록(채팅방) 가져오기
  const openShareModal = async (post: ProfilePost) => {
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
        return {
          id: r.id,
          friendId,
          friendName: friendData?.username ?? friendId,
          friendAvatarUrl: typeof friendData?.avatar_url === "string" && friendData.avatar_url.trim() ? friendData.avatar_url.trim() : undefined,
        };
      })
    );
    setFriendRooms(rooms);
  };

  // 선택한 친구한테 큐레이션 메시지로 보내기
  const sendShareToFriend = async (room: FriendRoom) => {
    if (!user || !sharePost || !profile || shareLoading) return;
    setShareLoading(true);
    try {
      // 메시지에 [share:postId] 마커를 포함시켜서 메시지 받는 쪽에서 클릭 가능하게 표시
      const shareText = `📍 ${profile.username}님의 큐레이션\n\n"${sharePost.title || sharePost.place_name}"\n${sharePost.place_name} · ${sharePost.category}\n\n${sharePost.comment.length > 80 ? sharePost.comment.slice(0, 80) + "..." : sharePost.comment}\n\n👆 큐레이션 보러 가기 [share:${sharePost.id}]`;
      const id = Date.now().toString();
      await supabase.from("messages").insert({
        id,
        room_id: room.id,
        sender_id: user.id,
        text: shareText,
        read: false,
      });
      setSharePost(null);
      setFriendRooms([]);
      router.push(`/?openChatRoom=${room.id}`);
    } finally {
      setShareLoading(false);
    }
  };

  if (userLoading || loadingProfile || !sessionChecked) {
    return (
      <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa" }}>
        <p style={{ fontSize: "13px", color: "#888" }}>불러오는 중...</p>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="mobileRoot">
      <section className="phoneFrame">
        <header className="subpageHeader" style={{ height: "56px", display: "flex", alignItems: "center", padding: "0 20px", borderBottom: "0.5px solid #efefef", background: "#fff", gap: "12px", flexShrink: 0 }}>
          <button
            onClick={() => {
              const fromChat = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("fromChat") : null;
              if (fromChat) {
                router.push(`/?openChatRoom=${encodeURIComponent(fromChat)}`);
                return;
              }
              router.back();
            }}
            style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>프로필</span>
        </header>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#fff", padding: "20px" }}>
          {notFound && (
            <div style={{ textAlign: "center", padding: "50px 0" }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#aaa" }}>유저를 찾을 수 없어요</p>
            </div>
          )}

          {!notFound && profile && (
            <>
              <article style={{ border: "0.5px solid #efefef", borderRadius: "16px", padding: "22px 18px", background: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,0.04)" }}>
                <ProfileAvatar
                  avatarUrl={profile.avatar_url}
                  username={profile.username}
                  size={72}
                  fontSize={28}
                  style={{ margin: "0 auto 12px" }}
                />
                <p style={{ margin: 0, textAlign: "center", fontFamily: "'Playfair Display', serif", fontSize: "24px", color: "#1a1a2e" }}>{profile.username}</p>
                <p style={{ margin: "4px 0 0", textAlign: "center", fontSize: "12px", color: "#8f93a6" }}>@{profile.username}_travelnote</p>
                {profile.bio?.trim() ? (
                  <p
                    style={{
                      margin: "10px 0 0",
                      textAlign: "center",
                      fontSize: 14,
                      color: "#4a4a4a",
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {profile.bio.trim()}
                  </p>
                ) : isOwnProfile ? (
                  <p style={{ margin: "10px 0 0", textAlign: "center", fontSize: 13, color: "#8f93a6", lineHeight: 1.45 }}>
                    자기소개를 입력해보세요
                  </p>
                ) : null}

                <div style={{ marginTop: "18px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", borderTop: "0.5px solid #f0f0f0", borderBottom: "0.5px solid #f0f0f0", padding: "14px 0" }}>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ margin: 0, fontSize: "20px", color: "#1a2a7a", fontWeight: 700 }}>{postCount}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#9aa0b2" }}>큐레이션</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFollowList("followers")}
                    style={{ textAlign: "center", border: "none", background: "transparent", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                  >
                    <p style={{ margin: 0, fontSize: "20px", color: "#1a2a7a", fontWeight: 700 }}>{followerCount}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#9aa0b2" }}>팔로워</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFollowList("following")}
                    style={{ textAlign: "center", border: "none", background: "transparent", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                  >
                    <p style={{ margin: 0, fontSize: "20px", color: "#1a2a7a", fontWeight: 700 }}>{followingCount}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#9aa0b2" }}>팔로잉</p>
                  </button>
                </div>

                {(profile.total_likes_received ?? 0) > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      fontSize: 13,
                      color: "#555",
                      fontWeight: 400,
                    }}
                  >
                    <span>❤️</span>
                    <span>총 {profile.total_likes_received.toLocaleString()}개의 좋아요를 받았어요</span>
                  </div>
                )}

                <div style={{ marginTop: "14px" }}>
                  {isOwnProfile ? (
                    <button type="button" onClick={() => alert("준비 중이에요")} style={{ width: "100%", border: "0.5px solid #d8dcef", borderRadius: "8px", background: "#fff", color: "#1a2a7a", fontSize: "13px", padding: "10px", cursor: "pointer", fontFamily: "inherit" }}>
                      프로필 편집
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button type="button" disabled={followLoading} onClick={toggleFollow} style={{ flex: 1, border: isFollowing ? "1px solid #1a2a7a" : "none", borderRadius: "8px", background: isFollowing ? "#fff" : "#1a2a7a", color: isFollowing ? "#1a2a7a" : "#fff", fontSize: "13px", padding: "10px", cursor: followLoading ? "wait" : "pointer", fontFamily: "inherit", opacity: followLoading ? 0.7 : 1, fontWeight: 500 }}>
                        {isFollowing ? "팔로잉" : "팔로우"}
                      </button>
                      <button type="button" disabled={messageLoading} onClick={startMessage} style={{ flex: 1, border: "1px solid #1a2a7a", borderRadius: "8px", background: "#fff", color: "#1a2a7a", fontSize: "13px", padding: "10px", cursor: messageLoading ? "wait" : "pointer", fontFamily: "inherit", opacity: messageLoading ? 0.7 : 1, fontWeight: 500 }}>
                        💬 메시지
                      </button>
                    </div>
                  )}
                </div>
              </article>

              <section style={{ marginTop: "18px" }}>
                <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#1a2a7a", letterSpacing: "1px" }}>큐레이션 {postCount}</p>
                <PostGrid empty={posts.length === 0}>
                {posts.map((post) => (
                  <PostGridCell
                    key={post.id}
                    imageUrl={post.images[0]}
                    titleLine={(post.title || post.place_name || "").trim()}
                    placeName={post.place_name}
                    address={post.address}
                    likeCount={post.likes_count}
                    onClick={() => {
                      router.push(
                        `/?postId=${encodeURIComponent(post.id)}&from=profile&username=${encodeURIComponent(profile.username)}`,
                      );
                    }}
                  />
                ))}
                </PostGrid>
              </section>
            </>
          )}
        </div>

        {/* 공유 모달 */}
        {sharePost && (
          <div onClick={() => { if (!shareLoading) { setSharePost(null); setFriendRooms([]); } }} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", display: "flex", flexDirection: "column", gap: "12px", maxHeight: "70vh", overflowY: "auto", boxSizing: "border-box" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>친구에게 공유</span>
                <button onClick={() => { setSharePost(null); setFriendRooms([]); }} disabled={shareLoading} style={{ border: "none", background: "transparent", fontSize: "20px", color: "#bbb", cursor: shareLoading ? "wait" : "pointer" }}>×</button>
              </div>
              <div style={{ padding: "10px 12px", background: "#f8f8fc", borderRadius: "8px" }}>
                <p style={{ margin: 0, fontSize: "13px", color: "#1a2a7a", fontWeight: 500 }}>{sharePost.title || sharePost.place_name}</p>
                <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#888" }}>{sharePost.place_name} · {sharePost.category}</p>
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
        )}

        {profile && showFollowList && (
          <FollowListModal
            open
            onClose={() => setShowFollowList(null)}
            userId={profile.id}
            type={showFollowList}
            onUserClick={(username) => {
              setShowFollowList(null);
              if (username === user?.username) {
                router.push("/?tab=mypage");
                return;
              }
              if (username === profile.username) return;
              router.push(`/profile/${encodeURIComponent(username)}`);
            }}
          />
        )}

        {lightboxImg && (
          <div onClick={() => setLightboxImg(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999999, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src={lightboxImg} style={{ maxWidth: "95%", maxHeight: "90vh", objectFit: "contain", borderRadius: "4px" }} />
          </div>
        )}
      </section>
    </main>
  );
}