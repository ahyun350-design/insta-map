import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Serial async queue: tasks run in enqueue order; failures are swallowed
 * so later tasks still run. Caller may drain() before a final status write.
 */
export function createOrderedAsyncQueue() {
  let chain: Promise<void> = Promise.resolve();
  let betweenMs = 0;

  const enqueue = (fn: () => Promise<void>): void => {
    chain = chain.then(async () => {
      const t0 = Date.now();
      try {
        await fn();
      } catch {
        // progress/diag must never fail the extract
      } finally {
        betweenMs += Date.now() - t0;
      }
    });
  };

  const drain = async (): Promise<void> => {
    const t0 = Date.now();
    await chain;
    betweenMs += Date.now() - t0;
  };

  return {
    enqueue,
    drain,
    getBetweenMs: () => betweenMs,
  };
}

export type ExtractJobWriteClient = Pick<SupabaseClient, "from">;

/** Mid-flight progress only — never overwrites completed/failed. */
export async function updateJobProgress(
  supabase: ExtractJobWriteClient,
  jobId: string,
  progressStep: string,
): Promise<void> {
  const { error } = await supabase
    .from("extract_jobs")
    .update({
      status: "processing",
      progress_step: progressStep,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .in("status", ["pending", "processing"]);
  if (error) {
    console.error("[extract] updateJobProgress failed", { jobId, error });
  }
}

export async function saveJobDiagnostics(
  supabase: ExtractJobWriteClient,
  jobId: string,
  patch: {
    claude_places?: unknown;
    kakao_misses?: unknown;
    pending_places?: unknown;
  },
): Promise<void> {
  try {
    const { error } = await supabase
      .from("extract_jobs")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (error) {
      console.error("[extract] saveJobDiagnostics failed", { jobId, error });
    }
  } catch (e) {
    console.error("[extract] saveJobDiagnostics threw", { jobId, e });
  }
}

/** Ensure notify runs at most once per job completion path. */
export function createOnceRunner() {
  let ran = false;
  return async (fn: () => Promise<void>): Promise<boolean> => {
    if (ran) return false;
    ran = true;
    await fn();
    return true;
  };
}
