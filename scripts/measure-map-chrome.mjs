/**
 * iPhone 13 (390×844) MapLibre top-chrome measure vs native installProductionChrome.
 * Applies real app/globals.css rules onto a fixture DOM; artifacts are not for commit.
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "e2e/artifacts/map-compare/chrome");
const globalsPath = path.join(root, "app/globals.css");

fs.mkdirSync(outDir, { recursive: true });

const globals = fs.readFileSync(globalsPath, "utf8");
// Pull chrome-related rule blocks (best-effort: from first TopChrome through RouteLoading)
const start = globals.indexOf(".expandedMapLibreTopChrome {");
const endMarker = ".expandedMapLibreAttrib {";
const end = globals.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  console.error("Could not locate chrome CSS in globals.css");
  process.exit(1);
}
const researchStart = globals.indexOf(".mapResearchAreaBtn {");
const researchEnd = globals.indexOf(".mapResearchAreaBtn:active", researchStart);
const researchCss = globals.slice(researchStart, researchEnd);
const chromeCss = globals.slice(start, end) + "\n" + researchCss;

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>MapLibre chrome measure</title>
  <style>
    :root { --sat: 47px; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 390px; height: 844px; overflow: hidden; }
    .stage { position: relative; width: 390px; height: 844px; background: #c8d4c0; }
    /* Substitute env(safe-area-inset-*) for iPhone 13 notch */
    .expandedMapLibreTopChrome,
    .expandedMapLibreTopChromeFlow {
      padding-top: calc(12px + var(--sat)) !important;
      padding-left: 12px !important;
      padding-right: 16px !important;
    }
    .expandedMapLibreStage .mapResearchAreaBtn,
    .mapResearchAreaBtn {
      top: calc(66px + var(--sat)) !important;
    }
    .expected { position: absolute; pointer-events: none; z-index: 40; border: 2px solid rgba(255,0,0,0.85); box-sizing: border-box; }
    .expected.close { left: 12px; top: calc(12px + var(--sat)); width: 44px; height: 44px; border-radius: 22px; }
    .expected.search { left: 64px; top: calc(12px + var(--sat)); width: 310px; height: 44px; border-radius: 22px; }
    ${chromeCss}
  </style>
</head>
<body>
  <div class="stage expandedMapLibreStage" id="stage">
    <div class="expandedMapLibreTopChrome expandedMapLibreTopChromeFlow" id="chrome">
      <button type="button" class="expandedMapLibreRoundBtn" id="closeBtn" aria-label="전체 지도 닫기">✕</button>
      <div class="expandedMapLibreSearchColumn" id="searchCol">
        <div class="expandedMapLibreSearchPill" id="searchPill">
          <input class="expandedMapLibreSearchInput" id="searchInput" placeholder="장소 검색" />
          <button type="button" class="expandedMapLibreSearchIcon" id="searchIcon" aria-label="검색">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12.2 12.2L15.5 15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
    <button type="button" class="mapResearchAreaBtn" id="researchBtn">이 지역에서 재검색</button>
    <div class="expected close" id="expClose"></div>
    <div class="expected search" id="expSearch"></div>
  </div>
  <script>
    function box(el) {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 };
    }
    window.__measure = () => {
      const close = box(document.getElementById("closeBtn"));
      const search = box(document.getElementById("searchPill"));
      const icon = box(document.getElementById("searchIcon"));
      const research = box(document.getElementById("researchBtn"));
      const expected = {
        close: { x: 12, y: 59, w: 44, h: 44 },
        search: { x: 64, y: 59, w: 310, h: 44 },
        researchTop: 113,
      };
      const diff = (a, e) => ({
        dx: Math.round((a.x - e.x) * 100) / 100,
        dy: Math.round((a.y - e.y) * 100) / 100,
        dw: Math.round((a.w - e.w) * 100) / 100,
        dh: Math.round((a.h - e.h) * 100) / 100,
      });
      return {
        close, search, icon, research,
        expected,
        diffs: {
          close: diff(close, expected.close),
          search: diff(search, expected.search),
          researchTop: Math.round((research.y - expected.researchTop) * 100) / 100,
        },
      };
    };
  </script>
</body>
</html>`;

const fixturePath = path.join(outDir, "fixture.html");
fs.writeFileSync(fixturePath, html);

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["iPhone 13"],
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
await page.goto("file://" + fixturePath);

const measure = await page.evaluate(() => window.__measure());
await page.screenshot({
  path: path.join(outDir, "maplibre-top-chrome.png"),
  clip: { x: 0, y: 0, width: 390, height: 200 },
});
await page.screenshot({
  path: path.join(outDir, "maplibre-top-chrome-full.png"),
  fullPage: false,
});

await page.evaluate(() => {
  document.getElementById("chrome").style.opacity = "0.35";
  document.getElementById("researchBtn").style.opacity = "0.35";
});
await page.screenshot({
  path: path.join(outDir, "expected-native-boxes.png"),
  clip: { x: 0, y: 0, width: 390, height: 200 },
});

fs.writeFileSync(path.join(outDir, "measure.json"), JSON.stringify(measure, null, 2));

const maxAbs = Math.max(
  ...Object.values(measure.diffs.close).map(Math.abs),
  ...Object.values(measure.diffs.search).map(Math.abs),
  Math.abs(measure.diffs.researchTop),
);

console.log(JSON.stringify(measure, null, 2));
console.log("maxAbsDiffPx=", maxAbs);
if (maxAbs > 2) {
  console.error("FAIL: chrome diff exceeds 2px");
  process.exitCode = 1;
} else {
  console.log("PASS: within 2px of native expected boxes");
}

await browser.close();
