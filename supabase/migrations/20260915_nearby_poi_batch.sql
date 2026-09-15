-- Batch nearby POI for rematch (many origins → one RPC).
-- Does NOT replace nearby_poi (app realtime still uses the single-origin fn).
--
-- Returns ONE row per origin with pois jsonb[] to stay under PostgREST max-rows
-- (flat 50×100 would truncate at ~1000 and change rematch results).

BEGIN;

DROP FUNCTION IF EXISTS public.nearby_poi_batch(jsonb, integer);

CREATE OR REPLACE FUNCTION public.nearby_poi_batch(
  origins jsonb,
  max_results_per integer DEFAULT 100
)
RETURNS TABLE (
  origin_id text,
  pois jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH o AS (
    SELECT
      (e->>'id')::text AS oid,
      (e->>'lat')::double precision AS olat,
      (e->>'lng')::double precision AS olng,
      GREATEST(coalesce((e->>'radius_m')::double precision, 300), 1)::double precision AS r_m,
      nullif(btrim(coalesce(e->>'filter_source', '')), '') AS src,
      GREATEST(1, LEAST(coalesce(max_results_per, 100), 500))::int AS lim,
      (GREATEST(coalesce((e->>'radius_m')::double precision, 300), 1) / 111320.0) AS dlat,
      (
        GREATEST(coalesce((e->>'radius_m')::double precision, 300), 1)
        / (111320.0 * GREATEST(cos(radians((e->>'lat')::double precision)), 0.01))
      ) AS dlng
    FROM jsonb_array_elements(coalesce(origins, '[]'::jsonb)) AS e
    WHERE (e->>'id') IS NOT NULL
      AND (e->>'lat') IS NOT NULL
      AND (e->>'lng') IS NOT NULL
  )
  SELECT
    o.oid AS origin_id,
    coalesce((
      SELECT jsonb_agg(to_jsonb(x) - 'dist_m' ORDER BY x.dist_m ASC, x.id ASC)
      FROM (
        SELECT
          c.id,
          c.name,
          c.name_norm,
          c.lat,
          c.lng,
          c.road_address,
          c.jibun_address,
          c.category,
          c.source,
          c.dist_m
        FROM (
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
                power(sin(radians(p.lat - o.olat) / 2.0), 2) +
                cos(radians(o.olat)) * cos(radians(p.lat)) *
                power(sin(radians(p.lng - o.olng) / 2.0), 2)
              )))
            ) AS dist_m
          FROM public.poi p
          WHERE p.lat IS NOT NULL
            AND p.lng IS NOT NULL
            AND p.lat BETWEEN o.olat - o.dlat AND o.olat + o.dlat
            AND p.lng BETWEEN o.olng - o.dlng AND o.olng + o.dlng
            AND (o.src IS NULL OR p.source = o.src)
        ) c
        WHERE c.dist_m <= o.r_m
        ORDER BY c.dist_m ASC, c.id ASC
        LIMIT o.lim
      ) x
    ), '[]'::jsonb) AS pois
  FROM o;
$$;

COMMENT ON FUNCTION public.nearby_poi_batch(jsonb, integer) IS
  'Batch nearby_poi for rematch. origins: [{id, lat, lng, radius_m?, filter_source?}]. One row per origin; pois jsonb array (same fields as nearby_poi), distance-ordered, limited.';

GRANT EXECUTE ON FUNCTION public.nearby_poi_batch(jsonb, integer)
  TO authenticated, service_role;

COMMIT;
