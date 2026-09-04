import { defineConfig, devices } from "@playwright/test";
import { loadEnvLocal } from "./e2e/helpers/env";

loadEnvLocal();

/**
 * Production smoke tests against https://pindmap.com (mobile iPhone 13).
 * Credentials: E2E_EMAIL / E2E_PASSWORD in `.env.local`
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL: "https://pindmap.com",
    ...devices["iPhone 13"],
    // Keep iPhone 13 viewport/UA; run on Chromium (WebKit optional via e2e:install)
    browserName: "chromium",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    geolocation: { latitude: 37.5665, longitude: 126.978 },
    permissions: ["geolocation"],
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "iphone-13",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
      },
    },
  ],
});
