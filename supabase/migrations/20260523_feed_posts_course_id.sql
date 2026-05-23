-- 큐레이션에 코스 연결 (E-1)
ALTER TABLE public.feed_posts
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;
