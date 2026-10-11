/**
 * Lab: ensure MapLibre canvas capture (render + paper composite) is not black/flat.
 * Playwright webkit, iPhone 13. Not part of npm run e2e.
 *
 * Usage: node scripts/lab-map-snapshot-quality.mjs [baseURL]
 */
import { webkit, chromium, devices } from "@playwright/test";
import assert from "node:assert/strict";

const BASE = process.argv[2] || process.env.LAB_BASE_URL || "https://pindmap.com";
const iphone = devices["iPhone 13"];

async function main() {
  let browserType = webkit;
  let engine = "webkit";
  try {
    const b = await webkit.launch({ headless: true });
    await b.close();
  } catch {
    browserType = chromium;
    engine = "chromium_fallback";
    console.warn("[lab-snap] webkit unavailable — chromium fallback");
  }

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    ...iphone,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/map-preview`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => window.__PINDMAP_PREVIEW_DIAG__?.loadMs != null,
    { timeout: 45_000 },
  );
  // Wait for a settled frame
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    const map = window.__PINDMAP_PREVIEW_MAP__;
    if (!map) return { ok: false, reason: "no_map" };
    const BG = "#F7F5F0";

    const sample = (imageData, grid = 5) => {
      const { data, width, height } = imageData;
      const n = grid;
      const out = [];
      for (let gy = 0; gy < n; gy++) {
        for (let gx = 0; gx < n; gx++) {
          const x = Math.min(
            width - 1,
            Math.max(0, Math.round(((gx + 0.5) / n) * (width - 1))),
          );
          const y = Math.min(
            height - 1,
            Math.max(0, Math.round(((gy + 0.5) / n) * (height - 1))),
          );
          const i = (y * width + x) * 4;
          out.push({
            r: data[i],
            g: data[i + 1],
            b: data[i + 2],
            a: data[i + 3],
          });
        }
      }
      return out;
    };

    const classify = (samples) => {
      let transparent = 0;
      let nearBlack = 0;
      let minL = 255;
      let maxL = 0;
      for (const s of samples) {
        if (s.a < 16) transparent += 1;
        const l = 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
        if (l < minL) minL = l;
        if (l > maxL) maxL = l;
        if (s.a >= 16 && s.r < 18 && s.g < 18 && s.b < 18) nearBlack += 1;
      }
      const n = samples.length;
      if (transparent / n >= 0.8) return "transparent";
      if (nearBlack / n >= 0.85) return "black";
      if (maxL - minL < 8) return "flat";
      return "ok";
    };

    const capture = () =>
      new Promise((resolve) => {
        let done = false;
        const finish = (v) => {
          if (done) return;
          done = true;
          map.off("render", onRender);
          resolve(v);
        };
        const onRender = () => {
          try {
            const gl = map.getCanvas();
            const out = document.createElement("canvas");
            out.width = gl.width;
            out.height = gl.height;
            const ctx = out.getContext("2d", { alpha: false });
            ctx.fillStyle = BG;
            ctx.fillRect(0, 0, out.width, out.height);
            ctx.drawImage(gl, 0, 0);
            const imageData = ctx.getImageData(0, 0, out.width, out.height);
            const samples = sample(imageData, 5);
            const verdict = classify(samples);
            const mid = samples[Math.floor(samples.length / 2)];
            finish({
              ok: verdict === "ok",
              verdict,
              mid,
              range:
                Math.max(
                  ...samples.map((s) => 0.299 * s.r + 0.587 * s.g + 0.114 * s.b),
                ) -
                Math.min(
                  ...samples.map((s) => 0.299 * s.r + 0.587 * s.g + 0.114 * s.b),
                ),
              // naive late capture (should often be black without preserveDrawingBuffer)
              lateBlack: (() => {
                setTimeout(() => {}, 0);
                return null;
              })(),
            });
          } catch (e) {
            finish({ ok: false, reason: String(e) });
          }
        };
        map.on("render", onRender);
        map.triggerRepaint();
        setTimeout(() => finish({ ok: false, reason: "timeout" }), 2000);
      });

    const composed = await capture();

    // Delayed toDataURL without render — demonstrates cleared buffer risk
    await new Promise((r) => setTimeout(r, 50));
    let lateVerdict = "n/a";
    try {
      const gl = map.getCanvas();
      const url = gl.toDataURL("image/jpeg", 0.72);
      const img = await new Promise((resolve) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => resolve(null);
        i.src = url;
      });
      if (img) {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        lateVerdict = classify(
          sample(ctx.getImageData(0, 0, c.width, c.height), 5),
        );
      }
    } catch {
      lateVerdict = "error";
    }

    return { composed, lateVerdict };
  });

  console.log("[lab-snap]", { engine, base: BASE, result });
  assert.equal(result.composed?.ok, true, `composed not ok: ${JSON.stringify(result)}`);
  assert.notEqual(result.composed?.verdict, "black");
  assert.ok(result.composed?.range >= 8, "luminance range too small");

  await browser.close();
  console.log("[lab-snap] PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
