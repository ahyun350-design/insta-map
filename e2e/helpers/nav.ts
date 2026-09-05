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
 * Unauthenticated `/login` redirects to `/onboarding` until seen.
 * Finish onboarding (skip) then wait for the email/password form.
 */
export async function reachLoginForm(page: Page): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const email = loginEmailInput(page);
  const onboardingRoot = page.locator(".onboardingRoot, .onboardingRootFinal");
  const skipBtn = page.getByRole("button", { name: "건너뛰기" });
  const nextBtn = page.getByRole("button", { name: "다음" });
  const startBtn = page.getByRole("button", { name: "시작하기" });

  const homeTab = tabButton(page, "home");

  await Promise.race([
    email.waitFor({ state: "visible", timeout: 45_000 }),
    onboardingRoot.waitFor({ state: "visible", timeout: 45_000 }),
    homeTab.waitFor({ state: "visible", timeout: 45_000 }),
  ]).catch(() => null);

  if (await homeTab.isVisible().catch(() => false)) return;
  if (await email.isVisible().catch(() => false)) return;

  if (await onboardingRoot.isVisible().catch(() => false)) {
    if (await skipBtn.isVisible().catch(() => false)) {
      await safeClick(skipBtn);
    } else {
      for (let i = 0; i < 6; i++) {
        if (await email.isVisible().catch(() => false)) break;
        if (await startBtn.isVisible().catch(() => false)) {
          await safeClick(startBtn);
          break;
        }
        if (await nextBtn.isVisible().catch(() => false)) {
          await safeClick(nextBtn);
          await page.waitForTimeout(250);
          continue;
        }
        break;
      }
    }
  }

  await expect(email).toBeVisible({ timeout: 45_000 });
}

export async function gotoTab(page: Page, tab: MainTab): Promise<void> {
  await dismissCoachmarks(page);
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
