-- poi 인덱스 — 대량 적재 완료 후에만 적용
-- CONCURRENTLY 는 트랜잭션 밖에서 실행해야 함

CREATE INDEX CONCURRENTLY IF NOT EXISTS poi_name_norm_trgm_idx
  ON public.poi USING gin (name_norm gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS poi_lat_lng_idx
  ON public.poi (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS poi_category_idx
  ON public.poi (category);
