import { supabase } from "./supabase";
import { debugLog } from "./debugLog";

const WARMUP_TIMEOUT_MS = 5_000;
const REFRESH_RETRY_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_TIMEOUTS = [2000, 2000, 4000] as const;
const DEFAULT_RETRY_BACKOFFS_MS = [0, 300] as const;

/** 내부 측정용 — 사용자 노출 없음 */
export const connectionFailureCountRef = { current: 0 };

export type WarmupResult = "ok" | "fail" | "pending" | null;

export const warmupMetaRef = {
  current: { result: null as WarmupResult, finishedAt: null as number | null },
};

export type WithAutoRetryOptions = {
  maxAttempts?: number;
  timeouts?: number[];
  backoffsMs?: number[];
};

function promiseWithTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
  abort?: AbortController,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      abort?.abort();
      reject(new Error(`${label}:timeout`));
    }, ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function nudgeRefreshSession(): void {
  void supabase.auth.refreshSession().catch(() => {});
}

export function setWarmupMeta(result: WarmupResult, finishedAt: number | null = Date.now()) {
  warmupMetaRef.current = { result, finishedAt };
  try {
    if (result === "pending") {
      debugLog.set({ warmupResult: "pending", warmupStartedAt: Date.now(), warmAttempts: null });
    } else {
      debugLog.set({ warmupResult: result, warmupFinishedAt: finishedAt });
    }
  } catch {
    /* ignore */
  }
}

export function recordConnectionSuccess(): void {
  connectionFailureCountRef.current = 0;
}

export function recordConnectionFailureSilent(err: unknown): void {
  const isTimeoutLike =
    (err instanceof Error && err.message.includes("timeout")) ||
    (err instanceof Error && err.name === "AbortError");
  if (!isTimeoutLike) return;
  connectionFailureCountRef.current += 1;
}

export async function withAutoRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts?: WithAutoRetryOptions,
): Promise<T> {
  const timeouts = opts?.timeouts ?? [...DEFAULT_RETRY_TIMEOUTS];
  const backoffsMs = opts?.backoffsMs ?? [...DEFAULT_RETRY_BACKOFFS_MS];
  const maxAttempts = opts?.maxAttempts ?? timeouts.length;

  let lastError: unknown = new Error("withAutoRetry:exhausted");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const backoff = backoffsMs[attempt - 1] ?? 0;
      if (backoff > 0) await delay(backoff);
      if (attempt === 1) {
        nudgeRefreshSession();
      }
    }

    const abort = new AbortController();
    const timeoutMs = timeouts[attempt] ?? timeouts[timeouts.length - 1]!;
    try {
      const result = await promiseWithTimeout(
        Promise.resolve(fn(abort.signal)),
        timeoutMs,
        `withAutoRetry.attempt${attempt + 1}`,
        abort,
      );
      recordConnectionSuccess();
      return result;
    } catch (e) {
      lastError = e;
      recordConnectionFailureSilent(e);
    }
  }

  throw lastError;
}

const MESSAGE_SEND_AUTO_RETRY_DELAY_MS = 500;

export function isNavigatorOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

export type MessageSendRecoveryOptions = {
  isConnectionLikelyOk?: () => boolean | Promise<boolean>;
  onBeforeAutoRetry?: () => void;
};

/** withAutoRetry 1회 소진 후 연결 OK면 0.5초 대기 뒤 withAutoRetry 1회 추가 (메시지 전송 거짓 실패 완화) */
export async function withAutoRetryAndMessageSendRecovery<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts?: MessageSendRecoveryOptions,
): Promise<T> {
  try {
    return await withAutoRetry(fn);
  } catch (firstErr) {
    const ok = opts?.isConnectionLikelyOk
      ? await Promise.resolve(opts.isConnectionLikelyOk())
      : isNavigatorOnline();
    if (!ok) throw firstErr;
    opts?.onBeforeAutoRetry?.();
    await delay(MESSAGE_SEND_AUTO_RETRY_DELAY_MS);
    return await withAutoRetry(fn);
  }
}

export async function runExtraRefreshSession(): Promise<void> {
  const refreshT = Date.now();
  try {
    debugLog.set({ refreshResult: "pending", refreshMs: null });
  } catch {
    /* ignore */
  }
  try {
    await promiseWithTimeout(
      Promise.resolve(supabase.auth.refreshSession()),
      REFRESH_RETRY_TIMEOUT_MS,
      "auth.refreshSession.retry",
    );
    try {
      debugLog.set({ refreshResult: "ok", refreshMs: Date.now() - refreshT });
    } catch {
      /* ignore */
    }
  } catch {
    try {
      debugLog.set({ refreshResult: "fail", refreshMs: Date.now() - refreshT });
    } catch {
      /* ignore */
    }
  }
}

export async function runConnectionWarmupWithRetry(): Promise<"ok" | "fail"> {
  const attemptWarmup = async (): Promise<boolean> => {
    try {
      await promiseWithTimeout(
        Promise.resolve(supabase.from("users").select("id").limit(1)),
        WARMUP_TIMEOUT_MS,
        "connectionWarmup.users",
      );
      return true;
    } catch {
      return false;
    }
  };

  setWarmupMeta("pending", null);

  let attempts = 1;
  let ok = await attemptWarmup();
  if (!ok) {
    await delay(1000);
    attempts = 2;
    ok = await attemptWarmup();
  }

  const finishedAt = Date.now();
  setWarmupMeta(ok ? "ok" : "fail", finishedAt);
  try {
    debugLog.set({ warmAttempts: attempts });
  } catch {
    /* ignore */
  }

  return ok ? "ok" : "fail";
}
