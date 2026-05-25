-- F-1a: 웹 코스 공유 페이지 — 비로그인(anon)에서 courses SELECT
-- INSERT/UPDATE/DELETE는 기존 본인 정책 유지
CREATE POLICY "courses_public_read" ON public.courses
  FOR SELECT
  TO anon
  USING (true);

NOTIFY pgrst, 'reload schema';
