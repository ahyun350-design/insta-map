/**
 * Render icons-v2 sheet at 1× and 3× into e2e/artifacts/icons-v2/icons-sheet.png
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const outDir = "e2e/artifacts/icons-v2";
fs.mkdirSync(outDir, { recursive: true });

const raw = execSync(
  `npx --yes tsx -e "import { ALL_POI_MAP_CATEGORY_IDS, POI_MAP_COLORS } from './lib/mapSurface/poiCategoryMapping.ts'; import { poiCategoryIconSvg, POI_ICON_CSS_PX } from './lib/mapSurface/poiCategoryIcons.ts'; process.stdout.write(JSON.stringify({ ids: ALL_POI_MAP_CATEGORY_IDS, px: POI_ICON_CSS_PX, colors: POI_MAP_COLORS, svgs: Object.fromEntries(ALL_POI_MAP_CATEGORY_IDS.map(id => [id, poiCategoryIconSvg(id)])) }))"`,
  { encoding: "utf8", cwd: process.cwd() },
);
const payload = JSON.parse(raw.trim());

const rows = payload.ids
  .map((id) => {
    const c = payload.colors[id];
    return `<div class="card">
      <img width="${payload.px}" height="${payload.px}" src='data:image/svg+xml;utf8,${encodeURIComponent(payload.svgs[id])}' />
      <img width="${payload.px * 3}" height="${payload.px * 3}" src='data:image/svg+xml;utf8,${encodeURIComponent(payload.svgs[id])}' />
      <div><b>${id}</b><br/><span style="color:${c.text}">${c.icon} / ${c.text}</span></div>
    </div>`;
  })
  .join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"/>
<style>
body{font:13px/1.35 system-ui;background:#ececec;padding:16px;margin:0}
h1{font-size:16px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.card{background:#fff;border-radius:10px;padding:10px;display:flex;gap:12px;align-items:center}
img{image-rendering:auto;flex:none}
</style></head><body>
<h1>POI icons-v2 — 1× (${payload.px}px) and 3×</h1>
<div class="grid">${rows}</div>
</body></html>`;

const htmlPath = path.join(outDir, "sheet.html");
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
await page.goto("file://" + path.resolve(htmlPath));
await page.screenshot({
  path: path.join(outDir, "icons-sheet.png"),
  fullPage: true,
});
await browser.close();
console.log("wrote", path.join(outDir, "icons-sheet.png"));
