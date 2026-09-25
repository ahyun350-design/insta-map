/**
 * Measure grid image bytes + chip switch + detail thumb→full swap after backfill.
 *   MEASURE_LABEL=after-backfill npx tsx e2e/measure-thumb-grid.ts
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
const LABEL = process.env.MEASURE_LABEL || "after-backfill";

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

  type Hit = { url: string; bytes: number; status: number };
  const imageHits: Hit[] = [];
  page.on("response", async (res) => {
    try {
      const u = res.url();
      if (!u.includes("/post-images/")) return;
      const rt = res.request().resourceType();
      if (rt !== "image" && rt !== "other") return;
      const status = res.status();
      let bytes = 0;
      const cl = res.headers()["content-length"];
      if (cl) bytes = Number(cl);
      if (!bytes) {
        const buf = await res.body().catch(() => null);
        if (buf) bytes = buf.length;
      }
      imageHits.push({ url: u, bytes, status });
    } catch {
      /* ignore */
    }
  });

  await ensureLoggedIn(page, { url: `${BASE}/login` });
  await gotoTab(page, "home");
  await waitForHomeFeed(page);
  await dismissCoachmarks(page);
  await dismissWhatsNewIfPresent(page, 2000);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  imageHits.length = 0;
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await gotoTab(page, "home");
  await waitForHomeFeed(page);
  await dismissCoachmarks(page);

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
    await page.waitForTimeout(400);
    chipTimes[label] = Date.now() - t0;
  }

  // --- grid scroll bytes on 전체 (cache disabled) ---
  const scrollStart = imageHits.length;
  await switchChip("전체");
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const sc = document.querySelector(".homeFeedScroll, .screen.homeFeed");
      if (sc) sc.scrollBy(0, 700);
      else window.scrollBy(0, 700);
    });
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  const scrollHits = imageHits.slice(scrollStart).filter((h) => h.status >= 200 && h.status < 400);
  const thumbHits = scrollHits.filter((h) => h.url.includes("_thumb"));
  const fullHits = scrollHits.filter((h) => !h.url.includes("_thumb"));
  const totalBytes = scrollHits.reduce((a, b) => a + b.bytes, 0);

  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });

  // chip switch with warm-ish cache allowed (real usage)
  await switchChip("카페");
  await switchChip("맛집");
  // re-measure 전체 after cache enable for fair chip table? User wants 전체/카페/맛집.
  // Re-do all three with cache enabled for chip comparison consistency
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await gotoTab(page, "home");
  await waitForHomeFeed(page);
  const chipWarm: Record<string, number> = {};
  for (const label of ["전체", "카페", "맛집"]) {
    const t0 = Date.now();
    await page.locator(".categoryFilterTab", { hasText: label }).first().click();
    await page
      .waitForFunction(() => {
        const img = document.querySelector(".homeFeedGrid .postGridCell img") as HTMLImageElement | null;
        return !!(img && img.complete && img.naturalWidth > 0);
      }, null, { timeout: 20000 })
      .catch(() => null);
    await page.waitForTimeout(300);
    chipWarm[label] = Date.now() - t0;
  }

  const logs: { ms?: number; index?: number }[] = [];
  page.on("console", async (msg) => {
    if (!msg.text().includes("detail.firstPixel")) return;
    try {
      logs.push((await msg.args()[1]!.jsonValue()) as { ms?: number });
    } catch {
      /* ignore */
    }
  });

  // Warm: ensure first grid thumb loaded, then open detail
  await page.locator(".categoryFilterTab", { hasText: "전체" }).first().click();
  await page.waitForTimeout(600);
  const cell = page.locator(".homeFeedGrid .postGridCell").first();
  await cell.waitFor({ state: "visible" });
  await page
    .waitForFunction(() => {
      const img = document.querySelector(".homeFeedGrid .postGridCell img") as HTMLImageElement | null;
      return !!(img && img.complete && img.naturalWidth > 0);
    })
    .catch(() => null);

  const before = logs.length;
  await cell.click();
  await page.locator(".curationDetailOverlay").waitFor({ state: "visible" });
  const tDeadline = Date.now() + 8000;
  while (logs.length <= before && Date.now() < tDeadline) await page.waitForTimeout(50);
  const warmMs = logs[logs.length - 1]?.ms ?? null;

  // Wait until FULL active image is painted (opacity 1, naturalWidth ~> 800)
  await page
    .waitForFunction(() => {
      const imgs = Array.from(
        document.querySelectorAll<HTMLImageElement>(".curationDetailOverlay img.feedPostMediaImg"),
      );
      const full = imgs.find((img) => {
        const src = img.currentSrc || img.src;
        return src.includes("/post-images/") && !src.includes("_thumb") && img.complete && img.naturalWidth >= 700;
      });
      if (!full) return false;
      return getComputedStyle(full).opacity === "1";
    }, null, { timeout: 20000 })
    .catch(() => null);

  await page.waitForTimeout(500);

  const art = path.resolve(process.cwd(), "e2e/artifacts");
  fs.mkdirSync(art, { recursive: true });
  await page.locator(".curationDetailOverlay .feedPostMedia").first().screenshot({
    path: path.join(art, `detail-quality-${LABEL}.png`),
  });

  const detailState = await page.evaluate(() => {
    const imgs = Array.from(
      document.querySelectorAll<HTMLImageElement>(".curationDetailOverlay img.feedPostMediaImg"),
    );
    return imgs.map((img) => ({
      src: (img.currentSrc || img.src).split("/").pop(),
      isThumb: (img.currentSrc || img.src).includes("_thumb"),
      opacity: getComputedStyle(img).opacity,
      w: img.naturalWidth,
      h: img.naturalHeight,
      complete: img.complete,
    }));
  });

  const fullVisible = detailState.some(
    (d) => !d.isThumb && d.opacity === "1" && d.complete && (d.w ?? 0) >= 700,
  );
  const thumbOnlyStuck = detailState.some(
    (d) => d.isThumb && d.opacity === "1" && d.complete,
  ) && !fullVisible;

  const out = {
    label: LABEL,
    baseURL: BASE,
    generatedAt: new Date().toISOString(),
    chipSwitchMs_cacheDisabled_scrollPhase: chipTimes,
    chipSwitchMs_warm: chipWarm,
    gridScroll: {
      imageRequestCount: scrollHits.length,
      thumbRequests: thumbHits.length,
      fullRequests: fullHits.length,
      totalBytes,
      totalMB: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
      thumbBytes: thumbHits.reduce((a, b) => a + b.bytes, 0),
      fullBytes: fullHits.reduce((a, b) => a + b.bytes, 0),
    },
    detailWarmFirstPixelMs: warmMs,
    detailFullSwapped: fullVisible,
    detailThumbStuck: thumbOnlyStuck,
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
