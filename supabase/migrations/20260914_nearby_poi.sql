-- Distance-ordered nearby POI fetch (replaces client .limit(250) without ORDER BY).
-- bbox prefilter uses (lat,lng) index → haversine → ORDER BY dist → LIMIT.

BEGIN;

CREATE OR REPLACE FUNCTION public.nearby_poi(
  origin_lat double precision,
  origin_lng double precision,
  radius_m double precision DEFAULT 300,
  max_results integer DEFAULT 100,
  filter_source text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  name text,
  name_norm text,
  lat double precision,
  lng double precision,
  road_address text,
  jibun_address text,
  category text,
  source text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      origin_lat AS olat,
      origin_lng AS olng,
      GREATEST(coalesce(radius_m, 300), 1)::double precision AS r_m,
      GREATEST(1, LEAST(coalesce(max_results, 100), 500))::int AS lim,
      nullif(btrim(coalesce(filter_source, '')), '') AS src,
      -- bbox pad in degrees (index-friendly); ~111320 m per deg lat
      (GREATEST(coalesce(radius_m, 300), 1) / 111320.0) AS dlat,
      (GREATEST(coalesce(radius_m, 300), 1)
        / (111320.0 * GREATEST(cos(radians(origin_lat)), 0.01))) AS dlng
  ),
  cand AS (
    SELECT
      p.id,
      p.name,
      p.name_norm,
      p.lat,
      p.lng,
      p.road_address,
      p.jibun_address,
      p.category,
      p.source,
      (
        6371000.0 * 2.0 * asin(least(1.0, sqrt(
          power(sin(radians(p.lat - pr.olat) / 2.0), 2) +
          cos(radians(pr.olat)) * cos(radians(p.lat)) *
          power(sin(radians(p.lng - pr.olng) / 2.0), 2)
        )))
      ) AS dist_m
    FROM public.poi p
    CROSS JOIN params pr
    WHERE p.lat IS NOT NULL
      AND p.lng IS NOT NULL
      AND p.lat BETWEEN pr.olat - pr.dlat AND pr.olat + pr.dlat
      AND p.lng BETWEEN pr.olng - pr.dlng AND pr.olng + pr.dlng
      AND (pr.src IS NULL OR p.source = pr.src)
  )
  SELECT
    c.id,
    c.name,
    c.name_norm,
    c.lat,
    c.lng,
    c.road_address,
    c.jibun_address,
    c.category,
    c.source
  FROM cand c
  CROSS JOIN params pr
  WHERE c.dist_m <= pr.r_m
  ORDER BY c.dist_m ASC, c.id ASC
  LIMIT (SELECT lim FROM params);
$$;

COMMENT ON FUNCTION public.nearby_poi(double precision, double precision, double precision, integer, text) IS
  'Nearby POI by haversine distance. bbox-prefilter + ORDER BY dist + LIMIT. Optional filter_source for facility routing.';

GRANT EXECUTE ON FUNCTION public.nearby_poi(double precision, double precision, double precision, integer, text)
  TO authenticated, service_role;

COMMIT;
