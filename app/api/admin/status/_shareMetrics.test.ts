import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countShareSaveUsers } from "./_shareMetrics";

describe("countShareSaveUsers", () => {
  it("unions extract_timing share/share_fallback with share_received", () => {
    const n = countShareSaveUsers([
      {
        event: "extract_timing",
        meta: { entry: "share" },
        user_id: "u1",
      },
      {
        event: "extract_timing",
        meta: { entry: "share_fallback" },
        user_id: "u2",
      },
      {
        event: "extract_timing",
        meta: { entry: "app" },
        user_id: "u3",
      },
      {
        event: "share_received",
        meta: { entry: "share" },
        user_id: "u4",
      },
      {
        event: "share_received",
        meta: { entry: "share_fallback" },
        user_id: "u1",
      },
    ]);
    assert.equal(n, 3);
  });

  it("ignores rows without user_id", () => {
    assert.equal(
      countShareSaveUsers([
        { event: "share_received", meta: { entry: "share" }, user_id: null },
        { event: "extract_timing", meta: { entry: "share" } },
      ]),
      0,
    );
  });
});
