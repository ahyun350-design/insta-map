/**
 * Measure `[PindMap:perf] detail.firstPixel` medians on production.
 *
 *   npx tsx e2e/measure-detail-first-pixel.ts
 *
 * Credentials: E2E_EMAIL / E2E_PASSWORD in `.env.local` (never committed).
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

type Sample = { chip: string; index: number; ms: number | null };

function median(arr: number[]): number {
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

async function main(): Promise<void> {
  const samples: Sample[] = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "ko-KR",
    geolocation: { latitude: 37.5665, longitude: 126.978 },
    permissions: ["geolocation"],
  });
  await suppressCoachmarks(context);
  const page = await context.newPage();

  page.on("console", async (msg) => {
    if (!msg.text().includes("detail.firstPixel")) return;
    try {
      const args = msg.args();
      if (args.length < 2) return;
      const obj = (await args[1]!.jsonValue()) as Sample;
      samples.push({
        chip: String(obj.chip ?? "unknown"),
        index: Number(obj.index),
        ms: obj.ms == null ? null : Number(obj.ms),
      });
      // eslint-disable-next-line no-console
      console.log("  captured", obj);
    } catch {
      /* ignore */
    }
  });

  await ensureLoggedIn(page, { url: "https://pindmap.com/login" });
  await gotoTab(page, "home");
  await waitForHomeFeed(page);
  await dismissCoachmarks(page);
  await dismissWhatsNewIfPresent(page, 2_000);

  async function selectChip(label: string): Promise<void> {
    const chip = page.locator(".categoryFilterTab", { hasText: label }).first();
    await chip.waitFor({ state: "visible", timeout: 15_000 });
    await chip.click();
    await page.waitForTimeout(700);
  }

  async function closeDetail(): Promise<void> {
    const overlay = page.locator(".curationDetailOverlay");
    if (!(await overlay.isVisible().catch(() => false))) return;
    await page.getByTestId("curation-detail-close").first().click({ force: true });
    await overlay.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => null);
    await page.waitForTimeout(500);
  }

  async function openFirstCellOnce(): Promise<number | null> {
    const before = samples.length;
    const cell = page.locator(".homeFeedGrid .postGridCell").first();
    await cell.waitFor({ state: "visible", timeout: 20_000 });
    await page
      .waitForFunction(() => {
        const img = document.querySelector(".homeFeedGrid .postGridCell img");
        return !!(img && (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0);
      }, null, { timeout: 20_000 })
      .catch(() => null);

    await cell.click();
    await page.locator(".curationDetailOverlay").waitFor({ state: "visible", timeout: 15_000 });

    const deadline = Date.now() + 12_000;
    while (samples.length <= before && Date.now() < deadline) {
      await page.waitForTimeout(100);
    }
    const got = samples.slice(before);
    await closeDetail();
    const ms = got.map((g) => g.ms).find((n) => n != null);
    return ms ?? null;
  }

  const byChip: { all: number[]; shopping: number[] } = { all: [], shopping: [] };

  await selectChip("전체");
  for (let i = 0; i < 5; i++) {
    const ms = await openFirstCellOnce();
    // eslint-disable-next-line no-console
    console.log(`all #${i + 1}`, ms ?? "no-log");
    if (ms != null) byChip.all.push(ms);
  }

  await selectChip("쇼핑");
  const shoppingCells = await page.locator(".homeFeedGrid .postGridCell").count();
  // eslint-disable-next-line no-console
  console.log("shopping cells", shoppingCells);
  if (shoppingCells === 0) {
    // eslint-disable-next-line no-console
    console.log("NO shopping posts — cannot measure shopping chip");
  } else {
    for (let i = 0; i < 5; i++) {
      const ms = await openFirstCellOnce();
      // eslint-disable-next-line no-console
      console.log(`shopping #${i + 1}`, ms ?? "no-log");
      if (ms != null) byChip.shopping.push(ms);
    }
  }

  // eslint-disable-next-line no-console
  console.log("\n========== detail.firstPixel MEDIANS ==========");
  // eslint-disable-next-line no-console
  console.log(
    "all median:",
    byChip.all.length ? median(byChip.all) : "n/a",
    "samples:",
    byChip.all.join(","),
  );
  // eslint-disable-next-line no-console
  console.log(
    "shopping median:",
    byChip.shopping.length ? median(byChip.shopping) : "n/a",
    "samples:",
    byChip.shopping.join(","),
  );
  // eslint-disable-next-line no-console
  console.log("==============================================\n");

  const out = {
    generatedAt: new Date().toISOString(),
    baseURL: "https://pindmap.com",
    note: "Measured against currently deployed production (expect 4a883bb+ firstPixel logic)",
    all: {
      samples: byChip.all,
      median: byChip.all.length ? median(byChip.all) : null,
    },
    shopping: {
      samples: byChip.shopping,
      median: byChip.shopping.length ? median(byChip.shopping) : null,
    },
  };
  const art = path.resolve(process.cwd(), "e2e/artifacts");
  fs.mkdirSync(art, { recursive: true });
  fs.writeFileSync(path.join(art, "detail-first-pixel.json"), JSON.stringify(out, null, 2), "utf8");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
