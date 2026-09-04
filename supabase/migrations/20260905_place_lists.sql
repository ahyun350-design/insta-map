-- 내 목록 (place_lists) + 목록↔장소 다대다 (place_list_items)
-- places.id 는 PostgREST OpenAPI 기준 text (값은 uuid 형태여도 컬럼 타입은 text)
-- places.user_id 는 uuid — RLS 에서 p.user_id = auth.uid() 사용 가능
-- updated_at 자동 트리거: 이 레포 마이그레이션에 공통 패턴 없음 → 컬럼만 두고 앱에서 갱신

BEGIN;

CREATE TABLE IF NOT EXISTS public.place_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT place_lists_title_len CHECK (char_length(trim(title)) BETWEEN 1 AND 60)
);

CREATE TABLE IF NOT EXISTS public.place_list_items (
  list_id uuid NOT NULL REFERENCES public.place_lists(id) ON DELETE CASCADE,
  place_id text NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, place_id)
);

CREATE INDEX IF NOT EXISTS place_lists_user_id_idx
  ON public.place_lists (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS place_list_items_place_id_idx
  ON public.place_list_items (place_id);

CREATE INDEX IF NOT EXISTS place_list_items_list_sort_idx
  ON public.place_list_items (list_id, sort_order);

ALTER TABLE public.place_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_list_items ENABLE ROW LEVEL SECURITY;

-- place_lists: 본인만 CRUD
DROP POLICY IF EXISTS "place_lists_select_own" ON public.place_lists;
CREATE POLICY "place_lists_select_own" ON public.place_lists
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "place_lists_insert_own" ON public.place_lists;
CREATE POLICY "place_lists_insert_own" ON public.place_lists
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "place_lists_update_own" ON public.place_lists;
CREATE POLICY "place_lists_update_own" ON public.place_lists
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "place_lists_delete_own" ON public.place_lists;
CREATE POLICY "place_lists_delete_own" ON public.place_lists
  FOR DELETE
  USING (auth.uid() = user_id);

-- place_list_items: 목록 소유자만 + 본인 places 만 연결
DROP POLICY IF EXISTS "place_list_items_select_own" ON public.place_list_items;
CREATE POLICY "place_list_items_select_own" ON public.place_list_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.place_lists l
      WHERE l.id = list_id AND l.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "place_list_items_insert_own" ON public.place_list_items;
CREATE POLICY "place_list_items_insert_own" ON public.place_list_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.place_lists l
      WHERE l.id = list_id AND l.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.places p
      WHERE p.id = place_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "place_list_items_update_own" ON public.place_list_items;
CREATE POLICY "place_list_items_update_own" ON public.place_list_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.place_lists l
      WHERE l.id = list_id AND l.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.place_lists l
      WHERE l.id = list_id AND l.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.places p
      WHERE p.id = place_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "place_list_items_delete_own" ON public.place_list_items;
CREATE POLICY "place_list_items_delete_own" ON public.place_list_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.place_lists l
      WHERE l.id = list_id AND l.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.place_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.place_list_items TO authenticated;

COMMIT;
