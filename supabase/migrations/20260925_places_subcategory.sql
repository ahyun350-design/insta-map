-- places.subcategory: Kakao path–derived fine category (nullable; absent is normal)
ALTER TABLE public.places
  ADD COLUMN IF NOT EXISTS subcategory text;

COMMENT ON COLUMN public.places.subcategory IS
  'Fine category under places.category (Kakao L2/L3). Null when unmatched or conflicting with parent category.';
