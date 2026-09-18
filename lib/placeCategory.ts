import { supabase } from "@/lib/supabase";
import {
  FEED_POST_CATEGORIES,
  type FeedPostCategory,
} from "@/lib/feedPost";

export { FEED_POST_CATEGORIES };
export type { FeedPostCategory };

/** places.category PATCH. Only category (+ server sets category_edited_by_user). */
export async function updatePlaceCategory(
  placeId: string,
  category: FeedPostCategory,
): Promise<{ error: string | null; category: FeedPostCategory }> {
  const id = placeId.trim();
  if (!id) return { error: "장소 id가 없어요", category };

  if (!(FEED_POST_CATEGORIES as readonly string[]).includes(category)) {
    return { error: "유효하지 않은 카테고리입니다", category };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { error: "로그인이 필요해요", category };
  }

  const res = await fetch(`/api/places/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ category }),
  });

  if (!res.ok) {
    let msg = "카테고리를 바꾸지 못했어요";
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string" && body.error.trim()) msg = body.error;
    } catch {
      /* ignore */
    }
    return { error: msg, category };
  }

  return { error: null, category };
}
