/**
 * Verify chip round-trip restores cover thumbs (images[0]).
 *   npx tsx e2e/verify-chip-thumb-restore.ts
 */
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
  await ensureLoggedIn(page, { url: `${BASE}/login` });
  await gotoTab(page, "home");
  await waitForHomeFeed(page);
  await dismissCoachmarks(page);
  await dismissWhatsNewIfPresent(page, 2000);

  async function chip(label: string) {
    await page.locator(".categoryFilterTab", { hasText: label }).first().click();
    await page.waitForTimeout(1000);
  }

  async function snap() {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll(".homeFeedGrid .postGridCell"))
        .slice(0, 12)
        .map((cell) => {
          const img = cell.querySelector("img") as HTMLImageElement | null;
          const title = (cell.querySelector(".postGridCellHomeTitle")?.textContent || "").trim();
          const src = img?.currentSrc || img?.src || "";
          return { title, file: src.split("/").pop() || "" };
        })
        .filter((r) => r.title && r.file),
    );
  }

  const sequence = ["전체", "카페", "전체", "맛집", "전체"] as const;
  const snaps: Record<string, { title: string; file: string }[]> = {};
  for (const label of sequence) {
    await chip(label);
    // store last visit for duplicate "전체"
    snaps[`${label}-${Object.keys(snaps).filter((k) => k.startsWith(label)).length}`] = await snap();
  }

  const all1 = snaps["전체-0"]!;
  const cafe = snaps["카페-0"]!;
  const all2 = snaps["전체-1"]!;
  const food = snaps["맛집-0"]!;
  const all3 = snaps["전체-2"]!;

  const map = (rows: { title: string; file: string }[]) => new Map(rows.map((r) => [r.title, r.file]));
  const m1 = map(all1);
  const mCafe = map(cafe);
  const m2 = map(all2);
  const mFood = map(food);
  const m3 = map(all3);

  const rows = [];
  for (const [title, f1] of m1) {
    const fc = mCafe.get(title);
    if (!fc || fc === f1) continue;
    const f2 = m2.get(title);
    const ff = mFood.get(title);
    const f3 = m3.get(title);
    rows.push({
      title,
      all1: f1,
      cafe: fc,
      all2: f2,
      food: ff,
      all3: f3,
      restoredAfterCafe: f2 === f1,
      restoredAfterFood: !ff || ff === f1 ? true : f3 === f1,
      coverIsThumb: f1.includes("_thumb"),
    });
  }

  const stuck = rows.filter((r) => !r.restoredAfterCafe || !r.restoredAfterFood);
  console.log(JSON.stringify({ checked: rows.length, stuck: stuck.length, rows: rows.slice(0, 5) }, null, 2));
  await browser.close();
  if (stuck.length > 0) {
    console.error("STUCK", stuck);
    process.exit(2);
  }
  if (rows.length === 0) {
    console.warn("No overlapping posts with different cafe cover — inconclusive");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
