-- 큐레이션 게시글 다중 카테고리 (feed_posts 전용, places와 무관)
ALTER TABLE public.feed_posts
  ADD COLUMN IF NOT EXISTS categories text[];

NOTIFY pgrst, 'reload schema';
