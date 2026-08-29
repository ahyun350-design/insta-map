-- 사용자 행동 이벤트 로그
CREATE TABLE IF NOT EXISTS public.user_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_events_user_created_idx
  ON public.user_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_events_event_created_idx
  ON public.user_events (event, created_at DESC);

ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;

-- insert: 본인 이벤트만 기록
DROP POLICY IF EXISTS "user_events_insert_own" ON public.user_events;
CREATE POLICY "user_events_insert_own" ON public.user_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- select: 관리자만 전체 조회 (일반 사용자는 본인 것도 불가)
DROP POLICY IF EXISTS "user_events_select_own" ON public.user_events;
DROP POLICY IF EXISTS "user_events_select_admin" ON public.user_events;
CREATE POLICY "user_events_select_admin" ON public.user_events
  FOR SELECT TO authenticated
  USING (auth.uid() = '63772749-e01b-4396-a41c-c17a4d3acfe6'::uuid);
