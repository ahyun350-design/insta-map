import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { requireE2ECredentials } from "./env";
import {
  dismissCoachmarks,
  dismissWhatsNewIfPresent,
  loginEmailInput,
  loginPasswordInput,
  loginSubmitButton,
  safeClick,
  tabBar,
  tabButton,
} from "./nav";

const ARTIFACTS = path.resolve(process.cwd(), "e2e/artifacts");
const LOGIN_FAIL_DIR = path.join(ARTIFACTS, "login-failures");

async function dumpLoginFailure(page: Page, reason: string): Promise<void> {
  fs.mkdirSync(LOGIN_FAIL_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(LOGIN_FAIL_DIR, `${stamp}-login-fail`);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
  } catch {
    /* ignore */
  }
  try {
    const html = await page.content();
    const snippet = html.slice(0, 80_000);
    const meta = {
      reason,
      url: page.url(),
      title: await page.title().catch(() => ""),
      at: new Date().toISOString(),
    };
    fs.writeFileSync(
      `${base}.json`,
      JSON.stringify({ ...meta, htmlSnippet: snippet }, null, 2),
      "utf8",
    );
    fs.writeFileSync(`${base}.html`, snippet, "utf8");
  } catch (err) {
    fs.writeFileSync(
      `${base}.json`,
      JSON.stringify({ reason, error: String(err), url: page.url() }, null, 2),
      "utf8",
    );
  }
  // eslint-disable-next-line no-console
  console.error(`[e2e:login] failure artifacts → ${base}.{png,json,html}`);
}

async function isHomeReady(page: Page): Promise<boolean> {
  return tabButton(page, "home").isVisible().catch(() => false);
}

async function isLoginFormVisible(page: Page): Promise<boolean> {
  return loginEmailInput(page).isVisible().catch(() => false);
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const onboardingRoot = page.locator(".onboardingRoot, .onboardingRootFinal");
  if (!(await onboardingRoot.isVisible().catch(() => false))) return;

  const skipBtn = page.getByRole("button", { name: "건너뛰기" });
  const nextBtn = page.getByRole("button", { name: "다음" });
  const startBtn = page.getByRole("button", { name: "시작하기" });

  if (await skipBtn.isVisible().catch(() => false)) {
    await safeClick(skipBtn);
    return;
  }
  for (let i = 0; i < 6; i++) {
    if (await isLoginFormVisible(page)) return;
    if (await isHomeReady(page)) return;
    if (await startBtn.isVisible().catch(() => false)) {
      await safeClick(startBtn);
      return;
    }
    if (await nextBtn.isVisible().catch(() => false)) {
      await safeClick(nextBtn);
      await page.waitForTimeout(250);
      continue;
    }
    break;
  }
}

/**
 * Wait until splash/boot finishes enough to show either the login form or the app shell.
 * Does not assume the email field is immediately present.
 */
export async function waitForAppShellOrLogin(
  page: Page,
  timeoutMs = 60_000,
): Promise<"home" | "login"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await dismissOnboardingIfPresent(page);
    await dismissCoachmarks(page).catch(() => null);
    await dismissWhatsNewIfPresent(page, 400).catch(() => false);

    if (await isHomeReady(page)) return "home";
    if (await isLoginFormVisible(page)) return "login";

    await page.waitForTimeout(400);
  }

  await dumpLoginFailure(page, `timeout waiting for login form or tab-home (${timeoutMs}ms)`);
  throw new Error(
    `App shell / login form not ready within ${timeoutMs}ms (see e2e/artifacts/login-failures/)`,
  );
}

export type EnsureLoggedInOptions = {
  /** Default `/login` — onboarding redirect is handled. */
  url?: string;
  timeoutMs?: number;
};

/**
 * Single entry for e2e + measurement scripts:
 * - wait out splash/loading until login form OR tab-home
 * - already logged in → return
 * - else sign in with E2E_EMAIL / E2E_PASSWORD from `.env.local`
 */
export async function ensureLoggedIn(
  page: Page,
  opts: EnsureLoggedInOptions = {},
): Promise<void> {
  const { email, password } = requireE2ECredentials();
  const url = opts.url ?? "/login";
  const timeoutMs = opts.timeoutMs ?? 60_000;

  await page.goto(url, { waitUntil: "domcontentloaded" });

  let state: "home" | "login";
  try {
    state = await waitForAppShellOrLogin(page, timeoutMs);
  } catch (err) {
    throw err;
  }

  if (state === "home") {
    await dismissCoachmarks(page);
    return;
  }

  try {
    await loginEmailInput(page).fill(email);
    await loginPasswordInput(page).fill(password);
    await safeClick(loginSubmitButton(page));

    await expect(tabBar(page)).toBeVisible({ timeout: 45_000 });
    await expect(tabButton(page, "home")).toBeVisible({ timeout: 20_000 });
    await dismissCoachmarks(page);
    await dismissWhatsNewIfPresent(page, 2_000).catch(() => false);
  } catch (err) {
    await dumpLoginFailure(
      page,
      `login submit / tab bar failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

/** Re-export field locators for callers that only need the form. */
export function loginFormLocators(page: Page): {
  email: Locator;
  password: Locator;
  submit: Locator;
} {
  return {
    email: loginEmailInput(page),
    password: loginPasswordInput(page),
    submit: loginSubmitButton(page),
  };
}
