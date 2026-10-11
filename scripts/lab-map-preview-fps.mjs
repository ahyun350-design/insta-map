/**
 * Sample /map-preview?pins=1000&fps=1 for ~6s and print avg/min FPS.
 * Usage: node scripts/lab-map-preview-fps.mjs [baseURL] [label]
 */
import { chromium, devices } from "@playwright/test";

const BASE = process.argv[2] || "https://pindmap.com";
const LABEL = process.argv[3] || "fps";
const iphone = devices["iPhone 13"];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...iphone,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/map-preview?pins=1000&fps=1`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => window.__PINDMAP_PREVIEW_DIAG__?.loadMs != null,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(6500);
  const text = await page.locator(".map-preview-diag").innerText().catch(() => "");
  const avgMatch = text.match(/5초 평균\s+(\d+)/);
  const minMatch = text.match(/최저\s+(\d+)/);
  const curMatch = text.match(/FPS\s+(\d+)/);
  const out = {
    label: LABEL,
    base: BASE,
    current: curMatch ? Number(curMatch[1]) : null,
    avg5: avgMatch ? Number(avgMatch[1]) : null,
    min5: minMatch ? Number(minMatch[1]) : null,
    raw: text.replace(/\s+/g, " ").trim(),
  };
  console.log(JSON.stringify(out));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
