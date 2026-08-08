-- extract_jobs 진단용 컬럼 (캡션 / Claude 원본 / 카카오 미스)
-- 적용 후 process 라우트가 성공·실패 모두에 값을 기록합니다.

ALTER TABLE public.extract_jobs
  ADD COLUMN IF NOT EXISTS caption text;

ALTER TABLE public.extract_jobs
  ADD COLUMN IF NOT EXISTS claude_places jsonb;

ALTER TABLE public.extract_jobs
  ADD COLUMN IF NOT EXISTS kakao_misses jsonb;

COMMENT ON COLUMN public.extract_jobs.caption IS 'Apify 원본 캡션 (최대 2000자 저장, 진단용)';
COMMENT ON COLUMN public.extract_jobs.claude_places IS 'Claude 추출 원본 장소 목록 (카카오 매칭 전)';
COMMENT ON COLUMN public.extract_jobs.kakao_misses IS '카카오에서 못 찾은 장소명 목록';
