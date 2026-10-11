/**
 * Capture Kakao (map.kakao.com) vs Pindmap (/map-preview) at shared cameras.
 * Output under e2e/artifacts/map-compare/{before|after}/ (gitignored).
 *
 * Usage: node scripts/lab-map-compare-shots.mjs before|after [baseURL]
 */
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const PHASE = process.argv[2] === "after" ? "after" : "before";
const BASE = process.argv[3] || process.env.LAB_BASE_URL || "https://pindmap.com";
const OUT = path.join(process.cwd(), "e2e/artifacts/map-compare", PHASE);
const iphone = devices["iPhone 13"];

/** Shared cameras: MapLibre zoom ≈ Kakao visual density (approx). */
const SCENES = [
  { id: "national_wide", label: "전국(남한)", center: [127.8, 36.2], zoom: 5.9, kakaoLevel: 12 },
  { id: "national_close", label: "전국(확대)", center: [127.8, 36.2], zoom: 6.8, kakaoLevel: 11 },
  { id: "sudogwon", label: "수도권", center: [127.05, 37.45], zoom: 8.4, kakaoLevel: 9 },
  { id: "seoul", label: "서울 전체", center: [126.98, 37.56], zoom: 10.4, kakaoLevel: 7 },
  { id: "mapo_z13", label: "마포·홍대 z13", center: [126.9236, 37.5563], zoom: 13.0, kakaoLevel: 4 },
  { id: "mapo_z14", label: "마포·홍대 z14", center: [126.9236, 37.5563], zoom: 14.2, kakaoLevel: 3 },
  { id: "busan", label: "부산 시내", center: [129.06, 35.16], zoom: 11.0, kakaoLevel: 6 },
  { id: "jeju", label: "제주 전체", center: [126.53, 33.38], zoom: 8.6, kakaoLevel: 9 },
  { id: "seorak", label: "설악산 근처", center: [128.47, 38.12], zoom: 10.0, kakaoLevel: 7 },
  { id: "mokpo", label: "목포·신안", center: [126.25, 34.75], zoom: 9.0, kakaoLevel: 8 },
];

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

async function shotPindmap(browser) {
  const dir = path.join(OUT, "pindmap");
  ensureDir(dir);
  const context = await browser.newContext({
    ...iphone,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/map-preview?mode=nopins`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => window.__PINDMAP_PREVIEW_DIAG__?.loadMs != null,
    { timeout: 45_000 },
  );
  for (const scene of SCENES) {
    await page.evaluate(async ({ center, zoom }) => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      map.jumpTo({ center, zoom });
      await new Promise((r) => {
        map.once("idle", () => r(undefined));
        setTimeout(() => r(undefined), 5000);
      });
    }, scene);
    await page.waitForTimeout(600);
    const file = path.join(dir, `${scene.id}.png`);
    await page.locator(".map-preview-gl-canvas, .maplibregl-canvas").first().screenshot({
      path: file,
    });
    console.log("[compare]", PHASE, "pindmap", scene.id, "→", file);
  }
  await context.close();
}

async function shotKakao(browser) {
  const dir = path.join(OUT, "kakao");
  ensureDir(dir);
  const context = await browser.newContext({
    ...iphone,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: iphone.viewport,
  });
  const page = await context.newPage();
  for (const scene of SCENES) {
    const [lng, lat] = scene.center;
    // Public Kakao map deep link (no app key required)
    const url = `https://map.kakao.com/link/map/${lat},${lng}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);
    // Dismiss "open in app" / promo modals (best-effort)
    for (const sel of [
      "button:has-text('닫기')",
      "button:has-text('취소')",
      "[class*='close']",
      "button:has-text('나중에')",
    ]) {
      const btn = page.locator(sel).first();
      if (await btn.count()) {
        try {
          await btn.click({ timeout: 800 });
        } catch {
          /* ignore */
        }
      }
    }
    // Zoom out toward scene.kakaoLevel density (link often opens too close)
    for (let i = 0; i < 8; i++) {
      const minus = page
        .locator("button.zoomout, .zoomout, .ZoomControl_zoomout, [aria-label*='축소']")
        .first();
      if (!(await minus.count())) break;
      try {
        await minus.click({ timeout: 500 });
        await page.waitForTimeout(250);
      } catch {
        break;
      }
    }
    await page.waitForTimeout(1000);
    const file = path.join(dir, `${scene.id}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log("[compare]", PHASE, "kakao", scene.id, "→", file);
  }
  await context.close();
}

async function main() {
  ensureDir(OUT);
  const browser = await chromium.launch({ headless: true });
  await shotPindmap(browser);
  await shotKakao(browser);
  const manifest = {
    phase: PHASE,
    base: BASE,
    at: new Date().toISOString(),
    scenes: SCENES,
  };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log("[compare] done", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
