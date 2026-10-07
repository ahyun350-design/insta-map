import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APIFY_RUN_WAIT_CHUNK_SEC,
  APIFY_RUN_WAIT_TOTAL_MS,
  waitForApifyRunFinish,
} from "./_apifyWait";

describe("waitForApifyRunFinish", () => {
  it("returns succeeded when waitForFinish yields SUCCEEDED", async () => {
    let calls = 0;
    const outcome = await waitForApifyRunFinish({
      runId: "run1",
      token: "t",
      initialDatasetId: "ds0",
      totalMs: 60_000,
      chunkSec: 25,
      nowFn: () => 0,
      fetchFn: async (url) => {
        calls += 1;
        assert.match(url, /waitForFinish=25/);
        assert.match(url, /actor-runs\/run1/);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { status: "SUCCEEDED", defaultDatasetId: "ds1" },
          }),
          text: async () => "",
        };
      },
    });
    assert.equal(outcome.reason, "succeeded");
    assert.equal(outcome.status, "SUCCEEDED");
    assert.equal(outcome.datasetId, "ds1");
    assert.equal(calls, 1);
  });

  it("returns failed on FAILED / ABORTED / TIMED-OUT", async () => {
    for (const status of ["FAILED", "ABORTED", "TIMED-OUT"] as const) {
      const outcome = await waitForApifyRunFinish({
        runId: "r",
        token: "t",
        nowFn: () => 0,
        fetchFn: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ data: { status, defaultDatasetId: "d" } }),
          text: async () => "",
        }),
      });
      assert.equal(outcome.reason, "failed");
      assert.equal(outcome.status, status);
    }
  });

  it("re-waits while RUNNING until SUCCEEDED within budget", async () => {
    let calls = 0;
    let t = 0;
    const outcome = await waitForApifyRunFinish({
      runId: "r",
      token: "t",
      totalMs: 60_000,
      chunkSec: 25,
      nowFn: () => t,
      fetchFn: async () => {
        calls += 1;
        // Simulate wall clock advancing by chunk after each wait
        t += 25_000;
        if (calls < 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { status: "RUNNING" } }),
            text: async () => "",
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { status: "SUCCEEDED", defaultDatasetId: "ds" },
          }),
          text: async () => "",
        };
      },
    });
    assert.equal(outcome.reason, "succeeded");
    assert.equal(calls, 2);
  });

  it("deadline without success → reason deadline (legacy fall-through)", async () => {
    let t = 0;
    const outcome = await waitForApifyRunFinish({
      runId: "r",
      token: "t",
      totalMs: 50,
      chunkSec: 25,
      nowFn: () => t,
      fetchFn: async () => {
        t += 100; // exhaust budget after one call
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { status: "RUNNING" } }),
          text: async () => "",
        };
      },
    });
    assert.equal(outcome.reason, "deadline");
    assert.equal(outcome.status, "RUNNING");
  });

  it("HTTP error throws (no silent hang)", async () => {
    await assert.rejects(
      () =>
        waitForApifyRunFinish({
          runId: "r",
          token: "t",
          nowFn: () => 0,
          fetchFn: async () => ({
            ok: false,
            status: 502,
            json: async () => ({}),
            text: async () => "bad gateway",
          }),
        }),
      /Apify 상태 확인 실패/,
    );
  });

  it("network throw surfaces", async () => {
    await assert.rejects(
      () =>
        waitForApifyRunFinish({
          runId: "r",
          token: "t",
          nowFn: () => 0,
          fetchFn: async () => {
            throw new Error("fetch failed");
          },
        }),
      /Apify 상태 확인 실패: fetch failed/,
    );
  });

  it("exports match prior 60s budget and safe chunk size", () => {
    assert.equal(APIFY_RUN_WAIT_TOTAL_MS, 60_000);
    assert.ok(APIFY_RUN_WAIT_CHUNK_SEC <= 60);
    assert.ok(APIFY_RUN_WAIT_CHUNK_SEC >= 20);
  });
});
