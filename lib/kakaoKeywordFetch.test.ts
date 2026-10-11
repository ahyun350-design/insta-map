import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KAKAO_FETCH_TIMEOUT_MS,
  KAKAO_RETRY_DELAY_429_MS,
  KAKAO_RETRY_DELAY_MS,
  classifyKakaoHttpStatus,
  fetchKakaoKeywordWithRetry,
  retryDelayMsForCode,
  shouldWriteKakaoMissCache,
} from "./kakaoKeywordFetch";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("classifyKakaoHttpStatus", () => {
  it("maps 429 / 5xx / other 4xx", () => {
    assert.equal(classifyKakaoHttpStatus(429), "kakao_429");
    assert.equal(classifyKakaoHttpStatus(500), "kakao_5xx");
    assert.equal(classifyKakaoHttpStatus(503), "kakao_5xx");
    assert.equal(classifyKakaoHttpStatus(403), "kakao_net");
    assert.equal(classifyKakaoHttpStatus(200), null);
  });
});

describe("shouldWriteKakaoMissCache", () => {
  it("writes only when all stages completed as genuine empty (no transport error)", () => {
    assert.equal(
      shouldWriteKakaoMissCache({
        hadTransportError: false,
        attemptedStages: 3,
        completedAllQueryStages: true,
      }),
      true,
    );
  });

  it("does not write when any transport error mixed in", () => {
    assert.equal(
      shouldWriteKakaoMissCache({
        hadTransportError: true,
        attemptedStages: 3,
        completedAllQueryStages: true,
      }),
      false,
    );
  });

  it("does not write when stages were not all completed", () => {
    assert.equal(
      shouldWriteKakaoMissCache({
        hadTransportError: false,
        attemptedStages: 2,
        completedAllQueryStages: false,
      }),
      false,
    );
  });
});

describe("fetchKakaoKeywordWithRetry", () => {
  it("200 + docs → returns docs, no retry", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await fetchKakaoKeywordWithRetry("카페", "key", {
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      fetchFn: async () => {
        calls += 1;
        return jsonResponse(200, {
          documents: [
            {
              place_name: "카페",
              address_name: "서울",
              road_address_name: "서울",
              x: "127",
              y: "37",
            },
          ],
        });
      },
    });
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") assert.equal(result.docs.length, 1);
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });

  it("200 + empty → ok empty, no retry", async () => {
    let calls = 0;
    const result = await fetchKakaoKeywordWithRetry("없는가게xyz", "key", {
      sleepFn: async () => {},
      fetchFn: async () => {
        calls += 1;
        return jsonResponse(200, { documents: [] });
      },
    });
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") assert.equal(result.docs.length, 0);
    assert.equal(calls, 1);
  });

  it("429 then 200 docs → retries once with ~1s delay and adopts result", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await fetchKakaoKeywordWithRetry("카페", "key", {
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      fetchFn: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse(429, {});
        return jsonResponse(200, {
          documents: [
            {
              place_name: "카페",
              address_name: "서울",
              road_address_name: "서울",
              x: "127",
              y: "37",
            },
          ],
        });
      },
    });
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") assert.equal(result.docs[0]?.place_name, "카페");
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [KAKAO_RETRY_DELAY_429_MS]);
  });

  it("500 twice → error kakao_5xx after one retry", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await fetchKakaoKeywordWithRetry("카페", "key", {
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      fetchFn: async () => {
        calls += 1;
        return jsonResponse(500, {});
      },
    });
    assert.deepEqual(result, { kind: "error", code: "kakao_5xx" });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [KAKAO_RETRY_DELAY_MS]);
  });

  it("timeout → error kakao_timeout", async () => {
    const result = await fetchKakaoKeywordWithRetry("카페", "key", {
      timeoutMs: 20,
      sleepFn: async () => {},
      fetchFn: async (_url, init) => {
        const signal = init?.signal;
        await new Promise<void>((_resolve, reject) => {
          const t = setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 50);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
        return jsonResponse(200, { documents: [] });
      },
    });
    assert.equal(result.kind, "error");
    if (result.kind === "error") assert.equal(result.code, "kakao_timeout");
  });
});

describe("retryDelayMsForCode", () => {
  it("uses longer delay for 429", () => {
    assert.equal(retryDelayMsForCode("kakao_429"), KAKAO_RETRY_DELAY_429_MS);
    assert.equal(retryDelayMsForCode("kakao_5xx"), KAKAO_RETRY_DELAY_MS);
    assert.ok(KAKAO_FETCH_TIMEOUT_MS === 4000);
  });
});
