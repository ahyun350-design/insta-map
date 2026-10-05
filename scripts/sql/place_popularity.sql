-- place_popularity: aggregated save counts for "discover" (draft; apply manually)
-- No Korean comments. No BEGIN/COMMIT. Run statements one-by-one.
-- Rollback block is at the bottom (commented out).

CREATE TABLE public.place_popularity (
  poi_id bigint PRIMARY KEY,
  user_count integer NOT NULL,
  display_name text NOT NULL,
  category text,
  lat double precision,
  lng double precision,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.refresh_place_popularity()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
BEGIN
  TRUNCATE TABLE public.place_popularity;
  INSERT INTO public.place_popularity (poi_id, user_count, display_name, category, lat, lng, updated_at)
  WITH eligible AS (
    SELECT p.poi_id, count(DISTINCT p.user_id)::integer AS user_count
    FROM public.places p
    INNER JOIN public.poi poi ON poi.id = p.poi_id
    WHERE p.poi_id IS NOT NULL
      AND poi.closed_at IS NULL
    GROUP BY p.poi_id
    HAVING count(DISTINCT p.user_id) >= 3
  ),
  name_votes AS (
    SELECT p.poi_id, p.name AS place_name, count(*)::integer AS name_n, length(p.name) AS name_len
    FROM public.places p
    INNER JOIN eligible e ON e.poi_id = p.poi_id
    WHERE coalesce(btrim(p.name), '') <> ''
    GROUP BY p.poi_id, p.name
  ),
  best_name AS (
    SELECT DISTINCT ON (nv.poi_id) nv.poi_id, nv.place_name
    FROM name_votes nv
    ORDER BY nv.poi_id, nv.name_n DESC, nv.name_len ASC, nv.place_name ASC
  )
  SELECT
    e.poi_id,
    e.user_count,
    coalesce(b.place_name, poi.name, '') AS display_name,
    poi.category,
    poi.lat,
    poi.lng,
    now() AS updated_at
  FROM eligible e
  INNER JOIN public.poi poi ON poi.id = e.poi_id
  LEFT JOIN best_name b ON b.poi_id = e.poi_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_place_popularity() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.refresh_place_popularity() FROM anon;

REVOKE ALL ON FUNCTION public.refresh_place_popularity() FROM authenticated;

ALTER TABLE public.place_popularity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.place_popularity FROM PUBLIC;

REVOKE ALL ON TABLE public.place_popularity FROM anon;

GRANT SELECT ON TABLE public.place_popularity TO authenticated;

CREATE POLICY place_popularity_select_authenticated ON public.place_popularity FOR SELECT TO authenticated USING (true);

SELECT cron.schedule('refresh-place-popularity-daily', '0 20 * * *', $cron$SELECT public.refresh_place_popularity();$cron$);

SELECT public.refresh_place_popularity();

SELECT count(*), min(user_count), max(user_count) FROM public.place_popularity;

-- ROLLBACK (run manually if needed; do not run with apply statements above)
-- SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'refresh-place-popularity-daily';
-- DROP FUNCTION IF EXISTS public.refresh_place_popularity();
-- DROP TABLE IF EXISTS public.place_popularity;
