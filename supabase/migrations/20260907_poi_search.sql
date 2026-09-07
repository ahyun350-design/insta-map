-- poi 상호명 검색 (앱 연동 전)
-- 전략: exact/prefix 우선(빠름) → 부족할 때만 trigram

BEGIN;

CREATE INDEX IF NOT EXISTS poi_name_norm_btree_idx
  ON public.poi (name_norm);

CREATE OR REPLACE FUNCTION public.normalize_poi_name(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(raw, ''), '\([^)]*\)', '', 'g'),
        '[·,&/\-_.''"`~!@#$%^*+=?<>\[\]{}|\\:;]',
        '',
        'g'
      ),
      '\s+',
      '',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.search_poi(
  q text,
  hint_region text DEFAULT NULL,
  origin_lat double precision DEFAULT NULL,
  origin_lng double precision DEFAULT NULL,
  max_results int DEFAULT 5
)
RETURNS TABLE (
  id bigint,
  source text,
  source_key text,
  name text,
  name_norm text,
  road_address text,
  jibun_address text,
  lat double precision,
  lng double precision,
  raw_category text,
  category text,
  phone text,
  score double precision,
  sim double precision,
  dist_m double precision
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  qn text;
  hint_n text;
  lim int;
  struct_n int;
  sim_floor constant double precision := 0.35;
BEGIN
  qn := public.normalize_poi_name(q);
  IF qn IS NULL OR length(qn) < 2 THEN
    RETURN;
  END IF;

  hint_n := nullif(btrim(coalesce(hint_region, '')), '');
  lim := GREATEST(1, LEAST(coalesce(max_results, 5), 20));
  PERFORM set_config('pg_trgm.similarity_threshold', '0.35', true);

  RETURN QUERY
  WITH
  -- 1) 구조 매치: 완전일치 + 접두 (btree/LIKE, 후보 상한)
  struct_ids AS (
    SELECT p.id FROM public.poi p WHERE p.name_norm = qn
    UNION
    SELECT x.id FROM (
      SELECT p.id FROM public.poi p WHERE p.name_norm LIKE qn || '%' LIMIT 80
    ) x
  ),
  -- struct 건수 확인용
  struct_count AS (
    SELECT count(*)::int AS n FROM struct_ids
  ),
  -- 2) trigram: 구조 매치가 없을 때만 (짧은 쿼리·흔한 접두는 폭주 방지)
  trgm_ids AS (
    SELECT x.id FROM (
      SELECT p.id
      FROM public.poi p
      WHERE (SELECT n FROM struct_count) = 0
        AND length(qn) >= 3
        AND p.name_norm % qn
      LIMIT 80
    ) x
  ),
  ids AS (
    SELECT struct_ids.id AS poi_id FROM struct_ids
    UNION
    SELECT trgm_ids.id AS poi_id FROM trgm_ids
  ),
  cand AS (
    SELECT
      p.id AS poi_id,
      p.source,
      p.source_key,
      p.name,
      p.name_norm,
      p.road_address,
      p.jibun_address,
      p.lat,
      p.lng,
      p.raw_category,
      p.category,
      p.phone,
      similarity(p.name_norm, qn)::double precision AS s,
      CASE
        WHEN origin_lat IS NOT NULL
         AND origin_lng IS NOT NULL
         AND p.lat IS NOT NULL
         AND p.lng IS NOT NULL
        THEN (
          6371000.0 * 2.0 * asin(least(1.0, sqrt(
            power(sin(radians(p.lat - origin_lat) / 2.0), 2) +
            cos(radians(origin_lat)) * cos(radians(p.lat)) *
            power(sin(radians(p.lng - origin_lng) / 2.0), 2)
          )))
        )
        ELSE NULL::double precision
      END AS d_m
    FROM ids
    JOIN public.poi p ON p.id = ids.poi_id
  ),
  scored AS (
    SELECT
      c.*,
      (
        CASE
          WHEN c.name_norm = qn THEN 100.0
          WHEN c.name_norm LIKE qn || '%' THEN 85.0
          WHEN length(c.name_norm) >= 2 AND qn LIKE c.name_norm || '%' THEN 70.0
          WHEN position(qn IN c.name_norm) > 0 OR position(c.name_norm IN qn) > 0 THEN 60.0
          ELSE greatest(0.0, c.s * 55.0)
        END
        + CASE
            WHEN hint_n IS NOT NULL AND (
              coalesce(c.road_address, '') ILIKE '%' || hint_n || '%'
              OR coalesce(c.jibun_address, '') ILIKE '%' || hint_n || '%'
            ) THEN 10.0
            ELSE 0.0
          END
        + CASE
            WHEN c.d_m IS NULL THEN 0.0
            ELSE greatest(0.0, 8.0 - (c.d_m / 2000.0))
          END
      )::double precision AS sc
    FROM cand c
    WHERE
      c.name_norm = qn
      OR c.name_norm LIKE qn || '%'
      OR c.s >= sim_floor
  )
  SELECT
    s.poi_id AS id,
    s.source,
    s.source_key,
    s.name,
    s.name_norm,
    s.road_address,
    s.jibun_address,
    s.lat,
    s.lng,
    s.raw_category,
    s.category,
    s.phone,
    s.sc AS score,
    s.s AS sim,
    s.d_m AS dist_m
  FROM scored s
  ORDER BY s.sc DESC, s.s DESC,
    CASE WHEN s.d_m IS NULL THEN 1e18 ELSE s.d_m END ASC,
    s.poi_id ASC
  LIMIT lim;
END;
$$;

COMMENT ON FUNCTION public.search_poi(text, text, double precision, double precision, int) IS
  'POI 상호 검색. exact/prefix 우선, 없을 때만 trigram. score≈0~110.';

GRANT EXECUTE ON FUNCTION public.normalize_poi_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_poi(text, text, double precision, double precision, int) TO authenticated;

COMMIT;
