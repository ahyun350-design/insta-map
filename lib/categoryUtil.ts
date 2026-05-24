import type { FeedPost } from "@/lib/feedPost";

/** 큐레이션 게시글(feed_posts) 표시용 카테고리 — places·photo_place_tags.category와 무관 */
export function getDisplayCategories(post: FeedPost): string[] {
  if (post.categories && post.categories.length > 0) {
    return post.categories;
  }
  if (post.category) {
    return [post.category];
  }
  return [];
}
