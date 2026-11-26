import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canConsumeAppGroupShare } from "./appGroupShareReady";

describe("canConsumeAppGroupShare", () => {
  it("requires both userId and non-empty accessToken", () => {
    assert.equal(
      canConsumeAppGroupShare({ userId: "u1", accessToken: "tok" }),
      true,
    );
  });

  it("waits when userId missing", () => {
    assert.equal(
      canConsumeAppGroupShare({ userId: null, accessToken: "tok" }),
      false,
    );
    assert.equal(
      canConsumeAppGroupShare({ userId: "", accessToken: "tok" }),
      false,
    );
    assert.equal(
      canConsumeAppGroupShare({ userId: undefined, accessToken: "tok" }),
      false,
    );
  });

  it("waits when accessToken missing — do not consume pending share yet", () => {
    assert.equal(
      canConsumeAppGroupShare({ userId: "u1", accessToken: null }),
      false,
    );
    assert.equal(
      canConsumeAppGroupShare({ userId: "u1", accessToken: "" }),
      false,
    );
    assert.equal(
      canConsumeAppGroupShare({ userId: "u1", accessToken: "   " }),
      false,
    );
    assert.equal(
      canConsumeAppGroupShare({ userId: "u1", accessToken: undefined }),
      false,
    );
  });
});
