-- 코스 공유 초대장 커스텀 이미지 (URL). NULL이면 기본 date-monkey.png
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS invite_image text;
