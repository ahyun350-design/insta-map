import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapPreviewE2eTokenFromSecret } from "./mapPreviewAccess";

describe("mapPreviewE2eTokenFromSecret", () => {
  it("derives stable 32-char hex", () => {
    const a = mapPreviewE2eTokenFromSecret("test-secret");
    const b = mapPreviewE2eTokenFromSecret("test-secret");
    assert.equal(a, b);
    assert.equal(a?.length, 32);
  });

  it("returns null for empty", () => {
    assert.equal(mapPreviewE2eTokenFromSecret(""), null);
    assert.equal(mapPreviewE2eTokenFromSecret(null), null);
  });
});
