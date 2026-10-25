/**
 * Render all POI category badges at 1× CSS size into one checklist sheet.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const outDir = "e2e/artifacts/poi-icon-sheet";
fs.mkdirSync(outDir, { recursive: true });

const raw = execSync(
  `npx tsx -e "import { ALL_POI_CATEGORY_IDS, poiCategoryIconSvg, POI_ICON_CSS_PX } from './lib/mapSurface/poiCategoryIcons.ts'; process.stdout.write(JSON.stringify({ ids: ALL_POI_CATEGORY_IDS, px: POI_ICON_CSS_PX, svgs: Object.fromEntries(ALL_POI_CATEGORY_IDS.map(id => [id, poiCategoryIconSvg(id)])) }))"`,
  { encoding: "utf8", cwd: process.cwd() },
);
const payload = JSON.parse(raw.trim());

const checklistGuess = {
  cafe: "커피잔 — OK",
  restaurant: "포크+숟가락 — OK (was ||)",
  bar: "맥주잔 — OK",
  bakery: "빵 — OK",
  fast_food: "햄버거(앰버) — OK (was 빨간금지표지)",
  convenience: "가게 — OK",
  grocery: "장바구니 — OK",
  mall: "쇼핑백 — OK",
  shop: "쇼핑백 — OK",
  bank: "건물 — OK",
  pharmacy: "십자 — 병원과 유사 가능",
  hospital: "십자 — 약국과 유사 가능",
  school: "학사모 — OK",
  college: "학사모 — OK",
  lodging: "침대 — OK",
  park: "나무 — OK",
  parking: "P — OK",
  fuel: "주유 — OK",
  landmark: "별 — OK",
  subway: "원 — 약함 가능",
  bus: "버스 — OK",
};

const html = `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  body{font:12px/1.35 -apple-system,BlinkMacSystemFont,sans-serif;background:#f4f4f4;margin:16px;color:#222}
  h1{font-size:16px;margin:0 0 12px}
  .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  .cell{background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px;display:flex;gap:10px;align-items:center}
  .cell svg{width:${payload.px}px;height:${payload.px}px;flex:0 0 auto;display:block}
  .meta{font-size:11px}
  .id{font-weight:700}
  .warn{color:#a40}
</style></head><body>
<h1>POI icons @ ${payload.px}px (1×)</h1>
<div class="grid">
${payload.ids
  .map((id) => {
    const note = checklistGuess[id] || "점검 필요";
    const warn = /유사|약함|점검/.test(note) ? "warn" : "";
    return `<div class="cell">${payload.svgs[id]}<div class="meta"><div class="id">${id}</div><div class="${warn}">${note}</div></div></div>`;
  })
  .join("\n")}
</div>
</body></html>`;

const htmlPath = path.join(outDir, "sheet.html");
fs.writeFileSync(htmlPath, html);
fs.writeFileSync(
  path.join(outDir, "checklist.json"),
  JSON.stringify(
    {
      px: payload.px,
      items: payload.ids.map((id) => ({
        id,
        note: checklistGuess[id] || "점검 필요",
        confusing: /유사|약함|점검/.test(checklistGuess[id] || "점검"),
      })),
    },
    null,
    2,
  ),
);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1600 } });
await page.goto("file://" + path.resolve(htmlPath));
await page.screenshot({
  path: path.join(outDir, "icons-1x-sheet.png"),
  fullPage: true,
});
await browser.close();
console.log("wrote", path.join(outDir, "icons-1x-sheet.png"));
console.log("wrote", path.join(outDir, "checklist.json"));
