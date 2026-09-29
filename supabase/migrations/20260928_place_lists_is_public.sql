-- place_lists.is_public + SECURITY DEFINER RPCs for public list read
-- (No Korean comments: Supabase SQL editor can mis-parse non-ASCII in some clients.)

BEGIN;

ALTER TABLE public.place_lists
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.place_lists.is_public IS
  'When true, list metadata and places are readable via public RPCs (memo never exposed).';

CREATE INDEX IF NOT EXISTS place_lists_user_public_idx
  ON public.place_lists (user_id, created_at DESC)
  WHERE is_public = true;

-- Existing RLS unchanged:
--   place_lists / place_list_items remain owner-only via place_lists_*_own / place_list_items_*_own.
-- Public reads go only through the DEFINER functions below (no new SELECT policies).

CREATE OR REPLACE FUNCTION public.get_public_place_lists(p_owner_id uuid)
RETURNS TABLE (
  id uuid,
  title text,
  color text,
  place_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.title,
    l.color,
    (
      SELECT count(*)::bigint
      FROM public.place_list_items i
      WHERE i.list_id = l.id
    ) AS place_count
  FROM public.place_lists l
  WHERE l.user_id = p_owner_id
    AND l.is_public = true
  ORDER BY l.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_public_place_list_places(p_list_id uuid)
RETURNS TABLE (
  place_id text,
  name text,
  address text,
  lat double precision,
  lng double precision,
  category text,
  subcategory text,
  list_color text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS place_id,
    p.name,
    p.address,
    p.lat,
    p.lng,
    p.category,
    p.subcategory,
    l.color AS list_color
  FROM public.place_lists l
  INNER JOIN public.place_list_items i ON i.list_id = l.id
  INNER JOIN public.places p ON p.id = i.place_id
  WHERE l.id = p_list_id
    AND l.is_public = true
  ORDER BY i.sort_order ASC, i.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_place_lists(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_place_list_places(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_place_lists(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_place_list_places(uuid) TO authenticated;

COMMIT;
