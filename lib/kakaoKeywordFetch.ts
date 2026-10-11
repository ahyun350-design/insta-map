/**
 * Kakao Local keyword search transport helpers.
 * Distinguishes HTTP 200 empty vs transport/API errors; never persists response bodies.
 */

export const KAKAO_FETCH_TIMEOUT_MS = 4000;
export const KAKAO_RETRY_DELAY_MS = 600;
export const KAKAO_RETRY_DELAY_429_MS = 1000;

export type KakaoTransportErrorCode =
  | "kakao_429"
  | "kakao_5xx"
  | "kakao_timeout"
  | "kakao_net";

export type KakaoKeywordDoc = {
  place_name?: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  category_group_code?: string;
  category_name?: string;
};

export type KakaoKeywordFetchOk = {
  kind: "ok";
  docs: KakaoKeywordDoc[];
};

export type KakaoKeywordFetchErr = {
  kind: "error";
  code: KakaoTransportErrorCode;
};

export type KakaoKeywordFetchResult = KakaoKeywordFetchOk | KakaoKeywordFetchErr;

export function classifyKakaoHttpStatus(
  status: number,
): KakaoTransportErrorCode | null {
  if (status === 429) return "kakao_429";
  if (status >= 500 && status <= 599) return "kakao_5xx";
  if (status >= 400) return "kakao_net";
  return null;
}

export function isAbortTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string };
  return e.name === "AbortError" || e.name === "TimeoutError" || e.code === "ABORT_ERR";
}

export function retryDelayMsForCode(code: KakaoTransportErrorCode): number {
  return code === "kakao_429" ? KAKAO_RETRY_DELAY_429_MS : KAKAO_RETRY_DELAY_MS;
}

/** Miss cache only when every attempted stage was a genuine HTTP 200 empty (no transport errors). */
export function shouldWriteKakaoMissCache(opts: {
  hadTransportError: boolean;
  attemptedStages: number;
  completedAllQueryStages: boolean;
}): boolean {
  if (opts.hadTransportError) return false;
  if (!opts.completedAllQueryStages) return false;
  if (opts.attemptedStages < 1) return false;
  return true;
}

export type KakaoFetchDeps = {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  nowFn?: () => number;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function fetchKakaoKeywordOnce(
  url: string,
  kakaoKey: string,
  deps: KakaoFetchDeps,
): Promise<KakaoKeywordFetchResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? KAKAO_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const code = classifyKakaoHttpStatus(res.status) ?? "kakao_net";
      return { kind: "error", code };
    }
    const data = (await res.json()) as { documents?: KakaoKeywordDoc[] };
    return { kind: "ok", docs: data.documents ?? [] };
  } catch (err) {
    if (isAbortTimeoutError(err)) {
      return { kind: "error", code: "kakao_timeout" };
    }
    return { kind: "error", code: "kakao_net" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One keyword call with a single retry on transport/API error.
 * Success (200 with or without docs) is never retried.
 */
export async function fetchKakaoKeywordWithRetry(
  query: string,
  kakaoKey: string,
  deps: KakaoFetchDeps = {},
): Promise<KakaoKeywordFetchResult> {
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=15`;

  const first = await fetchKakaoKeywordOnce(url, kakaoKey, deps);
  if (first.kind === "ok") return first;

  await sleepFn(retryDelayMsForCode(first.code));
  return fetchKakaoKeywordOnce(url, kakaoKey, deps);
}
