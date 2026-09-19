-- place_lists.color: folder pin/UI preset id (null = category fallback)
-- Apply manually in Supabase SQL editor / CLI.

BEGIN;

ALTER TABLE public.place_lists
  ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE public.place_lists
  DROP CONSTRAINT IF EXISTS place_lists_color_preset;

ALTER TABLE public.place_lists
  ADD CONSTRAINT place_lists_color_preset
  CHECK (
    color IS NULL
    OR color IN (
      'coral',
      'orange',
      'yellow',
      'lime',
      'green',
      'sky',
      'violet',
      'pink',
      'slate'
    )
  );

COMMENT ON COLUMN public.place_lists.color IS
  'List folder color preset id; null keeps category pin colors.';

COMMIT;
