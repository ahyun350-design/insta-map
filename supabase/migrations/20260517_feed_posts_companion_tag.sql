-- 큐레이션 v2: 동행 태그 (companion_tag)
ALTER TABLE public.feed_posts
  ADD COLUMN IF NOT EXISTS companion_tag text;

ALTER TABLE public.feed_posts
  DROP CONSTRAINT IF EXISTS feed_posts_companion_tag_check;

ALTER TABLE public.feed_posts
  ADD CONSTRAINT feed_posts_companion_tag_check
  CHECK (
    companion_tag IS NULL
    OR companion_tag IN ('lover', 'friend', 'pet', 'alone', 'family', 'parent', 'kid')
  );
