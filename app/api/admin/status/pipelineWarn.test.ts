import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePipelineWarn,
  isSystemFailCode,
  topFailCodes,
} from "./_pipelineWarn";

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

  it("warns when ≥7 of last 10 share the same system fail_code", () => {
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

  it("does not warn when ≥7 of last 10 are content failures", () => {
    const ten = Array(8).fill("no_places_in_caption").concat([
      "kakao_unresolved",
      "overseas_unsupported",
    ]);
    const w = computePipelineWarn({
      failCodesLast30m: [],
      failCodesLast10: ten,
    });
    assert.equal(w.active, false);
  });

  it("stays inactive for sparse failures", () => {
    const w = computePipelineWarn({
      failCodesLast30m: ["claude_rate", "claude_other"],
      failCodesLast10: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    });
    assert.equal(w.active, false);
  });
});

describe("isSystemFailCode / topFailCodes", () => {
  it("classifies system vs content", () => {
    assert.equal(isSystemFailCode("claude_rate"), true);
    assert.equal(isSystemFailCode("kakao_429"), true);
    assert.equal(isSystemFailCode("no_places_in_caption"), false);
    assert.equal(isSystemFailCode("kakao_unresolved|foo"), false);
    assert.equal(isSystemFailCode("Apify 작업 실패"), true);
  });

  it("returns top 3 by count", () => {
    const top = topFailCodes(
      [
        "no_places_in_caption",
        "no_places_in_caption",
        "kakao_unresolved",
        "kakao_unresolved",
        "kakao_unresolved",
        "overseas_unsupported",
      ],
      3,
    );
    assert.deepEqual(top, [
      { code: "kakao_unresolved", count: 3 },
      { code: "no_places_in_caption", count: 2 },
      { code: "overseas_unsupported", count: 1 },
    ]);
  });
});
