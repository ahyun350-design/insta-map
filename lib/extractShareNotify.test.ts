import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideExtractShareNotify,
  kindFromExtractFailCode,
  messageForExtractShareKind,
} from "./extractShareNotify";

describe("decideExtractShareNotify", () => {
  it("does not notify for app entry (all_saved)", () => {
    assert.deepEqual(
      decideExtractShareNotify({ entry: "app", outcome: "all_saved" }),
      { notify: false },
    );
  });

  it("does not notify for app entry (failed)", () => {
    assert.deepEqual(
      decideExtractShareNotify({
        entry: "app",
        outcome: "failed",
        failCode: "no_places_in_caption",
      }),
      { notify: false },
    );
  });

  it("does not notify for unknown entry", () => {
    assert.deepEqual(
      decideExtractShareNotify({ entry: "unknown", outcome: "all_saved" }),
      { notify: false },
    );
  });

  it("notifies share + all_saved", () => {
    assert.deepEqual(
      decideExtractShareNotify({ entry: "share", outcome: "all_saved" }),
      {
        notify: true,
        kind: "all_saved",
        message: "이미 저장한 장소예요",
      },
    );
  });

  it("notifies share + no_places codes", () => {
    for (const failCode of ["no_places_in_caption", "caption_empty"]) {
      const d = decideExtractShareNotify({
        entry: "share",
        outcome: "failed",
        failCode,
      });
      assert.equal(d.notify, true);
      if (d.notify) {
        assert.equal(d.kind, "no_places");
        assert.equal(d.message, "이 릴스에서 장소를 찾지 못했어요");
      }
    }
  });

  it("notifies share + kakao_unresolved", () => {
    const d = decideExtractShareNotify({
      entry: "share",
      outcome: "failed",
      failCode: "kakao_unresolved|a,b",
    });
    assert.deepEqual(d, {
      notify: true,
      kind: "kakao_unresolved",
      message: "장소 위치를 찾지 못했어요",
    });
  });

  it("notifies share + overseas", () => {
    const d = decideExtractShareNotify({
      entry: "share",
      outcome: "failed",
      failCode: "overseas_unsupported",
    });
    assert.deepEqual(d, {
      notify: true,
      kind: "overseas",
      message: "해외 장소는 아직 지원하지 않아요",
    });
  });

  it("notifies share + timeout/other as failed", () => {
    for (const failCode of ["timeout", "process_trigger_failed", "weird"]) {
      const d = decideExtractShareNotify({
        entry: "share",
        outcome: "failed",
        failCode,
      });
      assert.deepEqual(d, {
        notify: true,
        kind: "failed",
        message: "추출에 실패했어요. 다시 시도해 주세요",
      });
    }
  });
});

describe("kindFromExtractFailCode / messages", () => {
  it("strips payload after |", () => {
    assert.equal(kindFromExtractFailCode("kakao_unresolved|x"), "kakao_unresolved");
  });

  it("all kind messages are short and non-empty", () => {
    for (const kind of [
      "all_saved",
      "no_places",
      "kakao_unresolved",
      "overseas",
      "failed",
    ] as const) {
      const m = messageForExtractShareKind(kind);
      assert.ok(m.length > 0 && m.length < 80);
    }
  });
});
