import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  AUTH_FAIL_RATE_LIMIT_PER_MINUTE,
  allowAuthFailRecord,
  classifyAuthFailClient,
  classifyAuthFailReason,
  resetAuthFailRateLimitForTests,
} from "./_authFail";

describe("classifyAuthFailClient", () => {
  it("maps ShareExtension / CFNetwork UA to share_ext", () => {
    assert.equal(
      classifyAuthFailClient("ShareExtension/1.0 CFNetwork/1490 Darwin/23"),
      "share_ext",
    );
    assert.equal(
      classifyAuthFailClient("MyApp/1.0 CFNetwork/1 Darwin/1"),
      "share_ext",
    );
  });

  it("maps AppleWebKit+Mobile UA to webview", () => {
    assert.equal(
      classifyAuthFailClient(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      ),
      "webview",
    );
  });

  it("returns unknown for empty or other UA", () => {
    assert.equal(classifyAuthFailClient(null), "unknown");
    assert.equal(classifyAuthFailClient(""), "unknown");
    assert.equal(classifyAuthFailClient("curl/8.0"), "unknown");
  });
});

describe("classifyAuthFailReason", () => {
  it("returns no_header when Authorization missing", () => {
    assert.equal(
      classifyAuthFailReason({ hasBearerHeader: false }),
      "no_header",
    );
  });

  it("returns empty_token when bearer present but jwt empty", () => {
    assert.equal(
      classifyAuthFailReason({ hasBearerHeader: true, jwtEmpty: true }),
      "empty_token",
    );
  });

  it("returns expired for JWT expired messages", () => {
    assert.equal(
      classifyAuthFailReason({
        hasBearerHeader: true,
        jwtEmpty: false,
        authErrorMessage: "JWT expired",
      }),
      "expired",
    );
    assert.equal(
      classifyAuthFailReason({
        hasBearerHeader: true,
        jwtEmpty: false,
        authErrorMessage: "token is expired by timestamp",
      }),
      "expired",
    );
  });

  it("returns invalid_signature for signature/malformed jwt", () => {
    assert.equal(
      classifyAuthFailReason({
        hasBearerHeader: true,
        jwtEmpty: false,
        authErrorMessage: "invalid JWT: unable to parse or verify signature",
      }),
      "invalid_signature",
    );
    assert.equal(
      classifyAuthFailReason({
        hasBearerHeader: true,
        jwtEmpty: false,
        authErrorMessage: "token is malformed",
      }),
      "invalid_signature",
    );
  });

  it("returns user_not_found when user missing or message says so", () => {
    assert.equal(
      classifyAuthFailReason({
        hasBearerHeader: true,
        jwtEmpty: false,
        authErrorMessage: "User from sub claim in JWT does not exist",
      }),
      "user_not_found",
    );
    assert.equal(
      classifyAuthFailReason({
        hasBearerHeader: true,
        jwtEmpty: false,
        hasUser: false,
      }),
      "user_not_found",
    );
  });

  it("returns invalid_session as fallback", () => {
    assert.equal(
      classifyAuthFailReason({
        hasBearerHeader: true,
        jwtEmpty: false,
        authErrorMessage: "something else",
        hasUser: true,
      }),
      "invalid_session",
    );
  });
});

describe("allowAuthFailRecord rate limit", () => {
  beforeEach(() => {
    resetAuthFailRateLimitForTests();
  });

  it("allows up to N per minute for same client+reason", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < AUTH_FAIL_RATE_LIMIT_PER_MINUTE; i++) {
      assert.equal(
        allowAuthFailRecord("share_ext", "expired", { now }),
        true,
        `allow #${i + 1}`,
      );
    }
    assert.equal(
      allowAuthFailRecord("share_ext", "expired", { now: now + 1 }),
      false,
    );
  });

  it("does not share budget across different client or reason", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < AUTH_FAIL_RATE_LIMIT_PER_MINUTE; i++) {
      assert.equal(allowAuthFailRecord("share_ext", "expired", { now }), true);
    }
    assert.equal(allowAuthFailRecord("webview", "expired", { now }), true);
    assert.equal(allowAuthFailRecord("share_ext", "no_header", { now }), true);
  });

  it("resets after the one-minute window", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < AUTH_FAIL_RATE_LIMIT_PER_MINUTE; i++) {
      assert.equal(allowAuthFailRecord("share_ext", "expired", { now }), true);
    }
    assert.equal(
      allowAuthFailRecord("share_ext", "expired", { now: now + 60_000 }),
      true,
    );
  });
});
