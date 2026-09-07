-- LOCALDATA 기반 공용 POI 참조 테이블
-- 사용자 소유 places 와 분리. 앱 검색 연동은 후속 단계.
-- 인덱스: 대량 COPY 이후 별도 적용 (20260907_poi_indexes.sql)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.poi (
  id            bigserial PRIMARY KEY,
  source        text NOT NULL,
  source_key    text NOT NULL,
  name          text NOT NULL,
  name_norm     text NOT NULL,
  road_address  text,
  jibun_address text,
  lat           double precision,
  lng           double precision,
  raw_category  text,
  category      text,
  phone         text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT poi_source_check CHECK (
    source IN ('localdata_general', 'localdata_rest', 'localdata_hotel')
  ),
  UNIQUE (source, source_key)
);

ALTER TABLE public.poi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "poi_select_authenticated" ON public.poi;
CREATE POLICY "poi_select_authenticated" ON public.poi
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.poi TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.poi FROM authenticated;
REVOKE ALL ON public.poi FROM anon;

COMMIT;
