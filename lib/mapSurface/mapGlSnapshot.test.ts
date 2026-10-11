import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAP_GL_SNAPSHOT_MAX_BYTES,
  canPersistMapGlSnapshot,
  dataUrlByteLength,
  distanceKm,
  parseMapGlSnapshotMeta,
  shouldUseMapGlSnapshot,
  shouldFadeSnapshotAfterReady,
} from "./mapGlSnapshot";

function jpegDataUrlOfApproxBytes(bytes: number): string {
  // data:image/jpeg;base64, + base64 payload; bytes ≈ 3/4 of b64 length
  const b64Len = Math.ceil((bytes * 4) / 3);
  const b64 = "A".repeat(b64Len);
  return `data:image/jpeg;base64,${b64}`;
}

describe("distanceKm", () => {
  it("is ~0 for same point", () => {
    assert.ok(distanceKm({ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 }) < 0.01);
  });
  it("Seoul–Busan is far (>300km)", () => {
    const d = distanceKm(
      { lat: 37.5665, lng: 126.978 },
      { lat: 35.1796, lng: 129.0756 },
    );
    assert.ok(d > 300);
  });
});

describe("shouldUseMapGlSnapshot", () => {
  const base = {
    v: 1 as const,
    lat: 37.5665,
    lng: 126.978,
    level: 9,
    theme: 0 as const,
  };

  it("accepts nearby same level/theme", () => {
    assert.equal(
      shouldUseMapGlSnapshot(base, {
        lat: 37.57,
        lng: 126.98,
        level: 9,
        theme: 0,
      }),
      true,
    );
  });

  it("rejects other city (far)", () => {
    assert.equal(
      shouldUseMapGlSnapshot(base, {
        lat: 35.1796,
        lng: 129.0756,
        level: 9,
        theme: 0,
      }),
      false,
    );
  });

  it("rejects large level delta", () => {
    assert.equal(
      shouldUseMapGlSnapshot(base, {
        lat: 37.5665,
        lng: 126.978,
        level: 14,
        theme: 0,
      }),
      false,
    );
  });

  it("rejects theme mismatch", () => {
    assert.equal(
      shouldUseMapGlSnapshot(base, {
        lat: 37.5665,
        lng: 126.978,
        level: 9,
        theme: 1,
      }),
      false,
    );
  });

  it("rejects null/invalid meta", () => {
    assert.equal(
      shouldUseMapGlSnapshot(null, {
        lat: 37.5,
        lng: 127,
        level: 9,
        theme: 0,
      }),
      false,
    );
  });
});

describe("canPersistMapGlSnapshot / byte cap", () => {
  it("accepts small jpeg data url", () => {
    const url = jpegDataUrlOfApproxBytes(50_000);
    assert.ok(dataUrlByteLength(url) < MAP_GL_SNAPSHOT_MAX_BYTES);
    assert.equal(canPersistMapGlSnapshot(url), true);
  });

  it("rejects over cap", () => {
    const url = jpegDataUrlOfApproxBytes(MAP_GL_SNAPSHOT_MAX_BYTES + 20_000);
    assert.equal(canPersistMapGlSnapshot(url), false);
  });

  it("rejects non-image", () => {
    assert.equal(canPersistMapGlSnapshot("not-an-image"), false);
  });
});

describe("parseMapGlSnapshotMeta", () => {
  it("parses valid meta", () => {
    const m = parseMapGlSnapshotMeta(
      JSON.stringify({ v: 1, lat: 1, lng: 2, level: 9, theme: 0 }),
    );
    assert.deepEqual(m, { v: 1, lat: 1, lng: 2, level: 9, theme: 0 });
  });
  it("rejects bad json", () => {
    assert.equal(parseMapGlSnapshotMeta("{"), null);
  });
});


describe("shouldFadeSnapshotAfterReady", () => {
  it("fades only when live map ready and snapshot still shown", () => {
    assert.equal(
      shouldFadeSnapshotAfterReady({ liveMapReady: true, snapshotVisible: true }),
      true,
    );
    assert.equal(
      shouldFadeSnapshotAfterReady({ liveMapReady: false, snapshotVisible: true }),
      false,
    );
    assert.equal(
      shouldFadeSnapshotAfterReady({ liveMapReady: true, snapshotVisible: false }),
      false,
    );
  });
});
