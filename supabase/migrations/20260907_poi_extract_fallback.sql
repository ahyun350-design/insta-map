-- POI 폴백 연동: places.source, extract_jobs.pending_places, RPC 실행 권한

BEGIN;

ALTER TABLE public.places
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.places.source IS
  '장소 좌표 출처: kakao | poi. null은 기존/수동 저장.';

ALTER TABLE public.extract_jobs
  ADD COLUMN IF NOT EXISTS pending_places jsonb;

COMMENT ON COLUMN public.extract_jobs.pending_places IS
  'POI 검색 needs_confirm 후보 (사용자 확인 UI 전 임시 저장)';

GRANT EXECUTE ON FUNCTION public.normalize_poi_name(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_poi(text, text, double precision, double precision, int) TO service_role;

COMMIT;
