import { supabase } from "./supabase";
import { debugLog } from "./debugLog";

export const WARM_STALE_MS = 30_000;
const WARM_GATE_TIMEOUT_MS = 3_000;
const WARMUP_TIMEOUT_MS = 5_000;
const REFRESH_RETRY_TIMEOUT_MS = 5_000;
const LAST_RELOAD_AT_KEY = "pindmap_lastReloadAt";
const RELOAD_COOLDOWN_MS = 30_000;

export const clientReloadNeededRef = { current: false };
export const connectionFailureCountRef = { current: 0 };

export type WarmupResult = "ok" | "fail" | "pending" | null;

export const warmupMetaRef = {
  current: { result: null as WarmupResult, finishedAt: null as number | null },
};

export type ToastFn = (message: string, type?: "error" | "info" | "success") => void;

function promiseWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${label}:timeout`)), ms);
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

export function needsWarmGate(): boolean {
  const { result, finishedAt } = warmupMetaRef.current;
  if (result === "fail") return true;
  if (finishedAt !== null && Date.now() - finishedAt > WARM_STALE_MS) return true;
  return false;
}

export async function runWarmGatePing(): Promise<boolean> {
  const retryT = Date.now();
  setWarmupMeta("pending", null);
  try {
    await promiseWithTimeout(
      Promise.resolve(supabase.from("users").select("id").limit(1)),
      WARM_GATE_TIMEOUT_MS,
      "warmGate.users",
    );
    setWarmupMeta("ok", Date.now());
    try {
      debugLog.pushSendStep("warm_gate_ok", Date.now() - retryT);
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    setWarmupMeta("fail", Date.now());
    try {
      debugLog.pushSendStep("warm_gate_fail", Date.now() - retryT);
    } catch {
      /* ignore */
    }
    return false;
  }
}

export function scheduleAutoReload(showToast: ToastFn): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = sessionStorage.getItem(LAST_RELOAD_AT_KEY);
    if (last && Date.now() - Number(last) < RELOAD_COOLDOWN_MS) {
      showToast("연결을 확인해 주세요", "error");
      return false;
    }
    sessionStorage.setItem(LAST_RELOAD_AT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  showToast("연결이 끊겼어요. 새로고침합니다.", "error");
  window.setTimeout(() => {
    window.location.reload();
  }, 1000);
  return true;
}

export function tryHandleReloadRequired(showToast: ToastFn): "reload" | "none" {
  if (!clientReloadNeededRef.current) return "none";
  showToast("새로고침이 필요해요", "error");
  scheduleAutoReload(showToast);
  return "reload";
}

export async function ensureConnectionWarm(showToast: ToastFn): Promise<"ok" | "abort" | "reload"> {
  const reloadHandled = tryHandleReloadRequired(showToast);
  if (reloadHandled === "reload") return "reload";

  if (!needsWarmGate()) return "ok";

  try {
    debugLog.pushSendStep("warm_gate_retry");
  } catch {
    /* ignore */
  }

  const warmOk = await runWarmGatePing();
  if (warmOk) {
    recordConnectionSuccess();
    return "ok";
  }

  showToast("연결이 끊어졌어요. 잠시 후 다시 시도해주세요.", "error");
  return "abort";
}

export function recordConnectionSuccess(): void {
  connectionFailureCountRef.current = 0;
}

export function isTimeoutLikeError(err: unknown): boolean {
  return (
    (err instanceof Error && err.message.includes("timeout")) ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export function recordConnectionFailure(showToast: ToastFn, err: unknown): void {
  if (!isTimeoutLikeError(err)) return;
  connectionFailureCountRef.current += 1;
  if (connectionFailureCountRef.current >= 2) {
    connectionFailureCountRef.current = 0;
    clientReloadNeededRef.current = true;
    scheduleAutoReload(showToast);
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

  const startedAt = Date.now();
  setWarmupMeta("pending", null);

  let attempts = 1;
  let ok = await attemptWarmup();
  if (!ok) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 1000);
    });
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
