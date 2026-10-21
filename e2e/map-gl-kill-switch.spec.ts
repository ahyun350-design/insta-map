/**
 * Local e2e: remote MapLibre kill switch + device auto-off gates.
 * Uses window.__PINDMAP_MAP_GL_GATE__ (no MapLibre mount required).
 */
import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/login";
import { suppressCoachmarks, dismissCoachmarks } from "./helpers/nav";
import { COMPACT_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/compactMapLibreFlag";
import { EXPANDED_MAPLIBRE_STORAGE_KEY } from "../lib/mapSurface/expandedMapLibreFlag";

const ADMIN_USER_ID = "63772749-e01b-4396-a41c-c17a4d3acfe6";

type Gate = {
  isRemoteAllowed: () => boolean;
  isAutoOff: () => boolean;
  shouldCompact: (isAdmin: boolean, userId?: string | null) => boolean;
  shouldExpanded: (isAdmin: boolean, userId?: string | null) => boolean;
  noteFallback: () => void;
  noteWebGlRecoverFail: () => void;
  resetAutoOff: () => void;
  activateAutoOff: () => void;
  setRemoteForTests: (v: boolean | null) => void;
};

async function waitGate(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __PINDMAP_MAP_GL_GATE__?: Gate })
          .__PINDMAP_MAP_GL_GATE__,
      ),
    { timeout: 45_000 },
  );
}

test.describe("map_gl kill switch + auto-off", () => {
  test("kill false → Kakao even with admin force_maplibre", async ({
    page,
    context,
  }) => {
    await page.addInitScript(
      ({ compactKey, expandedKey }) => {
        (
          window as unknown as { __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null }
        ).__PINDMAP_E2E_MAP_GL_REMOTE__ = false;
        window.localStorage.setItem(compactKey, "1");
        window.localStorage.setItem(expandedKey, "1");
      },
      {
        compactKey: COMPACT_MAPLIBRE_STORAGE_KEY,
        expandedKey: EXPANDED_MAPLIBRE_STORAGE_KEY,
      },
    );
    await suppressCoachmarks(context);
    await ensureLoggedIn(page);
    await page.goto("/");
    await dismissCoachmarks(page);
    await waitGate(page);
    const snap = await page.evaluate((adminId) => {
      const g = (window as unknown as { __PINDMAP_MAP_GL_GATE__: Gate })
        .__PINDMAP_MAP_GL_GATE__;
      return {
        remote: g.isRemoteAllowed(),
        compact: g.shouldCompact(true, adminId),
        expanded: g.shouldExpanded(true, adminId),
      };
    }, ADMIN_USER_ID);
    expect(snap.remote).toBe(false);
    expect(snap.compact).toBe(false);
    expect(snap.expanded).toBe(false);
  });

  test("kill true → admin force can request MapLibre (WebGL permitting)", async ({
    page,
    context,
  }) => {
    await page.addInitScript(
      ({ compactKey, expandedKey }) => {
        (
          window as unknown as { __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null }
        ).__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
        window.localStorage.setItem(compactKey, "1");
        window.localStorage.setItem(expandedKey, "1");
      },
      {
        compactKey: COMPACT_MAPLIBRE_STORAGE_KEY,
        expandedKey: EXPANDED_MAPLIBRE_STORAGE_KEY,
      },
    );
    await suppressCoachmarks(context);
    await ensureLoggedIn(page);
    await page.goto("/");
    await dismissCoachmarks(page);
    await waitGate(page);
    const snap = await page.evaluate((adminId) => {
      const g = (window as unknown as { __PINDMAP_MAP_GL_GATE__: Gate })
        .__PINDMAP_MAP_GL_GATE__;
      return {
        remote: g.isRemoteAllowed(),
        compact: g.shouldCompact(true, adminId),
        expanded: g.shouldExpanded(true, adminId),
      };
    }, ADMIN_USER_ID);
    expect(snap.remote).toBe(true);
    // Chromium has WebGL → admin force should allow MapLibre.
    expect(snap.compact).toBe(true);
    expect(snap.expanded).toBe(true);
  });

  test("unread / fetch-fail override → Kakao", async ({ page }) => {
    await page.addInitScript(
      ({ compactKey }) => {
        (
          window as unknown as { __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null }
        ).__PINDMAP_E2E_MAP_GL_REMOTE__ = null;
        window.localStorage.setItem(compactKey, "1");
      },
      { compactKey: COMPACT_MAPLIBRE_STORAGE_KEY },
    );
    await ensureLoggedIn(page);
    await page.goto("/");
    await waitGate(page);
    const snap = await page.evaluate((adminId) => {
      const g = (window as unknown as { __PINDMAP_MAP_GL_GATE__: Gate })
        .__PINDMAP_MAP_GL_GATE__;
      return {
        remote: g.isRemoteAllowed(),
        compact: g.shouldCompact(true, adminId),
      };
    }, ADMIN_USER_ID);
    expect(snap.remote).toBe(false);
    expect(snap.compact).toBe(false);
  });

  test("auto-off after 2 fallbacks pins Kakao for session", async ({ page }) => {
    await page.addInitScript(
      ({ compactKey }) => {
        (
          window as unknown as { __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null }
        ).__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
        window.localStorage.setItem(compactKey, "1");
      },
      { compactKey: COMPACT_MAPLIBRE_STORAGE_KEY },
    );
    await ensureLoggedIn(page);
    await page.goto("/");
    await waitGate(page);
    const snap = await page.evaluate((adminId) => {
      const g = (window as unknown as { __PINDMAP_MAP_GL_GATE__: Gate })
        .__PINDMAP_MAP_GL_GATE__;
      g.resetAutoOff();
      g.setRemoteForTests(true);
      const before = g.shouldCompact(true, adminId);
      g.noteFallback();
      const mid = { autoOff: g.isAutoOff(), compact: g.shouldCompact(true, adminId) };
      g.noteFallback();
      const after = {
        autoOff: g.isAutoOff(),
        compact: g.shouldCompact(true, adminId),
      };
      return { before, mid, after };
    }, ADMIN_USER_ID);
    expect(snap.before).toBe(true);
    expect(snap.mid.autoOff).toBe(false);
    expect(snap.mid.compact).toBe(true);
    expect(snap.after.autoOff).toBe(true);
    expect(snap.after.compact).toBe(false);
  });

  test("webgl recover fail activates auto-off", async ({ page }) => {
    await page.addInitScript(() => {
      (
        window as unknown as { __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null }
      ).__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
    });
    await ensureLoggedIn(page);
    await page.goto("/");
    await waitGate(page);
    const snap = await page.evaluate((adminId) => {
      const g = (window as unknown as { __PINDMAP_MAP_GL_GATE__: Gate })
        .__PINDMAP_MAP_GL_GATE__;
      g.resetAutoOff();
      g.setRemoteForTests(true);
      g.noteWebGlRecoverFail();
      return {
        autoOff: g.isAutoOff(),
        expanded: g.shouldExpanded(true, adminId),
      };
    }, ADMIN_USER_ID);
    expect(snap.autoOff).toBe(true);
    expect(snap.expanded).toBe(false);
  });
});
