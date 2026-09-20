/**
 * Cold-cache + Fast 3G detail.firstPixel measurement.
 *
 *   MEASURE_BASE_URL=https://pindmap.com MEASURE_LABEL=after npx tsx e2e/measure-detail-first-pixel.ts
 *   MEASURE_BASE_URL=http://127.0.0.1:3005 MEASURE_LABEL=before npx tsx e2e/measure-detail-first-pixel.ts
 *
 * Each trial: fresh context. App shell loads unthrottled; immediately before opening
 * detail, CDP clears cache, disables cache, and applies Fast 3G. Metric prefers the
 * app's `[PindMap:perf] detail.firstPixel` console log; falls back to thumb-src match.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { loadEnvLocal } from "./helpers/env";
import { ensureLoggedIn } from "./helpers/login";
import {
  dismissCoachmarks,
  dismissWhatsNewIfPresent,
  gotoTab,
  suppressCoachmarks,
  waitForHomeFeed,
} from "./helpers/nav";

loadEnvLocal();

const BASE_URL = (process.env.MEASURE_BASE_URL || "https://pindmap.com").replace(/\/$/, "");
const LABEL = process.env.MEASURE_LABEL || "after";
const TRIALS = 5;

/** Chrome DevTools "Fast 3G" preset */
const FAST_3G = {
  offline: false,
  downloadThroughput: Math.floor((1.6 * 1024 * 1024) / 8),
  uploadThroughput: Math.floor((750 * 1024) / 8),
  latency: 150,
};

function median(arr: number[]): number {
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

async function enableColdFast3G(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", FAST_3G);
}

async function loginAndSaveState(browser: Browser): Promise<string> {
  const statePath = path.resolve(process.cwd(), `e2e/artifacts/measure-storage-${LABEL}.json`);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
    geolocation: { latitude: 37.5665, longitude: 126.978 },
    permissions: ["geolocation"],
  });
  await suppressCoachmarks(context);
  const page = await context.newPage();
  await ensureLoggedIn(page, { url: `${BASE_URL}/login` });
  await gotoTab(page, "home");
  await waitForHomeFeed(page);
  await dismissCoachmarks(page);
  await dismissWhatsNewIfPresent(page, 2_000);
  await context.storageState({ path: statePath });
  await context.close();
  return statePath;
}

async function openFreshPage(
  browser: Browser,
  statePath: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
    geolocation: { latitude: 37.5665, longitude: 126.978 },
    permissions: ["geolocation"],
    storageState: statePath,
  });
  await suppressCoachmarks(context);
  const page = await context.newPage();
  return { context, page };
}

async function selectChip(page: Page, label: string): Promise<void> {
  const chip = page.locator(".categoryFilterTab", { hasText: label }).first();
  await chip.waitFor({ state: "visible", timeout: 20_000 });
  await chip.click();
  await page.waitForTimeout(900);
}

async function measureOpen(page: Page, chipLabel: string): Promise<{ ms: number; source: string } | null> {
  const consoleSamples: number[] = [];
  const onConsole = async (msg: {
    text: () => string;
    args: () => { jsonValue: () => Promise<unknown> }[];
  }) => {
    if (!msg.text().includes("detail.firstPixel")) return;
    try {
      const args = msg.args();
      if (args.length < 2) return;
      const obj = (await args[1]!.jsonValue()) as { ms?: number | null };
      if (obj.ms != null && Number.isFinite(Number(obj.ms))) {
        consoleSamples.push(Number(obj.ms));
      }
    } catch {
      /* ignore */
    }
  };
  page.on("console", onConsole);

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await gotoTab(page, "home");
    await waitForHomeFeed(page);
    await dismissCoachmarks(page);
    await dismissWhatsNewIfPresent(page, 1_500);
    await selectChip(page, chipLabel);

    const cell = page.locator(".homeFeedGrid .postGridCell").first();
    await cell.waitFor({ state: "visible", timeout: 25_000 });
    const thumb = cell.locator("img").first();
    await thumb.waitFor({ state: "visible", timeout: 20_000 });
    await page
      .waitForFunction(() => {
        const img = document.querySelector(".homeFeedGrid .postGridCell img") as HTMLImageElement | null;
        return !!(img && img.complete && img.naturalWidth > 0);
      }, null, { timeout: 25_000 })
      .catch(() => null);

    const thumbSrc = (await thumb.getAttribute("src")) || "";
    if (!thumbSrc) return null;

    // Cold + Fast 3G only for the measured open.
    await enableColdFast3G(page);

    await page.evaluate(() => {
      (window as unknown as { __detailOpenAt?: number }).__detailOpenAt = performance.now();
    });
    await cell.click();
    await page.locator(".curationDetailOverlay").waitFor({ state: "visible", timeout: 20_000 });

    const thumbHandle = await page.waitForFunction(
      (src) => {
        const openAt = (window as unknown as { __detailOpenAt?: number }).__detailOpenAt;
        if (openAt == null) return null;
        const imgs = document.querySelectorAll(
          ".curationDetailOverlay img.feedPostMediaImg",
        ) as NodeListOf<HTMLImageElement>;
        const srcBase = src.split("?")[0] || src;
        for (const img of imgs) {
          const hay = img.currentSrc || img.src || "";
          const hayBase = hay.split("?")[0] || hay;
          if (hay === src || hayBase === srcBase || hay.includes(srcBase) || src.includes(hayBase)) {
            if (img.complete && img.naturalWidth > 0) {
              return Math.round(performance.now() - openAt);
            }
          }
        }
        return null;
      },
      thumbSrc,
      { timeout: 60_000 },
    );
    const msThumb = (await thumbHandle.jsonValue()) as number | null;

    const deadline = Date.now() + 2_000;
    while (consoleSamples.length === 0 && Date.now() < deadline) {
      await page.waitForTimeout(50);
    }

    if (consoleSamples.length > 0) {
      return { ms: consoleSamples[0]!, source: "console" };
    }
    if (msThumb != null) {
      return { ms: msThumb, source: "thumb" };
    }
    return null;
  } finally {
    page.off("console", onConsole);
  }
}

async function runChip(browser: Browser, statePath: string, chipLabel: string): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < TRIALS; i++) {
    const { context, page } = await openFreshPage(browser, statePath);
    try {
      const sample = await measureOpen(page, chipLabel);
      // eslint-disable-next-line no-console
      console.log(`${LABEL} ${chipLabel} #${i + 1}`, sample ?? "no-sample");
      if (sample) out.push(sample.ms);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`${LABEL} ${chipLabel} #${i + 1} ERROR`, String(err).slice(0, 300));
    } finally {
      await context.close();
    }
  }
  return out;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`Measuring ${LABEL} @ ${BASE_URL} (cold cache @ open, Fast 3G, n=${TRIALS})`);

  const browser = await chromium.launch({ headless: true });
  const statePath = await loginAndSaveState(browser);

  const chipsEnv = (process.env.MEASURE_CHIPS || "전체,쇼핑").split(",").map((s) => s.trim());
  const all = chipsEnv.includes("전체") ? await runChip(browser, statePath, "전체") : [];
  const shopping = chipsEnv.includes("쇼핑") ? await runChip(browser, statePath, "쇼핑") : [];

  const result = {
    label: LABEL,
    baseURL: BASE_URL,
    generatedAt: new Date().toISOString(),
    conditions: {
      cache: "clearBrowserCache+disabled at open",
      network: "Fast3G at open",
    },
    all: { samples: all, median: all.length ? median(all) : null },
    shopping: { samples: shopping, median: shopping.length ? median(shopping) : null },
  };

  // eslint-disable-next-line no-console
  console.log("\n========== COLD detail.firstPixel ==========");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  // eslint-disable-next-line no-console
  console.log("===========================================\n");

  const art = path.resolve(process.cwd(), "e2e/artifacts");
  fs.mkdirSync(art, { recursive: true });
  fs.writeFileSync(
    path.join(art, `detail-first-pixel-cold-${LABEL}.json`),
    JSON.stringify(result, null, 2),
    "utf8",
  );

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
