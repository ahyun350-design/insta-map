-- User-edited place categories must not be overwritten by reclassify batches.
ALTER TABLE public.places
  ADD COLUMN IF NOT EXISTS category_edited_by_user boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.places.category_edited_by_user IS
  'true when the user manually set places.category; reclassify scripts must skip these rows';
