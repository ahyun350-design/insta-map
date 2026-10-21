import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMapGlWindowMetrics } from "./_mapGlMetrics";

describe("computeMapGlWindowMetrics", () => {
  it("computes median/p90, fallback top3, auto-off users", () => {
    const rows = [
      { event: "map_gl_timing", meta: { first_visible_ms: 100 }, user_id: "a" },
      { event: "map_gl_timing", meta: { first_visible_ms: 200 }, user_id: "a" },
      { event: "map_gl_timing", meta: { first_visible_ms: 300 }, user_id: "b" },
      { event: "map_gl_fallback", meta: { reason: "style_timeout" }, user_id: "a" },
      { event: "map_gl_fallback", meta: { reason: "style_timeout" }, user_id: "b" },
      { event: "map_gl_fallback", meta: { reason: "error" }, user_id: "c" },
      { event: "map_gl_auto_off", meta: { code: "fallback_x2" }, user_id: "a" },
      { event: "map_gl_auto_off", meta: { code: "webgl_recover_fail" }, user_id: "b" },
      { event: "map_gl_auto_off", meta: { code: "fallback_x2" }, user_id: "a" },
    ];
    const m = computeMapGlWindowMetrics(rows);
    assert.equal(m.timingMedianFirstVisibleMs, 200);
    assert.ok(m.timingP90FirstVisibleMs != null);
    assert.equal(m.fallbackCount, 3);
    assert.equal(m.fallbackTop3[0]?.code, "style_timeout");
    assert.equal(m.fallbackTop3[0]?.count, 2);
    assert.equal(m.autoOffDeviceCount, 2);
  });
});
