CREATE OR REPLACE FUNCTION public.get_public_place_list(p_list_id uuid)
RETURNS TABLE (
  id uuid,
  title text,
  color text,
  place_count bigint,
  owner_username text
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
    ) AS place_count,
    u.username AS owner_username
  FROM public.place_lists l
  -- users.id is text; place_lists.user_id is uuid
  INNER JOIN public.users u ON u.id = l.user_id::text
  WHERE l.id = p_list_id
    AND l.is_public = true;
$$;

REVOKE ALL ON FUNCTION public.get_public_place_list(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_place_list(uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.get_public_place_list(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_public_place_lists(uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.get_public_place_list_places(uuid) TO anon;
