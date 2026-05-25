-- 코스 출처: manual(마이페이지) | curation(큐레이션 첨부만)
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.courses
  DROP CONSTRAINT IF EXISTS courses_source_check;

ALTER TABLE public.courses
  ADD CONSTRAINT courses_source_check CHECK (source IN ('manual', 'curation'));
