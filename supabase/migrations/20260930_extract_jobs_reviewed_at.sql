-- extract_jobs.reviewed_at — extract complete review dismissed/confirmed (server source of truth)
-- ★ Run in SQL Editor; do not apply from app code.

ALTER TABLE public.extract_jobs
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

COMMENT ON COLUMN public.extract_jobs.reviewed_at IS
  'When user dismissed or confirmed the extract review overlay; NULL = not reviewed yet';

CREATE INDEX IF NOT EXISTS extract_jobs_pending_review_idx
  ON public.extract_jobs (user_id, completed_at DESC NULLS LAST)
  WHERE status = 'completed' AND reviewed_at IS NULL;
