import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countShareExtAuthFailsByReason,
  formatShareExtAuthFailSummary,
} from "./_shareAuthFailMetrics";

describe("countShareExtAuthFailsByReason", () => {
  it("counts only extract_start_auth_fail with client share_ext, by reason", () => {
    const counts = countShareExtAuthFailsByReason([
      {
        event: "extract_start_auth_fail",
        meta: { client: "share_ext", reason: "expired" },
      },
      {
        event: "extract_start_auth_fail",
        meta: { client: "share_ext", reason: "expired" },
      },
      {
        event: "extract_start_auth_fail",
        meta: { client: "share_ext", reason: "no_header" },
      },
      {
        event: "extract_start_auth_fail",
        meta: { client: "webview", reason: "expired" },
      },
      {
        event: "share_received",
        meta: { entry: "share" },
      },
      {
        event: "extract_start_auth_fail",
        meta: { client: "share_ext", reason: "invalid_signature" },
      },
    ]);
    assert.deepEqual(counts, {
      expired: 2,
      no_header: 1,
      invalid_signature: 1,
    });
  });

  it("ignores rows with missing reason or non-object meta", () => {
    const counts = countShareExtAuthFailsByReason([
      { event: "extract_start_auth_fail", meta: null },
      { event: "extract_start_auth_fail", meta: { client: "share_ext" } },
      {
        event: "extract_start_auth_fail",
        meta: { client: "share_ext", reason: "" },
      },
    ]);
    assert.deepEqual(counts, {});
  });
});

describe("formatShareExtAuthFailSummary", () => {
  it("formats reason(count) sorted by count desc then reason", () => {
    assert.equal(
      formatShareExtAuthFailSummary({
        expired: 3,
        no_header: 1,
        invalid_signature: 3,
      }),
      "expired(3) · invalid_signature(3) · no_header(1)",
    );
  });

  it("returns 0건 when empty", () => {
    assert.equal(formatShareExtAuthFailSummary({}), "0건");
  });
});
