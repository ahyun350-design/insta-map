import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchKakaoPlaceWithDiag } from "../app/api/extract/_shared";
import { shouldWriteKakaoMissCache } from "./kakaoKeywordFetch";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const doc = {
  place_name: "테스트카페",
  address_name: "서울 마포구 연남동 1",
  road_address_name: "서울 마포구 연남로 1",
  x: "126.9",
  y: "37.5",
};

describe("searchKakaoPlaceWithDiag transport vs empty", () => {
  it("200 + docs → lookup set, no transport error", async () => {
    const prev = process.env.KAKAO_REST_API_KEY;
    process.env.KAKAO_REST_API_KEY = "test-key";
    try {
      const diag = await searchKakaoPlaceWithDiag("테스트카페", "", undefined, "", {
        maxAttempts: 1,
        fetchDeps: {
          sleepFn: async () => {},
          fetchFn: async () => jsonResponse(200, { documents: [doc] }),
        },
      });
      assert.ok(diag.lookup);
      assert.equal(diag.lookup?.placeName, "테스트카페");
      assert.equal(diag.hadTransportError, false);
      assert.equal(diag.errorCount, 0);
    } finally {
      process.env.KAKAO_REST_API_KEY = prev;
    }
  });

  it("200 + 0건 all stages → cache allowed", async () => {
    const prev = process.env.KAKAO_REST_API_KEY;
    process.env.KAKAO_REST_API_KEY = "test-key";
    try {
      const diag = await searchKakaoPlaceWithDiag("없는가게이름xyz123", "", undefined, "", {
        fetchDeps: {
          sleepFn: async () => {},
          fetchFn: async () => jsonResponse(200, { documents: [] }),
        },
      });
      assert.equal(diag.lookup, null);
      assert.equal(diag.hadTransportError, false);
      assert.equal(diag.errorCount, 0);
      assert.equal(diag.completedAllQueryStages, true);
      assert.equal(
        shouldWriteKakaoMissCache({
          hadTransportError: diag.hadTransportError,
          attemptedStages: diag.tried,
          completedAllQueryStages: diag.completedAllQueryStages,
        }),
        true,
      );
    } finally {
      process.env.KAKAO_REST_API_KEY = prev;
    }
  });

  it("500 twice → stages include kakao_5xx, cache not allowed", async () => {
    const prev = process.env.KAKAO_REST_API_KEY;
    process.env.KAKAO_REST_API_KEY = "test-key";
    try {
      const diag = await searchKakaoPlaceWithDiag("카페", "", undefined, "", {
        maxAttempts: 1,
        fetchDeps: {
          sleepFn: async () => {},
          fetchFn: async () => jsonResponse(500, {}),
        },
      });
      assert.equal(diag.lookup, null);
      assert.equal(diag.hadTransportError, true);
      assert.ok(diag.errorCount >= 1);
      assert.ok(diag.stages.includes("kakao_5xx"));
      assert.equal(
        shouldWriteKakaoMissCache({
          hadTransportError: diag.hadTransportError,
          attemptedStages: diag.tried,
          completedAllQueryStages: diag.completedAllQueryStages,
        }),
        false,
      );
    } finally {
      process.env.KAKAO_REST_API_KEY = prev;
    }
  });

  it("mixed empty then 500 → cache not allowed", async () => {
    const prev = process.env.KAKAO_REST_API_KEY;
    process.env.KAKAO_REST_API_KEY = "test-key";
    let calls = 0;
    try {
      // Multi-token name → original + first_token + drop_last
      const diag = await searchKakaoPlaceWithDiag(
        "알파 브라보 찰리 델타",
        "",
        undefined,
        "",
        {
          fetchDeps: {
            sleepFn: async () => {},
            fetchFn: async () => {
              calls += 1;
              if (calls === 1) return jsonResponse(200, { documents: [] });
              return jsonResponse(500, {});
            },
          },
        },
      );
      assert.equal(diag.lookup, null);
      assert.equal(diag.hadTransportError, true);
      assert.ok(diag.stages.includes("kakao_5xx"));
      assert.equal(
        shouldWriteKakaoMissCache({
          hadTransportError: diag.hadTransportError,
          attemptedStages: diag.tried,
          completedAllQueryStages: diag.completedAllQueryStages,
        }),
        false,
      );
    } finally {
      process.env.KAKAO_REST_API_KEY = prev;
    }
  });
});
