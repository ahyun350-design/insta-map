-- O-1: 닉네임 변경 시 캐시 컬럼 일괄 동기화 (RPC)
-- 적용: Supabase SQL Editor에서 실행하거나 supabase db push / 로컬 마이그레이션으로 반영
--
-- 전제
--   - public.users(id, username) — username UNIQUE
--   - public.feed_posts(user_id, user_name, likes, ...)
--   - public.comments(user_id, user_name, ...)
--   - public.notifications(actor_id, actor_username, ...)
--
-- likes 컬럼 타입
--   - 이 마이그레이션은 PostgreSQL text[] 기준입니다.
--   - DB가 jsonb 배열이면 마이그레이션 하단 주석의 대체 UPDATE 블록을 사용하세요.

CREATE OR REPLACE FUNCTION public.rename_user_username(
  p_user_id uuid,
  p_old_username text,
  p_new_username text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_new text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized'
      USING ERRCODE = '42501';
  END IF;

  v_new := trim(p_new_username);
  IF v_new IS NULL OR v_new = '' THEN
    RAISE EXCEPTION 'invalid username'
      USING ERRCODE = '23514';
  END IF;

  SELECT u.username INTO v_old
  FROM public.users u
  WHERE u.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_old IS NULL THEN
    RAISE EXCEPTION 'user not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF trim(p_old_username) IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'current username does not match'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_old = v_new THEN
    RETURN;
  END IF;

  UPDATE public.users
  SET username = v_new
  WHERE id = p_user_id;

  UPDATE public.feed_posts
  SET user_name = v_new
  WHERE user_id = p_user_id;

  UPDATE public.comments
  SET user_name = v_new
  WHERE user_id = p_user_id;

  UPDATE public.notifications
  SET actor_username = v_new
  WHERE actor_id = p_user_id;

  -- 내 글이 아닌 타인 글의 likes 배열에 내 옛 닉이 들어 있는 경우까지 갱신
  UPDATE public.feed_posts fp
  SET likes = array_replace(fp.likes, v_old, v_new)
  WHERE v_old = ANY (fp.likes);
END;
$$;

REVOKE ALL ON FUNCTION public.rename_user_username(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_user_username(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.rename_user_username(uuid, text, text) IS
  'Renames user and syncs feed_posts.user_name, comments.user_name, notifications.actor_username, feed_posts.likes (text[]). Caller must be p_user_id.';

-- ---------------------------------------------------------------------------
-- 만약 feed_posts.likes 가 jsonb 배열(예: ["a","b"])이면, 위 함수 본문의
-- array_replace / ANY 블록을 아래로 교체하세요.
--
--   UPDATE public.feed_posts fp
--   SET likes = (
--     SELECT COALESCE(
--       jsonb_agg(
--         CASE
--           WHEN jsonb_typeof(elem) = 'string' AND elem #>> '{}' = v_old
--             THEN to_jsonb(v_new)
--           ELSE elem
--         END
--       ),
--       '[]'::jsonb
--     )
--     FROM jsonb_array_elements(fp.likes) AS elem
--   )
--   WHERE jsonb_typeof(fp.likes) = 'array'
--     AND fp.likes @> to_jsonb(v_old);
