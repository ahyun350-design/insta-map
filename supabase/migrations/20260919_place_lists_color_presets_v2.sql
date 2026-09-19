-- place_lists.color: Pantone TCX preset ids (replace coral…slate)
-- Apply manually in Supabase SQL editor / CLI.
-- Order matters: UPDATE old ids FIRST, then replace CHECK.

BEGIN;

-- 1) Remap existing preset ids → new palette
UPDATE public.place_lists
SET color = CASE color
  WHEN 'coral'  THEN 'sunOrange'
  WHEN 'orange' THEN 'sunOrange'
  WHEN 'yellow' THEN 'peach'
  WHEN 'lime'   THEN 'foliage'
  WHEN 'green'  THEN 'spring'
  WHEN 'sky'    THEN 'persian'
  WHEN 'violet' THEN 'violet'
  WHEN 'pink'   THEN 'beetroot'
  WHEN 'slate'  THEN 'windward'
  ELSE color
END
WHERE color IN (
  'coral', 'orange', 'yellow', 'lime', 'green',
  'sky', 'violet', 'pink', 'slate'
);

-- 2) Replace CHECK with new ids (after UPDATE)
ALTER TABLE public.place_lists
  DROP CONSTRAINT IF EXISTS place_lists_color_preset;

ALTER TABLE public.place_lists
  ADD CONSTRAINT place_lists_color_preset
  CHECK (
    color IS NULL
    OR color IN (
      'sunOrange',
      'beetroot',
      'peach',
      'foliage',
      'spring',
      'bronze',
      'persian',
      'windward',
      'violet'
    )
  );

COMMENT ON COLUMN public.place_lists.color IS
  'List folder color preset id (Pantone TCX set); null keeps category pin colors.';

-- Speeds DISTINCT ON (place_id) … ORDER BY created_at DESC for representative color
CREATE INDEX IF NOT EXISTS place_list_items_place_created_idx
  ON public.place_list_items (place_id, created_at DESC);

-- One row per place: most recent place_list_items.created_at wins
CREATE OR REPLACE FUNCTION public.place_representative_list_colors(p_user_id uuid)
RETURNS TABLE(place_id uuid, color text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (pli.place_id)
    pli.place_id,
    pl.color
  FROM public.place_list_items pli
  INNER JOIN public.place_lists pl ON pl.id = pli.list_id
  WHERE pl.user_id = p_user_id
  ORDER BY pli.place_id, pli.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.place_representative_list_colors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_representative_list_colors(uuid) TO authenticated;

COMMIT;
