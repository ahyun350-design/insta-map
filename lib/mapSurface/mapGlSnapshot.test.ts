import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAP_GL_SNAPSHOT_MAX_BYTES,
  canPersistMapGlSnapshot,
  classifySnapshotSamples,
  dataUrlByteLength,
  distanceKm,
  isUsableSnapshotSamples,
  parseMapGlSnapshotMeta,
  sampleImageDataPixels,
  shouldUseMapGlSnapshot,
  shouldFadeSnapshotAfterReady,
  type SnapshotRgba,
} from "./mapGlSnapshot";

function jpegDataUrlOfApproxBytes(bytes: number): string {
  const b64Len = Math.ceil((bytes * 4) / 3);
  const b64 = "A".repeat(b64Len);
  return `data:image/jpeg;base64,${b64}`;
}

function solidImage(
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = a;
  }
  return { data, width: w, height: h };
}

function variedMapLike(
  w: number,
  h: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      // paper land + blue water bands + dark roads
      if (x % 17 === 0) {
        data[o] = 40;
        data[o + 1] = 40;
        data[o + 2] = 45;
      } else if (y > h * 0.4 && y < h * 0.55) {
        data[o] = 180;
        data[o + 1] = 210;
        data[o + 2] = 235;
      } else {
        data[o] = 247;
        data[o + 1] = 245;
        data[o + 2] = 240;
      }
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h };
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

describe("classifySnapshotSamples", () => {
  it("rejects solid black", () => {
    const samples = sampleImageDataPixels(solidImage(40, 40, 0, 0, 0), 5);
    assert.equal(classifySnapshotSamples(samples), "black");
    assert.equal(isUsableSnapshotSamples(samples), false);
  });

  it("rejects transparent", () => {
    const samples = sampleImageDataPixels(solidImage(40, 40, 0, 0, 0, 0), 5);
    assert.equal(classifySnapshotSamples(samples), "transparent");
    assert.equal(isUsableSnapshotSamples(samples), false);
  });

  it("rejects flat paper fill", () => {
    const samples = sampleImageDataPixels(solidImage(40, 40, 247, 245, 240), 5);
    assert.equal(classifySnapshotSamples(samples), "flat");
    assert.equal(isUsableSnapshotSamples(samples), false);
  });

  it("rejects flat near-black neon fill", () => {
    const samples = sampleImageDataPixels(solidImage(40, 40, 14, 18, 48), 5);
    assert.equal(classifySnapshotSamples(samples), "flat");
  });

  it("accepts varied map-like pixels", () => {
    const samples = sampleImageDataPixels(variedMapLike(64, 64), 5);
    assert.equal(classifySnapshotSamples(samples), "ok");
    assert.equal(isUsableSnapshotSamples(samples), true);
  });

  it("accepts hand-built varied sample list", () => {
    const samples: SnapshotRgba[] = [
      { r: 247, g: 245, b: 240, a: 255 },
      { r: 180, g: 210, b: 235, a: 255 },
      { r: 40, g: 40, b: 45, a: 255 },
      { r: 220, g: 230, b: 200, a: 255 },
      { r: 100, g: 120, b: 90, a: 255 },
      { r: 247, g: 245, b: 240, a: 255 },
      { r: 50, g: 80, b: 140, a: 255 },
      { r: 200, g: 190, b: 170, a: 255 },
      { r: 30, g: 30, b: 35, a: 255 },
    ];
    assert.equal(classifySnapshotSamples(samples), "ok");
  });
});
