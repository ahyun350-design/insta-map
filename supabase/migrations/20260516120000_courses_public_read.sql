-- 코스 공유: 인증된 사용자는 모든 코스 SELECT 가능 (INSERT/UPDATE/DELETE는 기존 본인 정책 유지)
DROP POLICY IF EXISTS "courses_select_own" ON public.courses;

CREATE POLICY "courses_select_authenticated" ON public.courses
  FOR SELECT USING (auth.uid() IS NOT NULL);
