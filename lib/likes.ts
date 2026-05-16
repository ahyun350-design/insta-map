import { supabase } from "./supabase";

/** 좋아요 토글: row 있으면 DELETE, 없으면 INSERT */
export async function toggleLikeRow(
  postId: string,
  userId: string,
): Promise<{ liked: boolean; error?: string }> {
  const { data: existing, error: selectError } = await supabase
    .from("likes")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();

  if (selectError) {
    return { liked: false, error: selectError.message };
  }

  if (existing) {
    const { error: deleteError } = await supabase
      .from("likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", userId);
    if (deleteError) {
      return { liked: true, error: deleteError.message };
    }
    return { liked: false };
  }

  const { error: insertError } = await supabase.from("likes").insert({
    post_id: postId,
    user_id: userId,
  });
  if (insertError) {
    return { liked: false, error: insertError.message };
  }
  return { liked: true };
}

/** 게시물에 좋아요 누른 user_id 목록 */
export async function fetchPostLikers(postId: string): Promise<string[]> {
  const { data, error } = await supabase.from("likes").select("user_id").eq("post_id", postId);
  if (error || !data) return [];
  return data.map((row) => row.user_id as string);
}

/** 현재 사용자가 좋아요한 post_id 집합 (배치 조회) */
export async function fetchLikedPostIdsForUser(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("likes").select("post_id").eq("user_id", userId);
  if (error || !data) return new Set();
  return new Set(data.map((row) => row.post_id as string));
}

/** 단일 게시물 liked_by_me 여부 */
export async function fetchIsPostLikedByUser(postId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("likes")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}
