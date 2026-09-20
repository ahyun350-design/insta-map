/**
 * Investigate-only: image sizes, grid vs detail URLs, cell px.
 *   npx tsx e2e/investigate-image-sizes.ts
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

type ImgMeta = {
  url: string;
  bytes: number | null;
  w: number | null;
  h: number | null;
  hasTransform: boolean;
};

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

function hasTransformParams(url: string): boolean {
  try {
    const u = new URL(url);
    // Supabase image transform typically: /storage/v1/render/image/... or ?width=&height=&quality=
    if (u.pathname.includes("/render/image")) return true;
    const keys = ["width", "height", "quality", "resize", "format"];
    return keys.some((k) => u.searchParams.has(k));
  } catch {
    return false;
  }
}

async function probeUrl(url: string): Promise<ImgMeta> {
  const meta: ImgMeta = {
    url,
    bytes: null,
    w: null,
    h: null,
    hasTransform: hasTransformParams(url),
  };
  try {
    const head = await fetch(url, { method: "HEAD" });
    const cl = head.headers.get("content-length");
    if (cl) meta.bytes = Number(cl);
  } catch {
    /* ignore */
  }
  if (meta.bytes == null) {
    try {
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      meta.bytes = buf.length;
    } catch {
      /* ignore */
    }
  }
  return meta;
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

  const firstPixelLogs: unknown[] = [];
  page.on("console", async (msg) => {
    if (!msg.text().includes("detail.firstPixel")) return;
    try {
      firstPixelLogs.push(await msg.args()[1]!.jsonValue());
    } catch {
      /* ignore */
    }
  });

  await ensureLoggedIn(page, { url: "https://pindmap.com/login" });
  await gotoTab(page, "home");
  await waitForHomeFeed(page);
  await dismissCoachmarks(page);
  await dismissWhatsNewIfPresent(page, 2000);

  async function collectChip(chipLabel: string, n = 12) {
    await page.locator(".categoryFilterTab", { hasText: chipLabel }).first().click();
    await page.waitForTimeout(1000);

    const gridInfo = await page.evaluate((limit) => {
      const cells = Array.from(
        document.querySelectorAll<HTMLElement>(".homeFeedGrid .postGridCell"),
      ).slice(0, limit);
      const viewportW = window.innerWidth;
      const dpr = window.devicePixelRatio || 1;
      return {
        viewportW,
        dpr,
        cells: cells.map((cell, i) => {
          const img = cell.querySelector("img") as HTMLImageElement | null;
          const r = cell.getBoundingClientRect();
          const imgBox = img?.getBoundingClientRect();
          return {
            i,
            thumbSrc: img?.currentSrc || img?.src || "",
            loading: img?.getAttribute("loading") || null,
            cellW: Math.round(r.width),
            cellH: Math.round(r.height),
            imgW: imgBox ? Math.round(imgBox.width) : null,
            imgH: imgBox ? Math.round(imgBox.height) : null,
            naturalW: img?.naturalWidth ?? null,
            naturalH: img?.naturalHeight ?? null,
            complete: img?.complete ?? false,
          };
        }),
      };
    }, n);

    // Open first cell: compare grid URL vs detail active URL + network
    const detailCompare: {
      thumbSrc: string;
      detailActiveSrc: string | null;
      detailAllSrcs: string[];
      indexFromLog: unknown;
      networkUrlsDuringOpen: string[];
      urlsEqual: boolean | null;
    } = {
      thumbSrc: gridInfo.cells[0]?.thumbSrc || "",
      detailActiveSrc: null,
      detailAllSrcs: [],
      indexFromLog: null,
      networkUrlsDuringOpen: [],
      urlsEqual: null,
    };

    if (gridInfo.cells[0]) {
      const netUrls: string[] = [];
      const onReq = (req: { url: () => string; resourceType: () => string }) => {
        if (req.resourceType() === "image") netUrls.push(req.url());
      };
      page.on("request", onReq);
      const beforeLogs = firstPixelLogs.length;
      await page.locator(".homeFeedGrid .postGridCell").first().click();
      await page.locator(".curationDetailOverlay").waitFor({ state: "visible", timeout: 15000 });
      await page.waitForTimeout(2500);
      page.off("request", onReq);

      const detail = await page.evaluate(() => {
        const track = document.querySelector(
          ".curationDetailOverlay .feedPostMediaTrack",
        ) as HTMLElement | null;
        const w = track?.clientWidth || 0;
        const idx = w > 0 && track ? Math.round(track.scrollLeft / w) : 0;
        const imgs = Array.from(
          document.querySelectorAll<HTMLImageElement>(
            ".curationDetailOverlay img.feedPostMediaImg",
          ),
        );
        const active =
          document.querySelector<HTMLImageElement>(
            `.curationDetailOverlay .feedPostMediaSlide[data-slide-index="${idx}"] img.feedPostMediaImg`,
          ) || imgs[0] || null;
        return {
          scrollIdx: idx,
          activeSrc: active?.currentSrc || active?.src || null,
          activeNatural: active
            ? { w: active.naturalWidth, h: active.naturalHeight }
            : null,
          allSrcs: imgs.map((im) => im.currentSrc || im.src),
          detailBox: (() => {
            const el = document.querySelector(
              ".curationDetailOverlay .feedPostMedia",
            ) as HTMLElement | null;
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
          })(),
        };
      });

      detailCompare.detailActiveSrc = detail.activeSrc;
      detailCompare.detailAllSrcs = detail.allSrcs;
      detailCompare.networkUrlsDuringOpen = netUrls;
      const tBase = (detailCompare.thumbSrc || "").split("?")[0];
      const dBase = (detail.activeSrc || "").split("?")[0];
      detailCompare.urlsEqual = !!(tBase && dBase && tBase === dBase);
      if (firstPixelLogs.length > beforeLogs) {
        detailCompare.indexFromLog = firstPixelLogs[firstPixelLogs.length - 1];
      }

      // attach natural from detail active into report via closure below
      (detailCompare as { detailNatural?: unknown; detailBox?: unknown }).detailNatural =
        detail.activeNatural;
      (detailCompare as { detailBox?: unknown }).detailBox = detail.detailBox;

      await page.getByTestId("curation-detail-close").first().click({ force: true });
      await page.locator(".curationDetailOverlay").waitFor({ state: "hidden", timeout: 10000 }).catch(() => null);
      await page.waitForTimeout(400);
    }

    // Probe byte sizes for unique thumb URLs
    const uniqueUrls = [...new Set(gridInfo.cells.map((c) => c.thumbSrc).filter(Boolean))];
    const probed: ImgMeta[] = [];
    for (const u of uniqueUrls) {
      probed.push(await probeUrl(u));
    }

    const bytes = probed.map((p) => p.bytes).filter((b): b is number => b != null);
    const naturals = gridInfo.cells
      .filter((c) => c.naturalW && c.naturalH)
      .map((c) => ({ w: c.naturalW!, h: c.naturalH!, mp: (c.naturalW! * c.naturalH!) / 1e6 }));

    return {
      chip: chipLabel,
      gridInfo,
      detailCompare,
      probed,
      stats: {
        nCells: gridInfo.cells.length,
        nProbed: probed.length,
        bytesMedian: median(bytes),
        bytesMax: bytes.length ? Math.max(...bytes) : null,
        bytesMean: bytes.length ? Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length) : null,
        bytesSamples: bytes,
        naturalWMedian: median(naturals.map((n) => n.w)),
        naturalHMedian: median(naturals.map((n) => n.h)),
        naturalWMax: naturals.length ? Math.max(...naturals.map((n) => n.w)) : null,
        naturalHMax: naturals.length ? Math.max(...naturals.map((n) => n.h)) : null,
        anyTransform: probed.some((p) => p.hasTransform),
        transformCount: probed.filter((p) => p.hasTransform).length,
        cellW: gridInfo.cells[0]?.cellW ?? null,
        cellH: gridInfo.cells[0]?.cellH ?? null,
        viewportW: gridInfo.viewportW,
        dpr: gridInfo.dpr,
      },
    };
  }

  const all = await collectChip("전체", 16);
  const shopping = await collectChip("쇼핑", 16);

  // Lazy / prefetch: how many imgs in DOM with complete vs incomplete near viewport
  const lazyInfo = await page.evaluate(() => {
    const imgs = Array.from(
      document.querySelectorAll<HTMLImageElement>(".homeFeedGrid .postGridCell img"),
    );
    const vh = window.innerHeight;
    let inView = 0;
    let inViewComplete = 0;
    let nearBelow = 0; // within 1 viewport below
    let nearBelowComplete = 0;
    let far = 0;
    let farComplete = 0;
    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const complete = img.complete && img.naturalWidth > 0;
      if (mid >= 0 && mid <= vh) {
        inView++;
        if (complete) inViewComplete++;
      } else if (mid > vh && mid <= vh * 2) {
        nearBelow++;
        if (complete) nearBelowComplete++;
      } else if (mid > vh * 2) {
        far++;
        if (complete) farComplete++;
      }
    }
    return {
      totalImgs: imgs.length,
      loadingAttrs: [...new Set(imgs.map((i) => i.getAttribute("loading")))],
      inView,
      inViewComplete,
      nearBelow,
      nearBelowComplete,
      far,
      farComplete,
    };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    baseURL: "https://pindmap.com",
    all,
    shopping,
    lazyInfo,
    note: {
      uploadTarget: "prepareImageForUpload: maxSizeMB 0.5, maxWidthOrHeight 1080",
      storage: "supabase post-images getPublicUrl — no transform in upload route",
      measureStart: "detailOpenPerfRef stamped in handlePostGridSelect (tap), not chip switch",
    },
  };

  const art = path.resolve(process.cwd(), "e2e/artifacts");
  fs.mkdirSync(art, { recursive: true });
  fs.writeFileSync(path.join(art, "image-size-investigate.json"), JSON.stringify(out, null, 2));

  // Compact stdout
  const fmt = (s: typeof all.stats) =>
    `bytes med=${s.bytesMedian} max=${s.bytesMax} mean=${s.bytesMean} | natural med=${s.naturalWMedian}x${s.naturalHMedian} max=${s.naturalWMax}x${s.naturalHMax} | cell=${s.cellW}x${s.cellH}px dpr=${s.dpr} | transform=${s.anyTransform}`;

  console.log("=== ALL ===", fmt(all.stats));
  console.log(
    "ALL first open:",
    JSON.stringify({
      urlsEqual: all.detailCompare.urlsEqual,
      thumb: all.detailCompare.thumbSrc?.slice(-80),
      detail: all.detailCompare.detailActiveSrc?.slice(-80),
      log: all.detailCompare.indexFromLog,
      netImageCount: all.detailCompare.networkUrlsDuringOpen.length,
    }),
  );
  console.log("=== SHOPPING ===", fmt(shopping.stats));
  console.log(
    "SHOP first open:",
    JSON.stringify({
      urlsEqual: shopping.detailCompare.urlsEqual,
      thumb: shopping.detailCompare.thumbSrc?.slice(-80),
      detail: shopping.detailCompare.detailActiveSrc?.slice(-80),
      log: shopping.detailCompare.indexFromLog,
      netImageCount: shopping.detailCompare.networkUrlsDuringOpen.length,
      netUrls: shopping.detailCompare.networkUrlsDuringOpen.map((u) => u.slice(-90)),
    }),
  );
  console.log("=== LAZY ===", JSON.stringify(lazyInfo));
  console.log("Wrote e2e/artifacts/image-size-investigate.json");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
