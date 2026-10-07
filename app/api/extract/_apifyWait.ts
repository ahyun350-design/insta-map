/**
 * Wait for an Apify actor run to reach a terminal status via waitForFinish.
 * Docs: GET /v2/actor-runs/{id}?waitForFinish=0..60 (server waits up to N seconds).
 * https://docs.apify.com/api/v2/actor-run-get
 */

export const APIFY_RUN_WAIT_TOTAL_MS = 60_000;
/** Chunk under typical platform fetch timeouts; max API value is 60. */
export const APIFY_RUN_WAIT_CHUNK_SEC = 25;

export type ApifyRunTerminalStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTED"
  | "TIMED-OUT"
  | "RUNNING"
  | "READY"
  | string;

export type ApifyRunWaitOutcome = {
  status: ApifyRunTerminalStatus;
  datasetId: string | undefined;
  /** How we left the wait loop */
  reason: "succeeded" | "failed" | "deadline" | "http_error";
};

type FetchLike = (
  input: string,
  init?: { method?: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

function isTerminalFailure(status: string): boolean {
  return status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT";
}

function isTerminalSuccess(status: string): boolean {
  return status === "SUCCEEDED";
}

/**
 * Poll Apify run status using waitForFinish chunks until SUCCEEDED/failure or total budget.
 * Does not start runs — runId must already exist (no duplicate executions).
 */
export async function waitForApifyRunFinish(opts: {
  runId: string;
  token: string;
  initialDatasetId?: string;
  totalMs?: number;
  chunkSec?: number;
  fetchFn?: FetchLike;
  nowFn?: () => number;
}): Promise<ApifyRunWaitOutcome> {
  const fetchFn = opts.fetchFn ?? fetch;
  const nowFn = opts.nowFn ?? Date.now;
  const totalMs = opts.totalMs ?? APIFY_RUN_WAIT_TOTAL_MS;
  const chunkSec = opts.chunkSec ?? APIFY_RUN_WAIT_CHUNK_SEC;
  const deadline = nowFn() + totalMs;

  let datasetId = opts.initialDatasetId;
  let lastStatus: ApifyRunTerminalStatus = "RUNNING";

  while (nowFn() < deadline) {
    const remainingMs = deadline - nowFn();
    if (remainingMs <= 0) break;

    const waitSec = Math.max(
      1,
      Math.min(chunkSec, 60, Math.ceil(remainingMs / 1000)),
    );

    const url =
      `https://api.apify.com/v2/actor-runs/${encodeURIComponent(opts.runId)}` +
      `?token=${encodeURIComponent(opts.token)}` +
      `&waitForFinish=${waitSec}`;

    let statusRes: Awaited<ReturnType<FetchLike>>;
    try {
      statusRes = await fetchFn(url, { method: "GET" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Apify 상태 확인 실패: ${msg}`);
    }

    if (!statusRes.ok) {
      const body = await statusRes.text().catch(() => "");
      throw new Error(
        `Apify 상태 확인 실패: HTTP ${statusRes.status}${body ? ` ${body.slice(0, 120)}` : ""}`,
      );
    }

    let statusData: {
      data?: { status?: string; defaultDatasetId?: string };
    };
    try {
      statusData = (await statusRes.json()) as typeof statusData;
    } catch {
      throw new Error("Apify 상태 응답 파싱 실패");
    }

    const status = String(statusData.data?.status ?? "");
    lastStatus = status || lastStatus;
    if (statusData.data?.defaultDatasetId) {
      datasetId = statusData.data.defaultDatasetId;
    }

    if (isTerminalSuccess(status)) {
      return { status, datasetId, reason: "succeeded" };
    }
    if (isTerminalFailure(status)) {
      return { status, datasetId, reason: "failed" };
    }
    // RUNNING / READY — waitForFinish already blocked up to waitSec; loop again
  }

  return { status: lastStatus, datasetId, reason: "deadline" };
}
