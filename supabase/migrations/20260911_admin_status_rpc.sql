-- admin status card: 단일 RPC로 집계 (PostgREST 다중 round-trip / 1000행 페이징 제거)

CREATE OR REPLACE FUNCTION public.admin_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_start timestamptz;
  week_ago timestamptz;
  stuck_before timestamptz;
  today_success bigint;
  today_failed bigint;
  week_success bigint;
  week_failed bigint;
  week_decided bigint;
  success_rate numeric;
  last_success_at timestamptz;
  stuck_jobs bigint;
  signups_today bigint;
  signups_total bigint;
  active_users_7d bigint;
  user_events_est bigint;
  today_places_poi bigint;
  today_places_total bigint;
  poi_rate numeric;
  recent jsonb;
BEGIN
  -- KST 오늘 00:00 (앱 kstTodayStartIso 와 동일)
  today_start := (timezone('Asia/Seoul', now())::date)::timestamp
                 AT TIME ZONE 'Asia/Seoul';
  week_ago := now() - interval '7 days';
  stuck_before := now() - interval '10 minutes';

  SELECT count(*) INTO today_success
  FROM extract_jobs
  WHERE status = 'completed' AND created_at >= today_start;

  SELECT count(*) INTO today_failed
  FROM extract_jobs
  WHERE status = 'failed' AND created_at >= today_start;

  SELECT count(*) INTO week_success
  FROM extract_jobs
  WHERE status = 'completed' AND created_at >= week_ago;

  SELECT count(*) INTO week_failed
  FROM extract_jobs
  WHERE status = 'failed' AND created_at >= week_ago;

  week_decided := week_success + week_failed;
  success_rate := CASE
    WHEN week_decided = 0 THEN 0
    ELSE round((week_success::numeric / week_decided) * 1000) / 10
  END;

  SELECT coalesce(completed_at, updated_at) INTO last_success_at
  FROM extract_jobs
  WHERE status = 'completed'
  ORDER BY completed_at DESC NULLS LAST
  LIMIT 1;

  SELECT count(*) INTO stuck_jobs
  FROM extract_jobs
  WHERE status IN ('pending', 'processing')
    AND updated_at < stuck_before;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'error_message', error_message,
        'at', coalesce(updated_at, created_at)
      )
      ORDER BY updated_at DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO recent
  FROM (
    SELECT error_message, updated_at, created_at
    FROM extract_jobs
    WHERE status = 'failed'
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 3
  ) f;

  SELECT count(*) INTO signups_today
  FROM users
  WHERE created_at >= today_start;

  SELECT count(*) INTO signups_total FROM users;

  SELECT count(*) INTO active_users_7d
  FROM (
    SELECT user_id::text AS uid FROM places
      WHERE created_at >= week_ago AND user_id IS NOT NULL
    UNION
    SELECT user_id::text FROM courses
      WHERE created_at >= week_ago AND user_id IS NOT NULL
    UNION
    SELECT sender_id::text FROM messages
      WHERE created_at >= week_ago AND sender_id IS NOT NULL
    UNION
    SELECT user_id::text FROM likes
      WHERE created_at >= week_ago AND user_id IS NOT NULL
  ) u;

  -- 이벤트 로그: 판단용 아님 → pg_class 추정 (정확한 count 비용 회피)
  SELECT greatest(0, round(c.reltuples)::bigint)
  INTO user_events_est
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'user_events';

  IF user_events_est IS NULL THEN
    user_events_est := 0;
  END IF;

  SELECT count(*) INTO today_places_poi
  FROM places
  WHERE source = 'poi' AND created_at >= today_start;

  SELECT count(*) INTO today_places_total
  FROM places
  WHERE created_at >= today_start;

  poi_rate := CASE
    WHEN today_places_total = 0 THEN NULL
    ELSE round((today_places_poi::numeric / today_places_total) * 1000) / 10
  END;

  RETURN jsonb_build_object(
    'today', jsonb_build_object(
      'attempts', today_success + today_failed,
      'success', today_success,
      'failed', today_failed
    ),
    'last7Days', jsonb_build_object(
      'attempts', week_decided,
      'success', week_success,
      'failed', week_failed,
      'successRate', success_rate
    ),
    'lastSuccessAt', last_success_at,
    'stuckJobs', stuck_jobs,
    'recentFailures', recent,
    'signups', jsonb_build_object(
      'today', signups_today,
      'total', signups_total
    ),
    'activeUsers7d', active_users_7d,
    'userEventsTotal', user_events_est,
    'userEventsEstimated', true,
    'todayPlaces', jsonb_build_object(
      'total', today_places_total,
      'poi', today_places_poi,
      'poiRate', poi_rate
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_status() TO service_role;
