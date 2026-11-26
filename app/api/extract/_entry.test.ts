import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClientExtractStartBody,
  classifyExtractEntry,
  parseExtractEntry,
  resolveExtractEntry,
} from "./_entry";

describe("parseExtractEntry", () => {
  it("allows share, share_fallback, app, unknown", () => {
    assert.equal(parseExtractEntry("share"), "share");
    assert.equal(parseExtractEntry("share_fallback"), "share_fallback");
    assert.equal(parseExtractEntry("app"), "app");
    assert.equal(parseExtractEntry("unknown"), "unknown");
  });

  it("rejects non-allowed values as unknown", () => {
    assert.equal(parseExtractEntry("web"), "unknown");
    assert.equal(parseExtractEntry(""), "unknown");
    assert.equal(parseExtractEntry(null), "unknown");
    assert.equal(parseExtractEntry(1), "unknown");
  });
});

describe("resolveExtractEntry", () => {
  const shareUa = "ShareExtension/1.0 CFNetwork/1490.0.4 Darwin/23.0.0";
  const appUa =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

  it("prefers allowed body.entry over UA", () => {
    assert.equal(resolveExtractEntry("app", shareUa), "app");
    assert.equal(resolveExtractEntry("share_fallback", appUa), "share_fallback");
    assert.equal(resolveExtractEntry("share", appUa), "share");
    assert.equal(resolveExtractEntry("unknown", shareUa), "unknown");
  });

  it("falls back to UA when body.entry missing or invalid", () => {
    assert.equal(resolveExtractEntry(undefined, shareUa), "share");
    assert.equal(resolveExtractEntry(null, appUa), "app");
    assert.equal(resolveExtractEntry("web", shareUa), "share");
    assert.equal(resolveExtractEntry({}, appUa), "app");
  });

  it("returns unknown when body missing and UA empty", () => {
    assert.equal(resolveExtractEntry(undefined, null), "unknown");
    assert.equal(resolveExtractEntry(undefined, ""), "unknown");
  });
});

describe("classifyExtractEntry (UA)", () => {
  it("still classifies ShareExtension UA as share", () => {
    assert.equal(
      classifyExtractEntry("ShareExtension/1.0 CFNetwork/1 Darwin/1"),
      "share",
    );
  });
});

describe("buildClientExtractStartBody", () => {
  it("share fallback path sends entry share_fallback", () => {
    assert.deepEqual(
      buildClientExtractStartBody({
        instagramUrl: "https://www.instagram.com/p/abc/",
        entry: "share_fallback",
      }),
      {
        instagramUrl: "https://www.instagram.com/p/abc/",
        forceRetry: false,
        entry: "share_fallback",
      },
    );
  });

  it("paste/input path sends entry app", () => {
    assert.deepEqual(
      buildClientExtractStartBody({
        instagramUrl: "https://www.instagram.com/reel/xyz/",
        forceRetry: true,
        entry: "app",
      }),
      {
        instagramUrl: "https://www.instagram.com/reel/xyz/",
        forceRetry: true,
        entry: "app",
      },
    );
  });
});
