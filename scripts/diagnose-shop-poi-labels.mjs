/**
 * Stage-1 diagnosis: Mangwon shop POI label funnel at z16/17/18.
 * No production style edits — temporary layout toggles only inside the page.
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "../e2e/artifacts");
fs.mkdirSync(outDir, { recursive: true });

const CENTER = [126.9055, 37.5560]; // 망원1동 주민센터 근처
const URL =
  "https://pindmap.com/map-preview?mode=nopins&theme=paper";

function evalFilter(filter, props, zoom) {
  if (filter === true) return true;
  if (filter === false) return false;
  if (!Array.isArray(filter)) return Boolean(filter);
  const op = filter[0];
  const rest = filter.slice(1);

  const expr = (e) => {
    if (!Array.isArray(e)) return e;
    const o = e[0];
    if (o === "get") return props[e[1]];
    if (o === "has") return props[e[1]] != null && props[e[1]] !== "";
    if (o === "literal") return e[1];
    if (o === "zoom") return zoom;
    if (o === "to-string") {
      const v = expr(e[1]);
      return v == null ? "" : String(v);
    }
    if (o === "to-number") {
      const v = expr(e[1]);
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    if (o === "length") {
      const v = expr(e[1]);
      return typeof v === "string" || Array.isArray(v) ? v.length : 0;
    }
    if (o === "coalesce") {
      for (let i = 1; i < e.length; i++) {
        const v = expr(e[i]);
        if (v != null && v !== "") return v;
      }
      return null;
    }
    if (o === "==") return expr(e[1]) === expr(e[2]);
    if (o === "!=") return expr(e[1]) !== expr(e[2]);
    if (o === ">") return expr(e[1]) > expr(e[2]);
    if (o === ">=") return expr(e[1]) >= expr(e[2]);
    if (o === "<") return expr(e[1]) < expr(e[2]);
    if (o === "<=") return expr(e[1]) <= expr(e[2]);
    if (o === "!") return !expr(e[1]);
    if (o === "in") {
      const needle = expr(e[1]);
      const hay = expr(e[2]);
      return Array.isArray(hay) ? hay.includes(needle) : false;
    }
    if (o === "all") return e.slice(1).every((x) => expr(x));
    if (o === "any") return e.slice(1).some((x) => expr(x));
    if (o === "case") {
      for (let i = 1; i < e.length - 1; i += 2) {
        if (expr(e[i])) return expr(e[i + 1]);
      }
      return expr(e[e.length - 1]);
    }
    if (o === "match") {
      const input = expr(e[1]);
      for (let i = 2; i < e.length - 1; i += 2) {
        const labels = e[i];
        const out = e[i + 1];
        if (Array.isArray(labels) ? labels.includes(input) : labels === input) {
          return typeof out === "object" && Array.isArray(out) ? expr(out) : out;
        }
      }
      return expr(e[e.length - 1]);
    }
    // unknown — fail closed
    return false;
  };

  return Boolean(expr(filter));
}

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["iPhone 13"],
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const consoleLines = [];
page.on("console", (msg) => {
  const t = msg.type();
  if (t === "warning" || t === "error") {
    consoleLines.push(`[${t}] ${msg.text()}`);
  }
});
page.on("pageerror", (err) => {
  consoleLines.push(`[pageerror] ${err.message}`);
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(
  () => window.__PINDMAP_PREVIEW_DIAG__?.loadMs != null,
  null,
  { timeout: 25_000 },
);

const layerDefs = await page.evaluate(() => {
  const map = window.__PINDMAP_PREVIEW_MAP__;
  const style = map.getStyle();
  return style.layers
    .filter((l) => String(l.id).startsWith("shop_poi_label"))
    .map((l) => ({
      id: l.id,
      type: l.type,
      minzoom: l.minzoom,
      maxzoom: l.maxzoom,
      filter: l.filter,
      layout: {
        "text-font": l.layout?.["text-font"],
        "text-field": l.layout?.["text-field"],
        "text-size": l.layout?.["text-size"],
        "symbol-sort-key": l.layout?.["symbol-sort-key"],
        "text-padding": l.layout?.["text-padding"],
        "text-anchor": l.layout?.["text-anchor"],
        "text-offset": l.layout?.["text-offset"],
        "text-optional": l.layout?.["text-optional"],
        "text-allow-overlap": l.layout?.["text-allow-overlap"],
        "text-ignore-placement": l.layout?.["text-ignore-placement"],
        "text-variable-anchor": l.layout?.["text-variable-anchor"],
        visibility: l.layout?.visibility,
      },
    }));
});

const rows = [];
for (const zoom of [16, 17, 18]) {
  const beforeOverlap = await page.evaluate(
    async ({ zoom, center }) => {
      const map = window.__PINDMAP_PREVIEW_MAP__;
      map.jumpTo({ zoom, center });
      await new Promise((r) => {
        map.once("idle", r);
        setTimeout(r, 4500);
      });
      const bounds = map.getBounds();
      const inView = (lng, lat) =>
        lng >= bounds.getWest() &&
        lng <= bounds.getEast() &&
        lat >= bounds.getSouth() &&
        lat <= bounds.getNorth();

      const srcFeats = map.querySourceFeatures("openmaptiles", {
        sourceLayer: "poi",
      });
      const namedInView = [];
      for (const f of srcFeats) {
        const p = f.properties || {};
        const name = String(p["name:ko"] || p.name || "").trim();
        if (!name) continue;
        const g = f.geometry;
        if (!g) continue;
        let lng;
        let lat;
        if (g.type === "Point") {
          lng = g.coordinates[0];
          lat = g.coordinates[1];
        } else continue;
        if (!inView(lng, lat)) continue;
        namedInView.push({
          class: String(p.class || ""),
          subclass: String(p.subclass || ""),
          rank: p.rank,
          name,
          props: p,
        });
      }

      const labelLayers = map
        .getStyle()
        .layers.filter((l) => String(l.id).startsWith("shop_poi_label"))
        .map((l) => l.id);
      const dotLayers = map
        .getStyle()
        .layers.filter((l) => String(l.id).startsWith("shop_poi_dot"))
        .map((l) => l.id);

      const filtersByLayer = {};
      for (const id of labelLayers) {
        const layer = map.getLayer(id);
        filtersByLayer[id] = {
          filter: map.getFilter(id),
          minzoom: layer?.minzoom,
          maxzoom: layer?.maxzoom,
        };
      }

      const dots = dotLayers.length
        ? map.queryRenderedFeatures({ layers: dotLayers })
        : [];
      const labels = labelLayers.length
        ? map.queryRenderedFeatures({ layers: labelLayers })
        : [];

      return {
        zoom: map.getZoom(),
        a_namedInView: namedInView.length,
        namedSample: namedInView.slice(0, 5),
        namedProps: namedInView.map((n) => n.props),
        filtersByLayer,
        labelLayers,
        c_dots: dots.length,
        d_labels: labels.length,
      };
    },
    { zoom, center: CENTER },
  );

  // b) evaluate filters in Node against named-in-view props
  let b_pass = 0;
  const activeFilters = [];
  for (const [id, meta] of Object.entries(beforeOverlap.filtersByLayer)) {
    const mz = meta.minzoom ?? 0;
    const xz = meta.maxzoom ?? 25;
    if (beforeOverlap.zoom < mz || beforeOverlap.zoom >= xz) continue;
    activeFilters.push({ id, filter: meta.filter });
  }
  for (const props of beforeOverlap.namedProps) {
    const ok = activeFilters.some((af) =>
      evalFilter(af.filter, props, beforeOverlap.zoom),
    );
    if (ok) b_pass += 1;
  }

  // e) force allow-overlap temporarily
  const afterOverlap = await page.evaluate(async () => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    const labelLayers = map
      .getStyle()
      .layers.filter((l) => String(l.id).startsWith("shop_poi_label"))
      .map((l) => l.id);
    const prev = {};
    for (const id of labelLayers) {
      prev[id] = {
        allow: map.getLayoutProperty(id, "text-allow-overlap"),
        ignore: map.getLayoutProperty(id, "text-ignore-placement"),
      };
      map.setLayoutProperty(id, "text-allow-overlap", true);
      map.setLayoutProperty(id, "text-ignore-placement", true);
    }
    await new Promise((r) => {
      map.once("idle", r);
      setTimeout(r, 2000);
    });
    const labels = labelLayers.length
      ? map.queryRenderedFeatures({ layers: labelLayers })
      : [];
    for (const id of labelLayers) {
      map.setLayoutProperty(
        id,
        "text-allow-overlap",
        prev[id].allow ?? false,
      );
      map.setLayoutProperty(
        id,
        "text-ignore-placement",
        prev[id].ignore ?? false,
      );
    }
    await new Promise((r) => {
      map.once("idle", r);
      setTimeout(r, 500);
    });
    return { e_labels_overlap: labels.length };
  });

  rows.push({
    zoom: beforeOverlap.zoom,
    a_namedInView: beforeOverlap.a_namedInView,
    b_filterPass: b_pass,
    c_dots: beforeOverlap.c_dots,
    d_labels: beforeOverlap.d_labels,
    e_labels_overlap: afterOverlap.e_labels_overlap,
    activeLabelLayers: activeFilters.map((a) => a.id),
  });

  await page.screenshot({
    path: path.join(outDir, `shop-poi-diag-z${zoom}.png`),
    fullPage: false,
  });
}

const report = {
  center: CENTER,
  viewport: { width: 390, height: 844 },
  rows,
  layerDefs,
  console: consoleLines.slice(0, 80),
};
fs.writeFileSync(
  path.join(outDir, "shop-poi-diag.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
