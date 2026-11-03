/**
 * D-1 icon sheet: every POI category badge + mapping (OMT class / 상가 중분류).
 * Writes e2e/artifacts/d1/icons-sheet-1x.png, icons-sheet-3x.png, category-mapping.md
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const outDir = "e2e/artifacts/d1";
fs.mkdirSync(outDir, { recursive: true });

const raw = execSync(
  `npx --yes tsx -e "import { ALL_POI_MAP_CATEGORY_IDS, POI_MAP_COLORS, OMT_CLASS_TO_CATEGORY, SANGGA_CATEGORY_KEYWORDS } from './lib/mapSurface/poiCategoryMapping.ts'; import { poiCategoryIconSvg, POI_ICON_CSS_PX } from './lib/mapSurface/poiCategoryIcons.ts'; process.stdout.write(JSON.stringify({ ids: ALL_POI_MAP_CATEGORY_IDS, px: POI_ICON_CSS_PX, colors: POI_MAP_COLORS, omt: OMT_CLASS_TO_CATEGORY, sangga: SANGGA_CATEGORY_KEYWORDS, svgs: Object.fromEntries(ALL_POI_MAP_CATEGORY_IDS.map(id => [id, poiCategoryIconSvg(id)])) }))"`,
  { encoding: "utf8", cwd: process.cwd() },
);
const p = JSON.parse(raw.trim());
const NEW = new Set(["car_repair", "tools", "second_hand", "misc_service"]);

const omtOf = (id) =>
  p.omt
    .filter((r) => r.category === id)
    .flatMap((r) => [...(r.classes ?? []), ...(r.subclasses ?? []).map((s) => `sub:${s}`)])
    .join(", ");
const sanggaOf = (id) => {
  const k = p.sangga[id] ?? {};
  // 대분류-only buckets (e.g. 숙박 → lodging) have no 중/소 keywords.
  const dae = !(k.jung?.length || k.so?.length) ? (k.dae ?? []).map((d) => `대:${d}`) : [];
  return [...dae, ...(k.jung ?? []), ...(k.so ?? []).map((s) => `소:${s}`)].join(", ");
};

const cards = p.ids
  .map((id) => {
    const c = p.colors[id];
    const src = `data:image/svg+xml;utf8,${encodeURIComponent(p.svgs[id])}`;
    return `<div class="card${NEW.has(id) ? " new" : ""}">
      <img width="${p.px}" height="${p.px}" src='${src}' />
      <div class="meta"><b>${id}</b>${NEW.has(id) ? ' <span class="tag">NEW · z17+</span>' : ""}
        <div class="sw" style="color:${c.text}">${c.icon} / ${c.text}</div>
        <div class="map">OMT: ${omtOf(id) || "—"}</div>
        <div class="map">상가: ${sanggaOf(id) || "—"}</div></div>
    </div>`;
  })
  .join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"/>
<style>
body{font:12px/1.35 system-ui,-apple-system,sans-serif;background:#ececec;padding:14px;margin:0;width:860px}
h1{font-size:15px;margin:0 0 10px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.card{background:#fff;border-radius:10px;padding:8px 10px;display:flex;gap:10px;align-items:flex-start}
.card.new{outline:2px solid #1a2a7a}
.tag{font-size:10px;color:#fff;background:#1a2a7a;border-radius:6px;padding:1px 5px}
.sw{font-weight:600}.map{color:#555;font-size:11px}
img{flex:none;margin-top:2px}
</style></head><body>
<h1>POI category icons (D-1) — badge ${p.px}px · new categories outlined</h1>
<div class="grid">${cards}</div>
</body></html>`;

const htmlPath = path.join(outDir, "icons-sheet.html");
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch({ headless: true });
for (const scale of [1, 3]) {
  const page = await browser.newPage({
    viewport: { width: 890, height: 900 },
    deviceScaleFactor: scale,
  });
  await page.goto("file://" + path.resolve(htmlPath));
  const out = path.join(outDir, `icons-sheet-${scale}x.png`);
  await page.screenshot({ path: out, fullPage: true });
  await page.close();
  console.log("wrote", out);
}
await browser.close();

const md = [
  "| category | badge / text | OMT class | 상가 중분류·소분류 키워드 |",
  "|---|---|---|---|",
  ...p.ids.map(
    (id) =>
      `| ${id}${NEW.has(id) ? " (new, z17+)" : ""} | ${p.colors[id].icon} / ${p.colors[id].text} | ${omtOf(id) || "—"} | ${sanggaOf(id) || "—"} |`,
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "category-mapping.md"), md + "\n");
console.log("wrote", path.join(outDir, "category-mapping.md"));
