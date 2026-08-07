import type { SupabaseClient } from "@supabase/supabase-js";

/** pending/processing 이 이 시간 이상이면 stale */
export const EXTRACT_STUCK_MS = 10 * 60 * 1000;

export const EXTRACT_TIMEOUT_ERROR = "timeout";
export const EXTRACT_PROCESS_TRIGGER_FAILED = "process_trigger_failed";

type ReclaimOpts = {
  /** 특정 job만 (status 폴링) */
  jobId?: string;
  /** 해당 유저 stale job만 */
  userId?: string;
  olderThanMs?: number;
};

/**
 * 10분+ pending/processing → failed(timeout).
 * 별도 크론 없이 status/start 등에서 호출.
 */
export async function reclaimStaleExtractJobs(
  admin: SupabaseClient,
  opts: ReclaimOpts = {},
): Promise<number> {
  const olderThanMs = opts.olderThanMs ?? EXTRACT_STUCK_MS;
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const nowIso = new Date().toISOString();

  let q = admin
    .from("extract_jobs")
    .update({
      status: "failed",
      error_message: EXTRACT_TIMEOUT_ERROR,
      progress_step: "시간 초과",
      updated_at: nowIso,
    })
    .in("status", ["pending", "processing"])
    .lt("updated_at", cutoff);

  if (opts.jobId) q = q.eq("id", opts.jobId);
  if (opts.userId) q = q.eq("user_id", opts.userId);

  const { data, error } = await q.select("id");
  if (error) {
    console.error("[extract] reclaimStaleExtractJobs failed", error);
    return 0;
  }
  return data?.length ?? 0;
}

export async function markExtractJobFailed(
  admin: SupabaseClient,
  jobId: string,
  errorMessage: string,
  progressStep = "실패",
): Promise<void> {
  const { error } = await admin
    .from("extract_jobs")
    .update({
      status: "failed",
      error_message: errorMessage,
      progress_step: progressStep,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .in("status", ["pending", "processing"]);
  if (error) {
    console.error("[extract] markExtractJobFailed failed", { jobId, error });
  }
}
