import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePipelineWarn } from "./_pipelineWarn";

describe("computePipelineWarn", () => {
  it("warns on claude_credit in last 30m", () => {
    const w = computePipelineWarn({
      failCodesLast30m: ["kakao_unresolved", "claude_credit"],
      failCodesLast10: ["kakao_unresolved"],
    });
    assert.equal(w.active, true);
    assert.equal(w.code, "claude_credit");
    assert.match(w.reason || "", /크레딧/);
  });

  it("warns on claude_auth in last 30m", () => {
    const w = computePipelineWarn({
      failCodesLast30m: ["claude_auth"],
      failCodesLast10: [],
    });
    assert.equal(w.active, true);
    assert.equal(w.code, "claude_auth");
  });

  it("warns when ≥7 of last 10 share the same fail_code", () => {
    const ten = [
      "claude_rate",
      "claude_rate",
      "claude_rate",
      "claude_rate",
      "claude_rate",
      "claude_rate",
      "claude_rate",
      "other",
      "other",
      "other",
    ];
    const w = computePipelineWarn({
      failCodesLast30m: [],
      failCodesLast10: ten,
    });
    assert.equal(w.active, true);
    assert.equal(w.code, "claude_rate");
  });

  it("stays inactive for sparse failures", () => {
    const w = computePipelineWarn({
      failCodesLast30m: ["claude_rate", "claude_other"],
      failCodesLast10: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    });
    assert.equal(w.active, false);
  });
});
