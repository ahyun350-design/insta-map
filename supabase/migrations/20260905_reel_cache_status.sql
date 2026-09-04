-- reel_cache: 성공/실패 상태 구분 (Apify 재호출 절감)
-- 실행은 대시보드/CLI에서 수동으로.

ALTER TABLE public.reel_cache
  ADD COLUMN IF NOT EXISTS status text;

-- 기존 행 백필
UPDATE public.reel_cache
SET status = CASE
  WHEN caption IS NULL OR length(trim(caption)) = 0 THEN 'no_caption'
  WHEN claude_places IS NULL
    OR jsonb_typeof(claude_places) <> 'array'
    OR claude_places = '[]'::jsonb THEN 'no_places'
  ELSE 'ok'
END
WHERE status IS NULL;

ALTER TABLE public.reel_cache
  ALTER COLUMN status SET DEFAULT 'ok';

ALTER TABLE public.reel_cache
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.reel_cache
  DROP CONSTRAINT IF EXISTS reel_cache_status_check;

ALTER TABLE public.reel_cache
  ADD CONSTRAINT reel_cache_status_check
  CHECK (status IN ('ok', 'no_places', 'no_caption'));

COMMENT ON COLUMN public.reel_cache.status IS
  'ok=장소 추출 성공, no_places=캡션은 있으나 장소 없음, no_caption=캡션 없음. 실패(no_*)는 앱에서 7일 TTL.';
