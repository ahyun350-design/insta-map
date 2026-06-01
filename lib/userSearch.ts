import { supabase } from "./supabase";

export type UserSearchHit = {
  id: string;
  username: string;
  avatar_url?: string;
  /** DB에 display_name 없으면 bio를 부제로 쓸 수 있음 */
  display_name?: string | null;
  bio?: string | null;
  isFollowing: boolean;
};

function sanitizeIlikeQuery(raw: string): string {
  return raw.trim().replace(/[%_\\]/g, "");
}

/** 검색 결과 부제 — display_name 우선, 없으면 bio 일부 */
export function getUserSearchSubtitle(hit: Pick<UserSearchHit, "display_name" | "bio">): string | null {
  const dn = hit.display_name?.trim();
  if (dn) return dn;
  const bio = hit.bio?.trim();
  if (!bio) return null;
  return bio.length > 48 ? `${bio.slice(0, 48)}…` : bio;
}

export async function searchUsersByUsername(
  query: string,
  currentUserId: string,
  followingIds: string[],
): Promise<{ data: UserSearchHit[]; error: string | null }> {
  const q = sanitizeIlikeQuery(query);
  if (!q) return { data: [], error: null };

  const { data, error } = await supabase
    .from("users")
    .select("id, username, avatar_url, bio")
    .ilike("username", `%${q}%`)
    .neq("id", currentUserId)
    .limit(20);

  if (error) {
    return { data: [], error: error.message || "검색에 실패했어요" };
  }

  const followingSet = new Set(followingIds);
  const hits: UserSearchHit[] = (data ?? []).map((row) => ({
    id: String(row.id),
    username: String(row.username ?? ""),
    avatar_url: typeof row.avatar_url === "string" ? row.avatar_url : undefined,
    bio: typeof row.bio === "string" ? row.bio : null,
    isFollowing: followingSet.has(String(row.id)),
  }));

  return { data: hits, error: null };
}
