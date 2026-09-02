-- 가입 실패 orphan 복구: auth.users 는 있고 public.users 없는 7명
-- 실행 전: 닉 충돌 시 아래 assigned 값 기준 (2026-09-03 조회)
-- ON CONFLICT (id) DO NOTHING — 이미 복구된 행은 건너뜀

INSERT INTO public.users (id, username)
VALUES
  ('ec3dcd4b-8916-400a-8030-954039c7e352', '재어니2'),  -- meta: 재어니
  ('b5f3a47a-0262-4acd-bb8d-0be4d7d6681f', '겨울2'),    -- meta: 겨울
  ('9da71aa1-14f5-4653-8b64-5790bf056b17', 'Doyeon2'), -- meta: Doyeon
  ('3c70c0a1-cf30-4da7-a5b8-d509f2cf10b2', 'daye0n2'), -- meta: daye0n
  ('db74c9f2-78aa-4c2c-82b5-013488d511ce', '지원2'),   -- meta: 지원
  ('ce2c2bbe-693d-43e2-8f56-89e1d48b84c7', '지원3'),   -- meta: 지원
  ('bcdacf3a-920f-4a82-a550-68c7623c7c5f', '태훈')     -- meta: 태훈 (충돌 없음)
ON CONFLICT (id) DO NOTHING;

-- 검증
-- SELECT u.id, u.username, a.email
-- FROM public.users u
-- JOIN auth.users a ON a.id = u.id
-- WHERE u.id IN (
--   'ec3dcd4b-8916-400a-8030-954039c7e352',
--   'b5f3a47a-0262-4acd-bb8d-0be4d7d6681f',
--   '9da71aa1-14f5-4653-8b64-5790bf056b17',
--   '3c70c0a1-cf30-4da7-a5b8-d509f2cf10b2',
--   'db74c9f2-78aa-4c2c-82b5-013488d511ce',
--   'ce2c2bbe-693d-43e2-8f56-89e1d48b84c7',
--   'bcdacf3a-920f-4a82-a550-68c7623c7c5f'
-- );
