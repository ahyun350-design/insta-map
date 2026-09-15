-- Extract cache v2: rule_version + expanded fail statuses + kakao place miss cache.
-- Apply manually when ready. Does NOT invalidate existing reel_cache rows.

BEGIN;

ALTER TABLE public.reel_cache
  ADD COLUMN IF NOT EXISTS rule_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.reel_cache
  ADD COLUMN IF NOT EXISTS error_code text;

ALTER TABLE public.reel_cache
  DROP CONSTRAINT IF EXISTS reel_cache_status_check;

ALTER TABLE public.reel_cache
  ADD CONSTRAINT reel_cache_status_check
  CHECK (status IN (
    'ok',
    'no_places',
    'no_caption',
    'failed'
  ));

COMMENT ON COLUMN public.reel_cache.rule_version IS
  'EXTRACT_PLACE_RULE_VERSION at write time. Future invalidation; reads currently lazy-filter.';
COMMENT ON COLUMN public.reel_cache.error_code IS
  'When status=failed: caption_empty|caption_too_short|only_account_handles|overseas_unsupported|no_places_in_caption|…';

CREATE TABLE IF NOT EXISTS public.kakao_place_miss_cache (
  place_key text PRIMARY KEY,
  error_code text NOT NULL DEFAULT 'kakao_unresolved',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kakao_place_miss_cache_created_at_idx
  ON public.kakao_place_miss_cache (created_at);

ALTER TABLE public.kakao_place_miss_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kakao_place_miss_cache_deny_all" ON public.kakao_place_miss_cache;
CREATE POLICY "kakao_place_miss_cache_deny_all"
  ON public.kakao_place_miss_cache
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

GRANT ALL ON public.kakao_place_miss_cache TO service_role;

COMMIT;
