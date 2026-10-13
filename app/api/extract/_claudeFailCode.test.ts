import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyClaudeFailCode,
  claudeFailCodeAdminLabel,
} from "./_claudeFailCode";
import { extractFailCode } from "./_timing";

describe("classifyClaudeFailCode", () => {
  it("maps credit balance errors", () => {
    const raw =
      'Claude API 오류: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API"}}';
    assert.equal(classifyClaudeFailCode(raw), "claude_credit");
    assert.equal(extractFailCode(raw), "claude_credit");
  });

  it("maps authentication errors", () => {
    const raw =
      'Claude API 오류: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    assert.equal(classifyClaudeFailCode(raw), "claude_auth");
    assert.equal(extractFailCode(raw), "claude_auth");
  });

  it("maps 429 / rate limit", () => {
    assert.equal(
      classifyClaudeFailCode("Claude API 오류: 429 rate_limit_error"),
      "claude_rate",
    );
  });

  it("maps 529 / overloaded", () => {
    assert.equal(
      classifyClaudeFailCode('Claude API 오류: {"type":"overloaded_error"} 529'),
      "claude_overloaded",
    );
  });

  it("maps other Claude API errors", () => {
    assert.equal(
      classifyClaudeFailCode("Claude API 오류: something else"),
      "claude_other",
    );
  });

  it("ignores unrelated failures", () => {
    assert.equal(classifyClaudeFailCode("kakao_unresolved|a,b"), null);
    assert.equal(extractFailCode("kakao_unresolved|a,b"), "kakao_unresolved");
  });

  it("passes through already-normalized codes", () => {
    assert.equal(classifyClaudeFailCode("claude_credit"), "claude_credit");
  });

  it("admin labels are non-empty", () => {
    assert.ok(claudeFailCodeAdminLabel("claude_credit").length > 0);
  });
});
