-- 큐레이션 v2 3단계: 사진별 장소 태그 (photo_place_tags)
ALTER TABLE public.feed_posts
  ADD COLUMN IF NOT EXISTS photo_place_tags jsonb;

-- 형식 (참고용 코멘트, CHECK 제약은 일단 안 걸음 - 유연성 위해):
-- [
--   {
--     "photoIndex": 0,
--     "placeId": "uuid",
--     "placeName": "장소명",
--     "address": "주소",
--     "category": "맛집"|"카페"|"쇼핑"|"숙소"|"놀거리"|"여행지",
--     "lat": 37.5,
--     "lng": 127.0,
--     "x": 0.5,
--     "y": 0.7
--   },
--   ...
-- ]
-- x, y: 사진 위 좌표 (0.0 ~ 1.0, 사진 너비·높이 비율)
-- 기존 row는 NULL → "대표 장소" 폴백 표시
