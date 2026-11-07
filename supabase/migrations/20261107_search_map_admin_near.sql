-- D-2 near: search_map_admin — chain names rank by distance (nearby stores first).
-- CREATE OR REPLACE FUNCTION only. No table / index change. Uses existing indexes only:
--   sangga_places_name_btree (name text_pattern_ops), sangga_places_point_gist, sangga_places_name_trgm,
--   map_search_catalog_name_norm_btree / _trgm.
--
-- Chain = a name variant registered as exactly that 상호 by >= 10 shops (빽다방 107, 이디야 189;
-- 망원 0, 홍대 4, 코엑스 2). Non-chain queries take the current path unchanged.
--
-- sangga_places rows read per call, chain path (hard caps, one chain variant per call):
--   chain probe    : <= 10 index entries per name variant (index-only, <= 3 variants) -> 30
--   range probe    : <= 3001 index entries (index-only) for the chain variant         -> 3001
--   chain scan     : <= 3000 rows (name btree range, LIMIT) when the range fits         -> 3000
--   range overflow : <= 1500 rows nearest the anchor (point gist KNN, LIMIT)
--                    + <= 20 exact-name rows nationwide (name btree, LIMIT)            -> 1520
-- Other variants / non-chain queries: current s_local / s_global (LIMIT 20 each) and the
-- trigram typo fallback, unchanged.
-- Catalog (관광·랜드마크·역·동·구·시) rows with an exact or prefix match stay in the result
-- even when many nearby chain-tier shops score the same.
-- Run as one statement.

CREATE OR REPLACE FUNCTION public.search_map_admin(p_q text, p_lat double precision, p_lng double precision, p_limit integer)
RETURNS TABLE (id text, name text, branch text, category text, address text, floor text, lat double precision, lng double precision, dist_m double precision, score double precision, source text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
SET plan_cache_mode = force_custom_plan
SET enable_seqscan = off
AS $$
DECLARE
  q text;
  qn text;
  lim integer;
  toks text[];
  n integer;
  last_tok text;
  name_part text;
  name_n text;
  area_tok text;
  area_lat double precision;
  area_lng double precision;
  c_lat double precision;
  c_lng double precision;
  vars text[];
  vv text;
  probe integer;
  chain_v text;
  chain_overflow boolean := false;
  other_vars text[] := ARRAY[]::text[];
  hi constant text := chr(1114111);
  dlat constant double precision := 0.008;
  dlng constant double precision := 0.010;
  punct constant text := '[[:space:]·.,''"\-_/()]+';
  chain_min_exact constant integer := 10;
  chain_scan_cap constant integer := 3000;
  chain_keep constant integer := 40;
  knn_cap constant integer := 1500;
BEGIN
  q := left(btrim(regexp_replace(coalesce(p_q, ''), '[[:space:]]+', ' ', 'g')), 40);
  qn := lower(regexp_replace(q, punct, '', 'g'));
  IF char_length(qn) < 2 THEN
    RETURN;
  END IF;
  IF qn ~ '역$' AND char_length(qn) > 2 THEN
    qn := left(qn, -1);
  END IF;
  lim := GREATEST(1, LEAST(coalesce(p_limit, 8), 20));
  toks := regexp_split_to_array(q, ' ');
  n := coalesce(array_length(toks, 1), 1);
  name_part := q;

  IF n >= 2 THEN
    last_tok := lower(regexp_replace(toks[n], punct, '', 'g'));
    IF last_tok ~ '역$' AND char_length(last_tok) > 2 THEN
      last_tok := left(last_tok, -1);
    END IF;
    IF char_length(last_tok) >= 2 THEN
      SELECT c.lat, c.lng INTO area_lat, area_lng
      FROM public.map_search_catalog c
      WHERE c.source IN ('station', 'dong', 'gu', 'si')
        AND c.name_norm ~>=~ last_tok
        AND c.name_norm ~<~ (last_tok || hi)
        AND char_length(c.name_norm) <= char_length(last_tok) + 2
      ORDER BY (c.name_norm = last_tok) DESC,
        (c.name_norm = last_tok || '동') DESC,
        CASE WHEN p_lat IS NULL OR p_lng IS NULL THEN 0 ELSE abs(c.lat - p_lat) + abs(c.lng - p_lng) END
      LIMIT 1;
      IF area_lat IS NOT NULL THEN
        area_tok := last_tok;
        name_part := array_to_string(toks[1:n - 1], ' ');
      END IF;
    END IF;
  END IF;

  name_n := lower(regexp_replace(name_part, punct, '', 'g'));
  IF char_length(name_n) < 1 THEN
    name_n := qn;
  END IF;
  c_lat := coalesce(area_lat, p_lat);
  c_lng := coalesce(area_lng, p_lng);

  vars := ARRAY(
    SELECT u.v
    FROM unnest(ARRAY[
      replace(name_part, ' ', ''),
      CASE WHEN position(' ' IN name_part) > 0 THEN name_part END,
      CASE WHEN name_part ~ '[A-Z]' THEN lower(replace(name_part, ' ', '')) END,
      CASE WHEN name_part ~ '[a-z]' THEN upper(replace(name_part, ' ', '')) END,
      CASE WHEN name_part ~ '[A-Za-z]' THEN initcap(replace(name_part, ' ', '')) END
    ]) WITH ORDINALITY AS u(v, o)
    WHERE u.v IS NOT NULL AND char_length(u.v) >= 2
    GROUP BY u.v
    ORDER BY min(u.o)
    LIMIT 3
  );

  -- Chain = first variant registered as exactly that 상호 by >= chain_min_exact shops.
  FOREACH vv IN ARRAY vars LOOP
    probe := 0;
    IF chain_v IS NULL THEN
      SELECT count(*) INTO probe
      FROM (
        SELECT 1 FROM public.sangga_places s
        WHERE s.name ~>=~ vv AND s.name ~<=~ vv
        LIMIT chain_min_exact
      ) t;
    END IF;
    IF probe >= chain_min_exact THEN
      chain_v := vv;
    ELSE
      other_vars := other_vars || vv;
    END IF;
  END LOOP;
  IF chain_v IS NOT NULL THEN
    SELECT count(*) > chain_scan_cap INTO chain_overflow
    FROM (
      SELECT 1 FROM public.sangga_places s
      WHERE s.name ~>=~ chain_v AND s.name ~<~ (chain_v || hi)
      LIMIT chain_scan_cap + 1
    ) t;
  END IF;

  PERFORM set_config('pg_trgm.similarity_threshold', '0.3', true);

  RETURN QUERY
  WITH v AS (
    SELECT x.v FROM unnest(other_vars) AS x(v)
  ),
  s_local AS (
    SELECT y.*
    FROM v
    CROSS JOIN LATERAL (
      SELECT s.bizes_id, s.name, s.branch, s.poi_class, s.ind_s_name, s.road_address, s.floor, s.lat, s.lng
      FROM public.sangga_places s
      WHERE c_lat IS NOT NULL
        AND s.name ~>=~ v.v
        AND s.name ~<~ (v.v || hi)
        AND point(s.lng, s.lat) <@ box(point(c_lng - dlng, c_lat - dlat), point(c_lng + dlng, c_lat + dlat))
      LIMIT 20
    ) y
  ),
  s_global AS (
    SELECT y.*
    FROM v
    CROSS JOIN LATERAL (
      SELECT s.bizes_id, s.name, s.branch, s.poi_class, s.ind_s_name, s.road_address, s.floor, s.lat, s.lng
      FROM public.sangga_places s
      WHERE s.name ~>=~ v.v
        AND s.name ~<~ (v.v || hi)
      LIMIT 20
    ) y
  ),
  s_chain_raw AS MATERIALIZED (
    SELECT s.bizes_id, s.name, s.branch, s.poi_class, s.ind_s_name, s.road_address, s.floor, s.lat, s.lng
    FROM public.sangga_places s
    WHERE chain_v IS NOT NULL
      AND NOT chain_overflow
      AND s.name ~>=~ chain_v
      AND s.name ~<~ (chain_v || hi)
    LIMIT chain_scan_cap
  ),
  s_chain AS (
    SELECT r.*
    FROM s_chain_raw r
    ORDER BY CASE WHEN c_lat IS NULL OR c_lng IS NULL THEN 0
      ELSE power(r.lat - c_lat, 2) + power((r.lng - c_lng) * cos(radians(c_lat)), 2) END
    LIMIT chain_keep
  ),
  s_knn AS (
    SELECT y.*
    FROM (
      SELECT s.bizes_id, s.name, s.branch, s.poi_class, s.ind_s_name, s.road_address, s.floor, s.lat, s.lng
      FROM public.sangga_places s
      WHERE chain_v IS NOT NULL
        AND chain_overflow
        AND c_lat IS NOT NULL
        AND point(s.lng, s.lat) <@ box(point(c_lng - dlng, c_lat - dlat), point(c_lng + dlng, c_lat + dlat))
      ORDER BY point(s.lng, s.lat) <-> point(c_lng, c_lat)
      LIMIT knn_cap
    ) y
    WHERE y.name ~>=~ chain_v AND y.name ~<~ (chain_v || hi)
  ),
  s_chain_exact AS (
    SELECT s.bizes_id, s.name, s.branch, s.poi_class, s.ind_s_name, s.road_address, s.floor, s.lat, s.lng
    FROM public.sangga_places s
    WHERE chain_v IS NOT NULL
      AND chain_overflow
      AND s.name ~>=~ chain_v
      AND s.name ~<=~ chain_v
    LIMIT 20
  ),
  s_pre AS (
    SELECT * FROM s_local
    UNION
    SELECT * FROM s_global
    UNION
    SELECT * FROM s_chain
    UNION
    SELECT * FROM s_knn
    UNION
    SELECT * FROM s_chain_exact
  ),
  s_trgm_local AS (
    SELECT s.bizes_id, s.name, s.branch, s.poi_class, s.ind_s_name, s.road_address, s.floor, s.lat, s.lng
    FROM public.sangga_places s
    WHERE (SELECT count(*) FROM s_pre) < 3
      AND c_lat IS NOT NULL
      AND char_length(name_n) >= 3
      AND s.name % name_n
      AND point(s.lng, s.lat) <@ box(point(c_lng - dlng, c_lat - dlat), point(c_lng + dlng, c_lat + dlat))
    LIMIT 20
  ),
  s_trgm_global AS (
    SELECT s.bizes_id, s.name, s.branch, s.poi_class, s.ind_s_name, s.road_address, s.floor, s.lat, s.lng
    FROM public.sangga_places s
    WHERE (SELECT count(*) FROM s_pre) + (SELECT count(*) FROM s_trgm_local) < 3
      AND char_length(name_n) >= 3
      AND s.name % name_n
    LIMIT 20
  ),
  s_all AS (
    SELECT * FROM s_pre
    UNION
    SELECT * FROM s_trgm_local
    UNION
    SELECT * FROM s_trgm_global
  ),
  cat AS (
    SELECT c.id, c.source, c.name, c.name_norm, c.category, c.lat, c.lng
    FROM public.map_search_catalog c
    WHERE (c.name_norm ~>=~ qn AND c.name_norm ~<~ (qn || hi))
      OR (c.name_norm ~>=~ name_n AND c.name_norm ~<~ (name_n || hi))
      OR (char_length(qn) >= 3 AND c.name_norm % qn)
    LIMIT 30
  ),
  allc AS (
    SELECT s.bizes_id AS rid, s.name AS rname, s.branch AS rbranch,
      coalesce(s.poi_class, s.ind_s_name) AS rcat, s.road_address AS raddr, s.floor AS rfloor,
      s.lat AS rlat, s.lng AS rlng, 'sangga'::text AS rsrc,
      lower(regexp_replace(s.name, punct, '', 'g')) AS nn,
      lower(regexp_replace(coalesce(s.branch, ''), punct, '', 'g')) AS bn
    FROM s_all s
    UNION ALL
    SELECT c.id, c.name, NULL::text, c.category, NULL::text, NULL::text,
      c.lat, c.lng, c.source, c.name_norm, ''::text
    FROM cat c
  ),
  scored AS (
    SELECT a.*,
      CASE WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL::double precision
        ELSE 111320.0 * sqrt(power(a.rlat - p_lat, 2) + power((a.rlng - p_lng) * cos(radians(p_lat)), 2))
      END AS d_center,
      CASE WHEN c_lat IS NULL OR c_lng IS NULL THEN NULL::double precision
        ELSE 111320.0 * sqrt(power(a.rlat - c_lat, 2) + power((a.rlng - c_lng) * cos(radians(c_lat)), 2))
      END AS d_anchor
    FROM allc a
  ),
  ranked AS (
    SELECT z.*,
      (
        CASE
          WHEN z.nn = name_n OR z.nn = qn THEN 300.0
          -- Chain: "빽다방홍대 입구점" is the same chain as "빽다방" — same tier, distance decides.
          WHEN chain_v IS NOT NULL AND z.rsrc = 'sangga'
            AND (starts_with(z.nn, name_n) OR starts_with(z.nn, qn)) THEN 300.0
          WHEN z.nn || z.bn = name_n OR z.nn || z.bn = qn THEN 280.0
          WHEN starts_with(z.nn, name_n) OR starts_with(z.nn, qn) THEN 200.0
          WHEN starts_with(z.nn || z.bn, qn) THEN 180.0
          ELSE greatest(similarity(z.nn, name_n), similarity(z.nn || z.bn, qn)) * 100.0
        END
        + CASE
            WHEN area_tok IS NOT NULL AND position(area_tok IN z.bn) > 0 THEN 15.0
            WHEN area_tok IS NOT NULL AND z.d_anchor <= 800 THEN 15.0
            WHEN area_tok IS NOT NULL AND z.d_anchor <= 2000 THEN 8.0
            ELSE 0.0
          END
        + CASE WHEN z.d_anchor IS NULL THEN 0.0 ELSE greatest(0.0, 20.0 - z.d_anchor / 500.0) END
      )::double precision AS sc
    FROM scored z
  )
  SELECT r.rid, r.rname, r.rbranch, r.rcat, r.raddr, r.rfloor, r.rlat, r.rlng, r.d_center, r.sc, r.rsrc
  FROM ranked r
  WHERE r.sc >= 30
  ORDER BY (r.rsrc <> 'sangga' AND r.sc >= 290.0) DESC, r.sc DESC, r.d_center ASC NULLS LAST, r.rid ASC
  LIMIT lim;
END;
$$;
