/**
 * Post-backfill verification: chip switch, grid bytes, detail warm/cold, quality.
 *   npx tsx e2e/verify-thumbs-after-backfill.ts
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

const BASE = "https://pindmap.com";
const FAST_3G = {
  offline: false,
  downloadThroughput: Math.floor((1.6 * 1024 * 1024) / 8),
  uploadThroughput: Math.floor((750 * 1024) / 8),
  latency: 150,
};

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

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

  type ImgHit = { url: string; bytes: number; status: number };
  const imageHits: ImgHit[] = [];
  page.on("response", async (res) => {
    try {
      const u = res.url();
      if (!u.includes("/post-images/")) return;
      if (res.request().resourceType() !== "image" && !u.match(/\.(jpg|jpeg|webp)(\?|$)/i)) return;
      const status = res.status();
      let bytes = 0;
      const cl = res.headers()["content-length"];
      if (cl) bytes = Number(cl);
      else {
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
  await page.reload({ waitUntil: "domcontentloaded" });
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

  imageHits.length = 0;
  await switchChip("전체");
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      const sc = document.querySelector(".homeFeedScroll, .screen.homeFeed");
      if (sc) (sc as HTMLElement).scrollBy(0, 800);
      else window.scrollBy(0, 800);
    });
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(1500);

  const scrollHits = [...imageHits];
  const scrollBytes = scrollHits.reduce((a, b) => a + b.bytes, 0);
  const thumbHits = scrollHits.filter((h) => h.url.includes("_thumb"));
  const fullHits = scrollHits.filter((h) => !h.url.includes("_thumb"));

  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await switchChip("카페");
  await switchChip("맛집");

  // --- Detail warm: allow cache, wait for FULL swap ---
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
  // warm thumbs in grid
  await page.waitForTimeout(800);
  const beforeLog = logs.length;
  await page.locator(".homeFeedGrid .postGridCell").first().click();
  await page.locator(".curationDetailOverlay").waitFor({ state: "visible" });

  const warmDeadline = Date.now() + 5000;
  while (logs.length <= beforeLog && Date.now() < warmDeadline) await page.waitForTimeout(40);
  const warmMs = logs[logs.length - 1]?.ms ?? null;

  // Wait until active full image is painted (opacity 1, naturalWidth > 400)
  await page
    .waitForFunction(() => {
      const slides = document.querySelectorAll(".curationDetailOverlay .feedPostMediaSlide");
      const active = slides[0] || document.querySelector(".curationDetailOverlay .feedPostMediaSlide");
      if (!active) return false;
      const imgs = Array.from(active.querySelectorAll<HTMLImageElement>("img.feedPostMediaImg"));
      const full = imgs.find((im) => !/_thumb(\.|$)/.test(im.currentSrc || im.src));
      if (!full) return false;
      const op = getComputedStyle(full).opacity;
      return full.complete && full.naturalWidth >= 700 && op === "1";
    }, null, { timeout: 20000 })
    .catch(() => null);

  await page.waitForTimeout(300);
  const art = path.resolve(process.cwd(), "e2e/artifacts");
  fs.mkdirSync(art, { recursive: true });
  await page.locator(".curationDetailOverlay .feedPostMedia").first().screenshot({
    path: path.join(art, "detail-quality-after-backfill.png"),
  });

  const detailState = await page.evaluate(() => {
    const imgs = Array.from(
      document.querySelectorAll<HTMLImageElement>(".curationDetailOverlay img.feedPostMediaImg"),
    );
    return imgs.map((img) => ({
      src: (img.currentSrc || img.src).split("/").pop(),
      isThumb: /_thumb(\.|$)/.test(img.currentSrc || img.src),
      opacity: getComputedStyle(img).opacity,
      w: img.naturalWidth,
      h: img.naturalHeight,
      complete: img.complete,
    }));
  });

  await page.getByTestId("curation-detail-close").first().click({ force: true }).catch(() => null);
  await page.waitForTimeout(400);

  // --- Cold shopping firstPixel x5 ---
  const coldSamples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const ctx2 = await browser.newContext({
      ...devices["iPhone 13"],
      locale: "ko-KR",
      geolocation: { latitude: 37.5665, longitude: 126.978 },
      permissions: ["geolocation"],
      storageState: await context.storageState(),
    });
    await suppressCoachmarks(ctx2);
    const p2 = await ctx2.newPage();
    const samples: number[] = [];
    p2.on("console", async (msg) => {
      if (!msg.text().includes("detail.firstPixel")) return;
      try {
        const obj = (await msg.args()[1]!.jsonValue()) as { ms?: number };
        if (obj.ms != null) samples.push(Number(obj.ms));
      } catch {
        /* ignore */
      }
    });
    const cdp2 = await ctx2.newCDPSession(p2);
    await cdp2.send("Network.enable");
    await p2.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await gotoTab(p2, "home");
    await waitForHomeFeed(p2);
    await dismissCoachmarks(p2);
    await p2.locator(".categoryFilterTab", { hasText: "쇼핑" }).first().click();
    await p2.waitForTimeout(900);
    const cell = p2.locator(".homeFeedGrid .postGridCell").first();
    await cell.waitFor({ state: "visible" });
    await p2
      .waitForFunction(() => {
        const img = document.querySelector(".homeFeedGrid .postGridCell img") as HTMLImageElement | null;
        return !!(img && img.complete && img.naturalWidth > 0);
      }, null, { timeout: 20000 })
      .catch(() => null);

    await cdp2.send("Network.clearBrowserCache");
    await cdp2.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp2.send("Network.emulateNetworkConditions", FAST_3G);

    const before = samples.length;
    await cell.click();
    await p2.locator(".curationDetailOverlay").waitFor({ state: "visible", timeout: 20000 });
    const dl = Date.now() + 45000;
    while (samples.length <= before && Date.now() < dl) await p2.waitForTimeout(80);
    const ms = samples[before] ?? null;
    console.log(`shopping cold #${i + 1}`, ms);
    if (ms != null) coldSamples.push(ms);
    await ctx2.close();
  }

  const out = {
    generatedAt: new Date().toISOString(),
    chipSwitchMs: chipTimes,
    chipBefore: { 전체: 342, 카페: 869, 맛집: 770 },
    gridScroll: {
      requests: scrollHits.length,
      thumbRequests: thumbHits.length,
      fullRequests: fullHits.length,
      totalBytes: scrollBytes,
      totalMB: Math.round((scrollBytes / 1024 / 1024) * 100) / 100,
      thumbBytes: thumbHits.reduce((a, b) => a + b.bytes, 0),
      fullBytes: fullHits.reduce((a, b) => a + b.bytes, 0),
    },
    detailWarmFirstPixelMs: warmMs,
    detailState,
    shoppingColdSamples: coldSamples,
    shoppingColdMedian: median(coldSamples),
    shoppingColdBeforeActiveOnly: 1151,
  };
  fs.writeFileSync(path.join(art, "verify-thumbs-after-backfill.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
