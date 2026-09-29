-- Allow anonymous public-list funnel events (user_id null).
-- Logged-in rows still reference auth.users; anon rows use null + meta.list_id.
ALTER TABLE public.user_events
  ALTER COLUMN user_id DROP NOT NULL;
