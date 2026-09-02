-- 릴스 URL별 캡션·Claude 장소 후보 캐시 (카카오 좌표는 저장하지 않음)
CREATE TABLE IF NOT EXISTS public.reel_cache (
  instagram_url text PRIMARY KEY,
  caption text,
  claude_places jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reel_cache_created_at_idx
  ON public.reel_cache (created_at);

ALTER TABLE public.reel_cache ENABLE ROW LEVEL SECURITY;

-- 클라이언트 직접 접근 금지 — 서버 service role만 사용
DROP POLICY IF EXISTS "reel_cache_deny_all" ON public.reel_cache;
