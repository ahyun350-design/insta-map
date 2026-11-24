import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APIFY_AUTH_WARN_CODE,
  APIFY_AUTH_WARN_REASON,
  isApifyAuthFailureText,
  notifyAdminApifyAuthFailure,
  shouldInsertApifyAuthAdminNotify,
} from "./_apifyAuthAlert";

describe("isApifyAuthFailureText", () => {
  it("detects user-or-token-not-found and 401/403 Apify errors", () => {
    assert.equal(
      isApifyAuthFailureText(
        'Apify 실행 실패: { "error": { "type": "user-or-token-not-found" } }',
      ),
      true,
    );
    assert.equal(isApifyAuthFailureText("Apify 실행 실패: http 401"), true);
    assert.equal(isApifyAuthFailureText("Apify run failed status 403"), true);
    assert.equal(isApifyAuthFailureText("apify_auth"), true);
    assert.equal(isApifyAuthFailureText("Apify 작업 실패"), false);
    assert.equal(isApifyAuthFailureText("concurrent-runs-limit-exceeded"), false);
    assert.equal(isApifyAuthFailureText("caption_empty"), false);
    assert.equal(isApifyAuthFailureText(""), false);
    assert.equal(isApifyAuthFailureText(null), false);
  });
});

describe("shouldInsertApifyAuthAdminNotify", () => {
  it("blocks when a same alert already exists in the window", () => {
    assert.equal(shouldInsertApifyAuthAdminNotify({ recentSameExists: false }), true);
    assert.equal(shouldInsertApifyAuthAdminNotify({ recentSameExists: true }), false);
  });
});

describe("notifyAdminApifyAuthFailure", () => {
  it("skips non-auth errors without writing", async () => {
    let inserts = 0;
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          gte() {
            return this;
          },
          limit() {
            return Promise.resolve({ data: [], error: null });
          },
          insert() {
            inserts += 1;
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    const status = await notifyAdminApifyAuthFailure(supabase as never, {
      jobId: "j1",
      errorText: "caption_empty",
    });
    assert.equal(status, "skipped");
    assert.equal(inserts, 0);
  });

  it("skips when a recent same alert exists (1h dedupe)", async () => {
    let inserts = 0;
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          gte() {
            return this;
          },
          limit() {
            return Promise.resolve({ data: [{ id: "n1" }], error: null });
          },
          insert() {
            inserts += 1;
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    const status = await notifyAdminApifyAuthFailure(supabase as never, {
      jobId: "j1",
      errorText: "Apify 실행 실패: user-or-token-not-found",
    });
    assert.equal(status, "skipped");
    assert.equal(inserts, 0);
  });

  it("inserts once for auth errors; notify failure does not throw", async () => {
    let inserts = 0;
    const okDb = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          gte() {
            return this;
          },
          limit() {
            return Promise.resolve({ data: [], error: null });
          },
          insert(row: { target_text?: string; actor_username?: string }) {
            inserts += 1;
            assert.equal(row.actor_username, APIFY_AUTH_WARN_CODE);
            assert.equal(row.target_text, APIFY_AUTH_WARN_REASON);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    const inserted = await notifyAdminApifyAuthFailure(okDb as never, {
      jobId: "j2",
      errorText: 'Apify 실행 실패: {"error":{"type":"user-or-token-not-found"}}',
    });
    assert.equal(inserted, "inserted");
    assert.equal(inserts, 1);

    const boomDb = {
      from() {
        throw new Error("db down");
      },
    };
    const failed = await notifyAdminApifyAuthFailure(boomDb as never, {
      jobId: "j3",
      errorText: "Apify 실행 실패: 401",
    });
    assert.equal(failed, "failed");
  });
});
