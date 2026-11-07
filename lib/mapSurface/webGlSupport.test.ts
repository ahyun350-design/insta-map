import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Mods = {
  ws: typeof import("./webGlSupport");
  rollout: typeof import("./rollout");
  expanded: typeof import("./expandedMapLibreFlag");
  compact: typeof import("./compactMapLibreFlag");
};
let m: Mods;

const ADMIN = "63772749-e01b-4396-a41c-c17a4d3acfe6";
const store = new Map<string, string>();
const gl = { getContext: 0, lost: 0, supported: true };
const win: Record<string, unknown> = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  __PINDMAP_E2E_MAP_GL_REMOTE__: true,
};

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://unit-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "unit-test-anon";
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      getContext: () => {
        gl.getContext += 1;
        if (!gl.supported) return null;
        return { getExtension: () => ({ loseContext: () => void (gl.lost += 1) }) };
      },
    }),
  };
  m = {
    ws: await import("./webGlSupport"),
    rollout: await import("./rollout"),
    expanded: await import("./expandedMapLibreFlag"),
    compact: await import("./compactMapLibreFlag"),
  };
});

beforeEach(() => {
  m.ws.resetWebGlSupportForTests();
  store.clear();
  gl.getContext = 0;
  gl.lost = 0;
  gl.supported = true;
  delete win.__PINDMAP_E2E_FORCE_MAPLIBRE__;
});

test("admin force MapLibre: 50 render-time gate calls probe WebGL once and release it", () => {
  store.set(m.expanded.EXPANDED_MAPLIBRE_STORAGE_KEY, "1");
  store.set(m.compact.COMPACT_MAPLIBRE_STORAGE_KEY, "1");
  for (let i = 0; i < 25; i++) {
    assert.equal(m.expanded.shouldUseExpandedMapLibre(true, ADMIN), true);
    assert.equal(m.compact.shouldUseCompactMapLibre(true, ADMIN), true);
  }
  assert.equal(m.ws.webGlSupportProbeCount(), 1);
  assert.equal(gl.getContext, 1);
  assert.equal(gl.lost, 1);
});

test("e2e force goes through the same once-per-session WebGL check", () => {
  win.__PINDMAP_E2E_FORCE_MAPLIBRE__ = true;
  for (let i = 0; i < 10; i++) assert.equal(m.expanded.shouldUseExpandedMapLibre(false, "u"), true);
  assert.equal(m.ws.webGlSupportProbeCount(), 1);
  gl.supported = false;
  m.ws.resetWebGlSupportForTests();
  assert.equal(m.expanded.shouldUseExpandedMapLibre(false, "u"), false);
});

test("general users (rollout 0%) never probe WebGL", () => {
  for (let i = 0; i < 10; i++) {
    assert.equal(m.expanded.shouldUseExpandedMapLibre(false, "some-user"), false);
    assert.equal(m.compact.shouldUseCompactMapLibre(false, "some-user"), false);
  }
  assert.equal(m.ws.webGlSupportProbeCount(), 0);
  assert.equal(gl.getContext, 0);
});

test("shouldUseMapLibreOnce matches rollout.shouldUseMapLibre for every input", () => {
  for (const supported of [true, false]) {
    gl.supported = supported;
    for (const isAdmin of [true, false]) {
      for (const adminOverride of ["auto", "force_maplibre", "force_kakao"] as const) {
        for (const sessionForceKakao of [true, false]) {
          for (const userId of [ADMIN, "u-1", null]) {
            m.ws.resetWebGlSupportForTests();
            const input = { isAdmin, userId, sessionForceKakao, adminOverride };
            assert.equal(
              m.ws.shouldUseMapLibreOnce(input),
              m.rollout.shouldUseMapLibre(input),
              JSON.stringify({ supported, ...input }),
            );
          }
        }
      }
    }
  }
});
