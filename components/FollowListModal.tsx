"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { ProfileAvatar } from "@/components/ProfileAvatar";

export type FollowListType = "followers" | "following";

export type FollowListUser = {
  id: string;
  username: string;
  avatar_url?: string | null;
  bio?: string | null;
};

type FollowListModalProps = {
  open: boolean;
  onClose: () => void;
  userId: string;
  type: FollowListType;
  onUserClick?: (username: string) => void;
};

const TITLE: Record<FollowListType, string> = {
  followers: "팔로워",
  following: "팔로잉",
};

const EMPTY: Record<FollowListType, string> = {
  followers: "팔로워가 없어요",
  following: "아무도 팔로우하지 않고 있어요",
};

async function fetchFollowListUsers(userId: string, type: FollowListType): Promise<FollowListUser[]> {
  const ids: string[] = [];

  if (type === "followers") {
    const { data: rows, error } = await supabase
      .from("follows")
      .select("follower_id, created_at")
      .eq("following_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    for (const row of rows ?? []) {
      if (row.follower_id) ids.push(row.follower_id);
    }
  } else {
    const { data: rows, error } = await supabase
      .from("follows")
      .select("following_id, created_at")
      .eq("follower_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    for (const row of rows ?? []) {
      if (row.following_id) ids.push(row.following_id);
    }
  }

  if (ids.length === 0) return [];

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, username, avatar_url, bio")
    .in("id", ids);

  if (usersError) throw usersError;

  const byId = new Map((users ?? []).map((u) => [u.id, u as FollowListUser]));
  return ids.map((id) => byId.get(id)).filter((u): u is FollowListUser => Boolean(u));
}

function FollowListSheet({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return (
    <div
      onClick={onClose}
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
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "100%",
          borderRadius: "20px 20px 0 0",
          maxHeight: "75vh",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px 12px",
            borderBottom: "0.5px solid #efefef",
            flexShrink: 0,
          }}
        >
          <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: "#1a2a7a", fontWeight: 600 }}>
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              border: "none",
              background: "transparent",
              color: "#bbb",
              fontSize: 24,
              lineHeight: 1,
              cursor: "pointer",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FollowListModal({ open, onClose, userId, type, onUserClick }: FollowListModalProps) {
  const [users, setUsers] = useState<FollowListUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchFollowListUsers(userId, type);
      setUsers(list);
    } catch {
      setError("목록을 불러오지 못했어요");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [userId, type]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <FollowListSheet onClose={onClose} title={TITLE[type]}>
      {loading && (
        <p style={{ margin: 0, padding: "32px 20px", textAlign: "center", fontSize: 13, color: "#888" }}>
          불러오는 중...
        </p>
      )}
      {!loading && error && (
        <div style={{ padding: "24px 20px", textAlign: "center" }}>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "#888" }}>{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            style={{
              border: "0.5px solid #d8dcef",
              borderRadius: 8,
              background: "#fff",
              color: "#1a2a7a",
              fontSize: 13,
              padding: "8px 16px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            다시 시도
          </button>
        </div>
      )}
      {!loading && !error && users.length === 0 && (
        <p style={{ margin: 0, padding: "40px 20px", textAlign: "center", fontSize: 13, color: "#aaa" }}>
          {EMPTY[type]}
        </p>
      )}
      {!loading && !error && users.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: "4px 0 8px", maxHeight: "min(60vh, 420px)", overflowY: "auto" }}>
          {users.map((u) => {
            const bio = typeof u.bio === "string" ? u.bio.trim() : "";
            return (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => onUserClick?.(u.username)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 20px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <ProfileAvatar avatarUrl={u.avatar_url} username={u.username} size={40} fontSize={16} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1a1a2e" }}>{u.username}</p>
                    {bio ? (
                      <p
                        style={{
                          margin: "3px 0 0",
                          fontSize: 12,
                          color: "#8f93a6",
                          lineHeight: 1.35,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {bio}
                      </p>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </FollowListSheet>
  );
}