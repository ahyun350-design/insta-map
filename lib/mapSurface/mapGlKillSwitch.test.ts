import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getMapGlRemoteEnabledCached,
  isMapGlRemoteAllowed,
  resetMapGlKillSwitchForTests,
  setMapGlRemoteEnabledForTests,
} from "./mapGlKillSwitch";
import {
  getMapGlFallbackCountForAutoOff,
  isMapGlAutoOffActive,
  noteMapGlFallbackForAutoOff,
  noteMapGlWebGlRecoverFail,
  resetMapGlAutoOffForTests,
} from "./mapGlAutoOff";

describe("mapGlKillSwitch", () => {
  beforeEach(() => {
    resetMapGlKillSwitchForTests();
  });

  it("unread remote → not allowed", () => {
    setMapGlRemoteEnabledForTests(null);
    assert.equal(isMapGlRemoteAllowed(), false);
    assert.equal(getMapGlRemoteEnabledCached(), null);
  });

  it("remote false → not allowed", () => {
    setMapGlRemoteEnabledForTests(false);
    assert.equal(isMapGlRemoteAllowed(), false);
    assert.equal(getMapGlRemoteEnabledCached(), false);
  });

  it("remote true → allowed", () => {
    setMapGlRemoteEnabledForTests(true);
    assert.equal(isMapGlRemoteAllowed(), true);
    assert.equal(getMapGlRemoteEnabledCached(), true);
  });
});

describe("mapGlAutoOff", () => {
  beforeEach(() => {
    resetMapGlAutoOffForTests();
  });

  it("activates after 2 fallbacks", () => {
    assert.equal(isMapGlAutoOffActive(), false);
    noteMapGlFallbackForAutoOff();
    assert.equal(getMapGlFallbackCountForAutoOff(), 1);
    assert.equal(isMapGlAutoOffActive(), false);
    noteMapGlFallbackForAutoOff();
    assert.equal(isMapGlAutoOffActive(), true);
  });

  it("webgl recover fail activates", () => {
    noteMapGlWebGlRecoverFail();
    assert.equal(isMapGlAutoOffActive(), true);
  });
});
