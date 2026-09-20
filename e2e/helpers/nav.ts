import { expect, type Locator, type Page, type BrowserContext } from "@playwright/test";

export type MainTab = "home" | "message" | "map" | "saved" | "my";

const TAB_META: Record<
  MainTab,
  { testId: string; label: string }
> = {
  home: { testId: "tab-home", label: "HOME" },
  message: { testId: "tab-message", label: "MESSAGE" },
  map: { testId: "tab-map", label: "MAP" },
  saved: { testId: "tab-saved", label: "SAVED" },
  my: { testId: "tab-my", label: "MY" },
};

/** Mirrors lib/coachmarks.ts COACH_ORDER */
export const COACH_IDS = [
  "reels_save",
  "curation_new",
  "map_search",
  "course_create",
  "course_share",
  "message_friend",
] as const;

/**
 * Coachmarks are stored via Capacitor Preferences (web → localStorage
 * key `CapacitorStorage.pindmap_coach_<id>`), with plain `pindmap_coach_<id>`
 * as catch fallback. Seed both so hasSeenCoach() returns true.
 */
export async function suppressCoachmarks(context: BrowserContext): Promise<void> {
  await context.addInitScript((ids: readonly string[]) => {
    const value = "1";
    for (const id of ids) {
      const key = `pindmap_coach_${id}`;
      try {
        window.localStorage.setItem(key, value);
        window.localStorage.setItem(`CapacitorStorage.${key}`, value);
      } catch {
        /* ignore quota / private mode */
      }
    }
  }, COACH_IDS);
}

/** Login email field — prefers data-testid, falls back to current production markup. */
export function loginEmailInput(page: Page): Locator {
  return page.getByTestId("login-email").or(page.getByPlaceholder("이메일"));
}

export function loginPasswordInput(page: Page): Locator {
  return page.getByTestId("login-password").or(page.getByPlaceholder("비밀번호"));
}

export function loginSubmitButton(page: Page): Locator {
  return page
    .getByTestId("login-submit")
    .or(page.locator('form button[type="submit"]'))
    .or(page.getByRole("button", { name: "로그인", exact: true }));
}

export function tabButton(page: Page, tab: MainTab): Locator {
  const { testId, label } = TAB_META[tab];
  return page
    .getByTestId(testId)
    .or(page.locator("nav.tabBar button.tabItem", { hasText: label }))
    .or(page.locator(".tabBarPill button.tabItem", { hasText: label }));
}

export function tabBar(page: Page): Locator {
  return page.locator("nav.tabBar, .tabBarPill").first();
}

/**
 * Coachmarks are full-screen dialogs that intercept clicks.
 * Dismiss while `.coachmarkRoot` is visible (up to `max` times).
 */
export async function dismissCoachmarks(page: Page, max = 5): Promise<void> {
  for (let i = 0; i < max; i++) {
    const root = page.locator(".coachmarkRoot");
    const visible = await root.first().isVisible().catch(() => false);
    if (!visible) return;

    const close = root
      .first()
      .getByRole("button", { name: "닫기" })
      .or(root.first().locator("button.coachmarkBackdrop"));
    await close.first().click({ force: true });
    await page.waitForTimeout(350);
  }
}

/**
 * Whats New modal (existing-user intro). Returns true if it was visible and closed.
 * Short timeout — absence is normal when already seen.
 */
export async function dismissWhatsNewIfPresent(
  page: Page,
  timeoutMs = 4500,
): Promise<boolean> {
  const root = page
    .getByTestId("whats-new-modal")
    .or(page.locator(".whatsNewRoot[role='dialog']"))
    .or(page.locator(".whatsNewRoot"));

  try {
    await root.first().waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    return false;
  }

  const close = page
    .getByTestId("whats-new-skip")
    .or(page.getByTestId("whats-new-close"))
    .or(root.first().getByRole("button", { name: "건너뛰기" }))
    .or(root.first().locator("button.whatsNewSkip"));

  await close.first().click({ force: true });
  await expect(root.first())
    .toBeHidden({ timeout: 5_000 })
    .catch(async () => {
      await page.keyboard.press("Escape").catch(() => null);
      await expect(root.first()).toBeHidden({ timeout: 3_000 });
    });
  return true;
}

/**
 * Close SAVED-tab sheets/overlays that can cover 「내 목록」.
 * Place detail / add-to-list / my-lists confirm — best-effort.
 */
export async function dismissSavedOverlays(page: Page): Promise<void> {
  await dismissCoachmarks(page);

  const addSheet = page.locator(".placeListSheet");
  if (await addSheet.isVisible().catch(() => false)) {
    const close = addSheet.getByRole("button", { name: "닫기" });
    if (await close.isVisible().catch(() => false)) {
      await close.click({ force: true }).catch(() => null);
    } else {
      await page.keyboard.press("Escape").catch(() => null);
    }
    await expect(addSheet).toBeHidden({ timeout: 5_000 }).catch(() => null);
  }

  const detail = page.locator(".placeDetailSheet");
  if (await detail.first().isVisible().catch(() => false)) {
    const close = detail.getByRole("button", { name: "닫기" }).first();
    if (await close.isVisible().catch(() => false)) {
      await close.click({ force: true }).catch(() => null);
    } else {
      await page.keyboard.press("Escape").catch(() => null);
    }
    await expect(page.locator(".placeDetailSheet")).toHaveCount(0, { timeout: 5_000 }).catch(() => null);
  }

  // Sort dropdown open — click away
  const sortMenu = page.locator(".savedSortMenu");
  if (await sortMenu.isVisible().catch(() => false)) {
    await page.locator(".savedSortTrigger").click({ force: true }).catch(() => null);
    await expect(sortMenu).toBeHidden({ timeout: 3_000 }).catch(() => null);
  }

  // 내 목록 전체 화면 — 상세면 ← 로 목록으로 나간 뒤 닫기
  const myLists = page.locator(".myListsScreen");
  if (await myLists.isVisible().catch(() => false)) {
    const actionSheet = page.locator(".listDetailActionSheet");
    if (await actionSheet.isVisible().catch(() => false)) {
      await actionSheet.getByRole("button", { name: "취소" }).click({ force: true }).catch(() => null);
      await expect(actionSheet).toBeHidden({ timeout: 3_000 }).catch(() => null);
    }
    // 상세 헤더는 aria-label 없이 "←" 텍스트만 있음 → 목록으로 복귀 후 닫기
    for (let i = 0; i < 2; i++) {
      if (!(await myLists.isVisible().catch(() => false))) break;
      const close = myLists.getByRole("button", { name: "닫기" });
      if (await close.isVisible().catch(() => false)) {
        await close.click({ force: true }).catch(() => null);
        break;
      }
      const back = myLists.locator(".myListsHeaderBtn").first();
      if (await back.isVisible().catch(() => false)) {
        await back.click({ force: true }).catch(() => null);
      } else {
        break;
      }
    }
    await expect(myLists).toBeHidden({ timeout: 5_000 }).catch(() => null);
  }
}

export function savedMyListsButton(page: Page): Locator {
  return page
    .getByTestId("saved-my-lists")
    .or(page.locator("button.savedMyListsPill"))
    .or(page.getByRole("button", { name: "내 목록", exact: true }));
}

/**
 * Click with retry when a coachmark (or similar overlay) intercepts pointer events.
 */
export async function safeClick(
  locator: Locator,
  options?: Parameters<Locator["click"]>[0],
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await locator.click(options);
      return;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const intercepted =
        /intercepts pointer events/i.test(msg) ||
        /not receive (click|pointer)/i.test(msg) ||
        /subtree intercepts/i.test(msg);
      if (!intercepted || attempt === 3) throw err;
      await dismissCoachmarks(locator.page());
      await locator.page().waitForTimeout(200);
    }
  }
  throw lastError;
}

/**
 * @deprecated Use `ensureLoggedIn` from `./login`.
 * Kept as a thin alias so older call sites keep working.
 */
export async function reachLoginForm(page: Page): Promise<void> {
  const { ensureLoggedIn } = await import("./login");
  await ensureLoggedIn(page);
}

export async function gotoTab(page: Page, tab: MainTab): Promise<void> {
  await dismissCoachmarks(page);
  // Place sheet on MAP can cover the tab bar — close before switching away from map
  if (tab !== "map") {
    await dismissSavedOverlays(page);
  }
  const btn = tabButton(page, tab);
  await expect(btn).toBeVisible({ timeout: 30_000 });
  await safeClick(btn);
  await expect
    .poll(async () => {
      const selected = await btn.getAttribute("aria-selected");
      if (selected === "true") return true;
      const cls = (await btn.getAttribute("class")) ?? "";
      return cls.includes("tabItemActive");
    }, { timeout: 10_000 })
    .toBeTruthy();
}

/**
 * HOME feed markers (from app/page.tsx):
 * - shell: `.screen.homeFeed` / `.homeFeedScroll`
 * - loaded chrome: `.homeFeedStickyBar` (when !loading)
 * - with posts: `.homeFeedGrid` (PostGrid className)
 * - empty: EmptyState h3 "아직 큐레이션이 없어요" (or filter variants)
 * - error: "다시 시도" button
 */
export async function waitForHomeFeed(page: Page): Promise<void> {
  await expect(tabButton(page, "home")).toBeVisible({ timeout: 45_000 });

  const feed = page.locator(".screen.homeFeed, .homeFeedScroll").first();
  await expect(feed).toBeVisible({ timeout: 45_000 });

  const ready = page
    .locator(".homeFeedStickyBar")
    .or(page.locator(".homeFeedGrid"))
    .or(page.getByRole("heading", { name: /큐레이션이 없어요/ }))
    .or(page.getByText("아직 큐레이션이 없어요", { exact: true }))
    .or(page.getByText(/아직 .+ 큐레이션이 없어요/))
    .or(page.getByRole("button", { name: /다시 시도/ }));

  await expect(ready.first()).toBeVisible({ timeout: 45_000 });
}

/** Assert feed content (grid cells or empty/error copy) after waitForHomeFeed. */
export async function assertHomeFeedContent(page: Page): Promise<void> {
  const grid = page.locator(".homeFeedGrid");
  const hasGrid = (await grid.count()) > 0 && (await grid.locator("> *").count()) > 0;
  const emptyOrFilter = page.getByRole("heading", { name: /큐레이션이 없어요/ });
  const isEmpty = await emptyOrFilter.first().isVisible().catch(() => false);
  const hasError = await page
    .getByRole("button", { name: /다시 시도/ })
    .isVisible()
    .catch(() => false);
  const sticky = await page.locator(".homeFeedStickyBar").isVisible().catch(() => false);

  expect(
    hasGrid || isEmpty || hasError || sticky,
    "HOME 피드: 그리드 / 빈 상태 / 에러 / 상단바 중 하나",
  ).toBeTruthy();
}

/**
 * Dispatch a left-edge → right swipe on `document` (matches useEdgeSwipeBack).
 * Uses TouchEvent so it works even when Playwright pointer APIs differ.
 */
export async function edgeSwipeBack(
  page: Page,
  opts?: { startX?: number; startY?: number; dx?: number; dy?: number },
): Promise<void> {
  const startX = opts?.startX ?? 12;
  const startY = opts?.startY ?? 360;
  const dx = opts?.dx ?? 80;
  const dy = opts?.dy ?? 0;
  await page.evaluate(
    ({ startX: sx, startY: sy, dx: moveX, dy: moveY }) => {
      const fire = (
        type: "touchstart" | "touchmove" | "touchend",
        x: number,
        y: number,
        touching: boolean,
      ) => {
        const target = document.documentElement;
        const touch = new Touch({
          identifier: 1,
          target,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          screenX: x,
          screenY: y,
          radiusX: 1,
          radiusY: 1,
          rotationAngle: 0,
          force: touching ? 1 : 0,
        });
        const list = touching ? [touch] : [];
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: list,
            targetTouches: list,
            changedTouches: [touch],
          }),
        );
      };
      fire("touchstart", sx, sy, true);
      fire("touchmove", sx + moveX * 0.4, sy + moveY * 0.4, true);
      fire("touchmove", sx + moveX, sy + moveY, true);
      fire("touchend", sx + moveX, sy + moveY, false);
    },
    { startX, startY, dx, dy },
  );
}
