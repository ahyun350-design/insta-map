/**
 * Measure grid image bytes + chip switch latency on production.
 *   MEASURE_LABEL=before npx tsx e2e/measure-thumb-grid.ts
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "@playwright/test";
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

const BASE = (process.env.MEASURE_BASE_URL || "https://pindmap.com").replace(/\/$/, "");
const LABEL = process.env.MEASURE_LABEL || "before";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
    geolocation: { latitude: 37.5665, longitude: 126.978 },
    permissions: ["geolocation"],
  });
  await suppressCoachmarks(context);
  const page = await context.newPage();

  const imageBytes: { url: string; bytes: number }[] = [];
  page.on("response", async (res) => {
    try {
      const u = res.url();
      if (!u.includes("/post-images/")) return;
      if (res.request().resourceType() !== "image") return;
      const buf = await res.body().catch(() => null);
      if (buf) imageBytes.push({ url: u, bytes: buf.length });
    } catch {
      /* ignore */
    }
  });

  await ensureLoggedIn(page, { url: `${BASE}/login` });
  await gotoTab(page, "home");
  await waitForHomeFeed(page);
  await dismissCoachmarks(page);
  await dismissWhatsNewIfPresent(page, 2000);

  // Chip switch timings: 전체 → 카페 → 맛집
  const chipTimes: Record<string, number> = {};
  async function switchChip(label: string) {
    const t0 = Date.now();
    await page.locator(".categoryFilterTab", { hasText: label }).first().click();
    await page
      .waitForFunction(() => {
        const img = document.querySelector(".homeFeedGrid .postGridCell img") as HTMLImageElement | null;
        return !!(img && img.complete && img.naturalWidth > 0);
      }, null, { timeout: 20000 })
      .catch(() => null);
    await page.waitForTimeout(300);
    chipTimes[label] = Date.now() - t0;
  }

  imageBytes.length = 0;
  await switchChip("전체");
  // scroll grid to load more images
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const sc = document.querySelector(".homeFeedScroll, .screen.homeFeed");
      if (sc) sc.scrollBy(0, 600);
      else window.scrollBy(0, 600);
    });
    await page.waitForTimeout(400);
  }
  const afterScrollBytes = imageBytes.reduce((a, b) => a + b.bytes, 0);
  const afterScrollCount = imageBytes.length;
  const thumbReqs = imageBytes.filter((x) => x.url.includes("_thumb")).length;
  const fullReqs = afterScrollCount - thumbReqs;

  await switchChip("카페");
  await switchChip("맛집");

  // Detail warm firstPixel + screenshot for quality
  const logs: { ms?: number; index?: number }[] = [];
  page.on("console", async (msg) => {
    if (!msg.text().includes("detail.firstPixel")) return;
    try {
      logs.push((await msg.args()[1]!.jsonValue()) as { ms?: number });
    } catch {
      /* ignore */
    }
  });

  await switchChip("전체");
  const cell = page.locator(".homeFeedGrid .postGridCell").first();
  await cell.waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  const before = logs.length;
  await cell.click();
  await page.locator(".curationDetailOverlay").waitFor({ state: "visible" });
  const tDeadline = Date.now() + 8000;
  while (logs.length <= before && Date.now() < tDeadline) await page.waitForTimeout(50);
  const warmMs = logs[logs.length - 1]?.ms ?? null;

  const art = path.resolve(process.cwd(), "e2e/artifacts");
  fs.mkdirSync(art, { recursive: true });
  await page.locator(".curationDetailOverlay .feedPostMediaImg").first().screenshot({
    path: path.join(art, `detail-quality-${LABEL}.png`),
  });

  // Check if full (opacity 1) is showing — naturalWidth of topmost loaded full
  const detailState = await page.evaluate(() => {
    const imgs = Array.from(
      document.querySelectorAll<HTMLImageElement>(".curationDetailOverlay img.feedPostMediaImg"),
    );
    return imgs.map((img) => ({
      src: (img.currentSrc || img.src).split("/").pop(),
      opacity: getComputedStyle(img).opacity,
      w: img.naturalWidth,
      h: img.naturalHeight,
      complete: img.complete,
    }));
  });

  const out = {
    label: LABEL,
    baseURL: BASE,
    generatedAt: new Date().toISOString(),
    chipSwitchMs: chipTimes,
    gridScroll: {
      imageRequestCount: afterScrollCount,
      thumbRequests: thumbReqs,
      fullRequests: fullReqs,
      totalBytes: afterScrollBytes,
      totalMB: Math.round((afterScrollBytes / 1024 / 1024) * 100) / 100,
    },
    detailWarmFirstPixelMs: warmMs,
    detailState,
  };
  fs.writeFileSync(path.join(art, `thumb-grid-${LABEL}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
