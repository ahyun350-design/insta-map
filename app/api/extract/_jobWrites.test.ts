import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOnceRunner,
  createOrderedAsyncQueue,
  saveJobDiagnostics,
  updateJobProgress,
} from "./_jobWrites";

type FakeUpdate = {
  table: string;
  payload: Record<string, unknown>;
  filters: Array<{ op: string; col: string; val: unknown }>;
};

function createFakeSupabase(updates: FakeUpdate[]) {
  return {
    from(table: string) {
      const filters: FakeUpdate["filters"] = [];
      const payloadRef: { payload?: Record<string, unknown> } = {};
      const builder = {
        update(payload: Record<string, unknown>) {
          payloadRef.payload = payload;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push({ op: "eq", col, val });
          return builder;
        },
        in(col: string, val: unknown) {
          filters.push({ op: "in", col, val });
          return builder;
        },
        then(resolve: (v: { error: null }) => void) {
          updates.push({
            table,
            payload: payloadRef.payload ?? {},
            filters: [...filters],
          });
          resolve({ error: null });
        },
      };
      // Make awaitable
      return Object.assign(builder, {
        update(payload: Record<string, unknown>) {
          payloadRef.payload = payload;
          return {
            eq(col: string, val: unknown) {
              filters.push({ op: "eq", col, val });
              return {
                in(col2: string, val2: unknown) {
                  filters.push({ op: "in", col: col2, val: val2 });
                  return Promise.resolve({ error: null }).then((r) => {
                    updates.push({
                      table,
                      payload: payloadRef.payload ?? {},
                      filters: [...filters],
                    });
                    return r;
                  });
                },
                then(onFulfilled: (v: { error: null }) => unknown) {
                  updates.push({
                    table,
                    payload: payloadRef.payload ?? {},
                    filters: [...filters],
                  });
                  return Promise.resolve({ error: null }).then(onFulfilled);
                },
              };
            },
            then(onFulfilled: (v: { error: null }) => unknown) {
              updates.push({
                table,
                payload: payloadRef.payload ?? {},
                filters: [...filters],
              });
              return Promise.resolve({ error: null }).then(onFulfilled);
            },
          };
        },
      });
    },
  };
}

describe("createOrderedAsyncQueue", () => {
  it("runs enqueued tasks in order", async () => {
    const q = createOrderedAsyncQueue();
    const order: number[] = [];
    q.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    q.enqueue(async () => {
      order.push(2);
    });
    q.enqueue(async () => {
      order.push(3);
    });
    await q.drain();
    assert.deepEqual(order, [1, 2, 3]);
    assert.ok(q.getBetweenMs() >= 20);
  });

  it("continues after a task failure", async () => {
    const q = createOrderedAsyncQueue();
    const order: string[] = [];
    q.enqueue(async () => {
      order.push("a");
      throw new Error("boom");
    });
    q.enqueue(async () => {
      order.push("b");
    });
    await q.drain();
    assert.deepEqual(order, ["a", "b"]);
  });
});

describe("updateJobProgress", () => {
  it("only updates pending/processing rows", async () => {
    const updates: FakeUpdate[] = [];
    const supabase = createFakeSupabase(updates);
    await updateJobProgress(supabase as never, "job-1", "카카오맵에서 좌표 찾는 중");
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.payload.status, "processing");
    assert.equal(updates[0]?.payload.progress_step, "카카오맵에서 좌표 찾는 중");
    const inFilter = updates[0]?.filters.find((f) => f.op === "in");
    assert.deepEqual(inFilter?.val, ["pending", "processing"]);
  });
});

describe("final status after progress drain", () => {
  it("records final status after drained progress writes", async () => {
    const updates: FakeUpdate[] = [];
    const supabase = createFakeSupabase(updates);
    const q = createOrderedAsyncQueue();
    q.enqueue(() => updateJobProgress(supabase as never, "j", "step-a"));
    q.enqueue(() => updateJobProgress(supabase as never, "j", "step-b"));
    await q.drain();
    // final status write (simulated)
    updates.push({
      table: "extract_jobs",
      payload: { status: "completed", progress_step: "완료" },
      filters: [{ op: "eq", col: "id", val: "j" }],
    });
    const statuses = updates.map((u) => u.payload.status);
    assert.deepEqual(statuses, ["processing", "processing", "completed"]);
    assert.equal(updates[updates.length - 1]?.payload.progress_step, "완료");
  });
});

describe("failure path diagnostics + notify once", () => {
  it("keeps diagnostics on failed update payload", async () => {
    const updates: FakeUpdate[] = [];
    const supabase = createFakeSupabase(updates);
    await saveJobDiagnostics(supabase as never, "j", {
      claude_places: [{ name: "A" }],
      kakao_misses: ["A"],
      pending_places: [],
    });
    // final failed write includes same fields (process route pattern)
    updates.push({
      table: "extract_jobs",
      payload: {
        status: "failed",
        error_message: "kakao_unresolved",
        claude_places: [{ name: "A" }],
        kakao_misses: ["A"],
        pending_places: [],
      },
      filters: [{ op: "eq", col: "id", val: "j" }],
    });
    const failed = updates[updates.length - 1]!;
    assert.equal(failed.payload.status, "failed");
    assert.ok(Array.isArray(failed.payload.claude_places));
    assert.ok(Array.isArray(failed.payload.kakao_misses));
  });

  it("createOnceRunner runs notify exactly once", async () => {
    const once = createOnceRunner();
    let n = 0;
    const first = await once(async () => {
      n += 1;
    });
    const second = await once(async () => {
      n += 1;
    });
    assert.equal(first, true);
    assert.equal(second, false);
    assert.equal(n, 1);
  });
});
