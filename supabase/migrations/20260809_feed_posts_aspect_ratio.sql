-- 큐레이션 게시물 미디어 프레임 비율 (인스타식 1:1 / 4:5 / 1.91:1)
-- NULL = 레거시 → 클라이언트에서 1:1 처리

ALTER TABLE public.feed_posts
  ADD COLUMN IF NOT EXISTS aspect_ratio text;

ALTER TABLE public.feed_posts
  DROP CONSTRAINT IF EXISTS feed_posts_aspect_ratio_check;

ALTER TABLE public.feed_posts
  ADD CONSTRAINT feed_posts_aspect_ratio_check
  CHECK (
    aspect_ratio IS NULL
    OR aspect_ratio IN ('1:1', '4:5', '1.91:1')
  );

COMMENT ON COLUMN public.feed_posts.aspect_ratio IS
  'Post media frame: 1:1 | 4:5 | 1.91:1. NULL treated as 1:1 for legacy rows.';
