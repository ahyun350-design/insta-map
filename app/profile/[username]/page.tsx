"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";

type ProfileUser = {
  id: string;
  username: string;
};

type ProfilePost = {
  id: string;
  title: string;
  place_name: string;
  category: string;
  comment: string;
  images: string[];
  created_at: string;
  likes: string[];
  commentCount: number;
};

type FriendRoom = {
  id: string;
  friendId: string;
  friendName: string;
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
  const { user, loading: userLoading } = useUser();

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

  // 공유 모달 상태
  const [sharePost, setSharePost] = useState<ProfilePost | null>(null);
  const [friendRooms, setFriendRooms] = useState<FriendRoom[]>([]);
  const [shareLoading, setShareLoading] = useState(false);

  const isOwnProfile = !!user && !!profile && user.id === profile.id;

  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/login");
    }
  }, [user, userLoading, router]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user || !routeUsername) return;

      setLoadingProfile(true);
      setNotFound(false);

      const { data: profileData } = await supabase
        .from("users")
        .select("id, username")
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

      const target = profileData as ProfileUser;
      setProfile(target);

      const postsPromise = supabase
        .from("feed_posts")
        .select("id, title, place_name, category, comment, images, created_at, likes, comments(id)", { count: "exact" })
        .eq("user_name", target.username)
        .eq("archived", false)
        .order("created_at", { ascending: false });

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

      const [postsRes, followersRes, followingsRes, myFollowRes] = await Promise.all([
        postsPromise,
        followersPromise,
        followingsPromise,
        myFollowPromise,
      ]);

      const enrichedPosts: ProfilePost[] = (postsRes.data ?? []).map((p: any) => ({
        id: p.id,
        title: p.title,
        place_name: p.place_name,
        category: p.category,
        comment: p.comment,
        images: p.images ?? [],
        created_at: p.created_at,
        likes: p.likes ?? [],
        commentCount: (p.comments ?? []).length,
      }));

      setPosts(enrichedPosts);
      setPostCount(postsRes.count ?? enrichedPosts.length);
      setFollowerCount(followersRes.count ?? 0);
      setFollowingCount(followingsRes.count ?? 0);
      setIsFollowing((myFollowRes.count ?? 0) > 0);
      setLoadingProfile(false);
    };

    if (!userLoading && user) {
      void loadProfile();
    }
  }, [user, userLoading, routeUsername]);

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
          .select("username")
          .eq("id", friendId)
          .maybeSingle();
        return {
          id: r.id,
          friendId,
          friendName: friendData?.username ?? friendId,
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

  if (userLoading || loadingProfile) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa" }}>
        <p style={{ fontSize: "13px", color: "#888" }}>불러오는 중...</p>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="mobileRoot">
      <section className="phoneFrame">
        <header style={{ height: "56px", display: "flex", alignItems: "center", padding: "0 20px", borderBottom: "0.5px solid #efefef", background: "#fff", gap: "12px", flexShrink: 0 }}>
          <button onClick={() => router.back()} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#1a2a7a" }}>프로필</span>
        </header>

        <div style={{ flex: 1, overflowY: "auto", background: "#fff", padding: "20px" }}>
          {notFound && (
            <div style={{ textAlign: "center", padding: "50px 0" }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#aaa" }}>유저를 찾을 수 없어요</p>
            </div>
          )}

          {!notFound && profile && (
            <>
              <article style={{ border: "0.5px solid #efefef", borderRadius: "16px", padding: "22px 18px", background: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,0.04)" }}>
                <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: "#1a2a7a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px", margin: "0 auto 12px" }}>
                  {profile.username.slice(0, 1).toUpperCase()}
                </div>
                <p style={{ margin: 0, textAlign: "center", fontFamily: "'Playfair Display', serif", fontSize: "24px", color: "#1a1a2e" }}>{profile.username}</p>
                <p style={{ margin: "4px 0 0", textAlign: "center", fontSize: "12px", color: "#8f93a6" }}>@{profile.username}_travelnote</p>

                <div style={{ marginTop: "18px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", borderTop: "0.5px solid #f0f0f0", borderBottom: "0.5px solid #f0f0f0", padding: "14px 0" }}>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ margin: 0, fontSize: "20px", color: "#1a2a7a", fontWeight: 700 }}>{postCount}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#9aa0b2" }}>큐레이션</p>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ margin: 0, fontSize: "20px", color: "#1a2a7a", fontWeight: 700 }}>{followerCount}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#9aa0b2" }}>팔로워</p>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ margin: 0, fontSize: "20px", color: "#1a2a7a", fontWeight: 700 }}>{followingCount}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#9aa0b2" }}>팔로잉</p>
                  </div>
                </div>

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
                {posts.length === 0 && (
                  <p style={{ margin: 0, textAlign: "center", fontSize: "12px", color: "#bbb", padding: "24px 0" }}>아직 공개된 큐레이션이 없어요</p>
                )}
                {posts.map((post) => (
                  <article key={post.id} onClick={() => alert("게시물 상세는 곧 연결될 예정이에요")} style={{ border: "0.5px solid #ececec", borderRadius: "14px", padding: "14px", marginBottom: "10px", cursor: "pointer", background: "#fff" }}>
                    <p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#1a2a7a" }}>{post.title || post.place_name}</p>
                    <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#777" }}>{post.place_name} · {post.category}</p>
                    {post.images && post.images.length > 0 && (
                      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: "6px", marginTop: "10px", overflowX: "auto", paddingBottom: "2px" }}>
                        {post.images.map((img, i) => (
                          <img key={i} src={img} onClick={() => setLightboxImg(img)} style={{ width: "96px", height: "96px", objectFit: "cover", borderRadius: "8px", flexShrink: 0, cursor: "pointer" }} />
                        ))}
                      </div>
                    )}
                    <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#444", lineHeight: 1.6, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>{post.comment}</p>

                    {/* 좋아요 / 댓글 / 공유 액션 행 */}
                    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: "10px", paddingTop: "10px", borderTop: "0.5px solid #f5f5f5", display: "flex", alignItems: "center", gap: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill={post.likes.includes(user.id) ? "#e05555" : "none"}><path d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z" stroke={post.likes.includes(user.id) ? "#e05555" : "#bbb"} strokeWidth="1.5" /></svg>
                        <span style={{ fontSize: "12px", color: post.likes.includes(user.id) ? "#e05555" : "#999" }}>{post.likes.length}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" /></svg>
                        <span style={{ fontSize: "12px", color: "#999" }}>{post.commentCount}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openShareModal(post)}
                        style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "5px" }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" stroke="#1a2a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span style={{ fontSize: "12px", color: "#1a2a7a", fontWeight: 500 }}>공유</span>
                      </button>
                    </div>

                    <p style={{ margin: "8px 0 0", fontSize: "10px", color: "#aaa" }}>{timeAgo(post.created_at)}</p>
                  </article>
                ))}
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
                  <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#1a2a7a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", flexShrink: 0 }}>
                    {room.friendName.slice(0, 1).toUpperCase()}
                  </div>
                  <span style={{ fontSize: "13px", color: "#1a1a2e", flex: 1 }}>{room.friendName}</span>
                  <span style={{ fontSize: "11px", color: "#1a2a7a", fontWeight: 500 }}>보내기 →</span>
                </button>
              ))}
            </div>
          </div>
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