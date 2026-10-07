/**
 * Multi-job extract review ("모아 보기") — pure helpers.
 * Server `extract_jobs.reviewed_at` remains source of truth; no caption/URL storage here.
 */

import type { ExtractReviewPlace } from "@/lib/extractReviewPending";

/** Max jobs shown in one batch screen; remainder restores after finish. */
export const EXTRACT_REVIEW_BATCH_MAX = 20;

export type ExtractReviewJobItem = {
  jobId: string;
  places: ExtractReviewPlace[];
  /** ms epoch */
  at: number;
};

export type ExtractReviewUiMode = "none" | "single" | "batch";

export type BatchJobPlacePlan = {
  jobId: string;
  keepIds: string[];
  removeIds: string[];
};

export type BatchJobProcessResult = {
  jobId: string;
  ok: boolean;
};

/** Restore path: 0 → none, 1 → existing single UI, 2+ → 모아 보기 */
export function decideExtractReviewUiMode(jobCount: number): ExtractReviewUiMode {
  if (!Number.isFinite(jobCount) || jobCount <= 0) return "none";
  if (jobCount === 1) return "single";
  return "batch";
}

export function takeBatchJobs(
  jobs: ExtractReviewJobItem[],
  max = EXTRACT_REVIEW_BATCH_MAX,
): ExtractReviewJobItem[] {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  const n = Number.isFinite(max) && max > 0 ? Math.floor(max) : EXTRACT_REVIEW_BATCH_MAX;
  return jobs.slice(0, n);
}

export function countBatchPlaces(
  jobs: ReadonlyArray<{ places: ReadonlyArray<unknown> }>,
): number {
  return jobs.reduce((n, j) => n + (j.places?.length ?? 0), 0);
}

export function batchReviewTitle(reelCount: number, placeCount: number): string {
  return `릴스 ${reelCount}개에서 ${placeCount}곳을 찾았어요`;
}

export function planBatchPlaceActions(
  jobs: ExtractReviewJobItem[],
  checkedPlaceIds: ReadonlySet<string> | readonly string[],
): {
  keepIds: string[];
  removeIds: string[];
  perJob: BatchJobPlacePlan[];
} {
  const checked = new Set<string>();
  if (checkedPlaceIds instanceof Set) {
    for (const id of checkedPlaceIds) {
      if (typeof id === "string" && id.trim()) checked.add(id);
    }
  } else {
    for (const id of checkedPlaceIds) {
      if (typeof id === "string" && id.trim()) checked.add(id);
    }
  }

  const perJob: BatchJobPlacePlan[] = jobs.map((job) => {
    const places = Array.isArray(job.places) ? job.places : [];
    const keepIds = places.filter((p) => checked.has(p.id)).map((p) => p.id);
    const removeIds = places.filter((p) => !checked.has(p.id)).map((p) => p.id);
    return { jobId: job.jobId, keepIds, removeIds };
  });

  return {
    perJob,
    keepIds: perJob.flatMap((j) => j.keepIds),
    removeIds: perJob.flatMap((j) => j.removeIds),
  };
}

export function summarizeBatchProcessResults(results: BatchJobProcessResult[]): {
  succeededJobIds: string[];
  failedJobIds: string[];
  allOk: boolean;
  partialFail: boolean;
  /** User-facing; null when allOk */
  message: string | null;
} {
  const succeededJobIds = results.filter((r) => r.ok).map((r) => r.jobId);
  const failedJobIds = results.filter((r) => !r.ok).map((r) => r.jobId);
  const allOk = failedJobIds.length === 0;
  const noneOk = succeededJobIds.length === 0 && failedJobIds.length > 0;
  const partialFail = succeededJobIds.length > 0 && failedJobIds.length > 0;

  let message: string | null = null;
  if (partialFail) {
    message = `${succeededJobIds.length}개는 처리했고, ${failedJobIds.length}개는 다시 확인할게요`;
  } else if (noneOk) {
    message = "처리에 실패했어요";
  }

  return {
    succeededJobIds,
    failedJobIds,
    allOk,
    partialFail,
    message,
  };
}
