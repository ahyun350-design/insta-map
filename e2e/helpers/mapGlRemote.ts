import type { Page } from "@playwright/test";

/** Allow MapLibre remote kill for admin MapLibre e2e (default kill is Kakao). */
export async function e2eAllowMapGlRemote(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (
      window as unknown as { __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null }
    ).__PINDMAP_E2E_MAP_GL_REMOTE__ = true;
  });
}

/** Force remote kill OFF (Kakao for everyone). */
export async function e2eKillMapGlRemote(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (
      window as unknown as { __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null }
    ).__PINDMAP_E2E_MAP_GL_REMOTE__ = false;
  });
}

/** Simulate unread / fetch failure → Kakao. */
export async function e2eMapGlRemoteUnread(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (
      window as unknown as { __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null }
    ).__PINDMAP_E2E_MAP_GL_REMOTE__ = null;
  });
}
