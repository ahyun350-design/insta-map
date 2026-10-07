import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXTRACT_REVIEW_BATCH_MAX,
  batchReviewTitle,
  countBatchPlaces,
  decideExtractReviewUiMode,
  planBatchPlaceActions,
  summarizeBatchProcessResults,
  takeBatchJobs,
  type ExtractReviewJobItem,
} from "./extractReviewBatch";

function place(id: string, name = id): ExtractReviewJobItem["places"][number] {
  return {
    id,
    name,
    address: `${name}-addr`,
    category: "맛집",
    subcategory: null,
  };
}

function job(jobId: string, placeIds: string[], at = 1): ExtractReviewJobItem {
  return {
    jobId,
    at,
    places: placeIds.map((id) => place(id)),
  };
}

describe("decideExtractReviewUiMode", () => {
  it("none for 0 or invalid", () => {
    assert.equal(decideExtractReviewUiMode(0), "none");
    assert.equal(decideExtractReviewUiMode(-1), "none");
    assert.equal(decideExtractReviewUiMode(Number.NaN), "none");
  });

  it("single for exactly 1 job (existing UI)", () => {
    assert.equal(decideExtractReviewUiMode(1), "single");
  });

  it("batch for 2+", () => {
    assert.equal(decideExtractReviewUiMode(2), "batch");
    assert.equal(decideExtractReviewUiMode(20), "batch");
  });
});

describe("takeBatchJobs", () => {
  it("caps at EXTRACT_REVIEW_BATCH_MAX (20)", () => {
    const jobs = Array.from({ length: 25 }, (_, i) => job(`j${i}`, [`p${i}`]));
    const taken = takeBatchJobs(jobs);
    assert.equal(taken.length, EXTRACT_REVIEW_BATCH_MAX);
    assert.equal(taken[0]!.jobId, "j0");
    assert.equal(taken[19]!.jobId, "j19");
  });
});

describe("batchReviewTitle / countBatchPlaces", () => {
  it("formats title and counts places across jobs", () => {
    const jobs = [job("a", ["p1", "p2"]), job("b", ["p3"])];
    assert.equal(countBatchPlaces(jobs), 3);
    assert.equal(batchReviewTitle(2, 3), "릴스 2개에서 3곳을 찾았어요");
  });
});

describe("planBatchPlaceActions", () => {
  it("splits keep/remove per job from a shared checkbox set", () => {
    const jobs = [job("a", ["p1", "p2"]), job("b", ["p3", "p4"])];
    const plan = planBatchPlaceActions(jobs, ["p1", "p4"]);
    assert.deepEqual(plan.keepIds, ["p1", "p4"]);
    assert.deepEqual(plan.removeIds, ["p2", "p3"]);
    assert.deepEqual(plan.perJob, [
      { jobId: "a", keepIds: ["p1"], removeIds: ["p2"] },
      { jobId: "b", keepIds: ["p4"], removeIds: ["p3"] },
    ]);
  });

  it("all unchecked → every place in removeIds", () => {
    const jobs = [job("a", ["p1"]), job("b", ["p2"])];
    const plan = planBatchPlaceActions(jobs, []);
    assert.deepEqual(plan.keepIds, []);
    assert.deepEqual(plan.removeIds, ["p1", "p2"]);
  });
});

describe("summarizeBatchProcessResults", () => {
  it("all ok → no message", () => {
    const s = summarizeBatchProcessResults([
      { jobId: "a", ok: true },
      { jobId: "b", ok: true },
    ]);
    assert.equal(s.allOk, true);
    assert.equal(s.partialFail, false);
    assert.equal(s.message, null);
    assert.deepEqual(s.succeededJobIds, ["a", "b"]);
  });

  it("partial fail → success kept, failed listed, message set", () => {
    const s = summarizeBatchProcessResults([
      { jobId: "a", ok: true },
      { jobId: "b", ok: false },
      { jobId: "c", ok: true },
    ]);
    assert.equal(s.allOk, false);
    assert.equal(s.partialFail, true);
    assert.deepEqual(s.succeededJobIds, ["a", "c"]);
    assert.deepEqual(s.failedJobIds, ["b"]);
    assert.equal(s.message, "2개는 처리했고, 1개는 다시 확인할게요");
  });

  it("all fail → error message, no partial", () => {
    const s = summarizeBatchProcessResults([
      { jobId: "a", ok: false },
      { jobId: "b", ok: false },
    ]);
    assert.equal(s.allOk, false);
    assert.equal(s.partialFail, false);
    assert.equal(s.message, "처리에 실패했어요");
  });
});
