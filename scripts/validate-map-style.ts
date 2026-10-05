/**
 * Static MapLibre style validation (no browser).
 * Uses style-spec from the installed maplibre-gl dependency tree.
 *
 * npm run validate:map-style
 */

import { createRequire } from "node:module";
import { buildPindmapStyle, type MapPreviewThemeId } from "../lib/pindmapMapStyle";

const require = createRequire(import.meta.url);
const mlPkg = require("maplibre-gl/package.json") as { version: string };
const specPkg = require("@maplibre/maplibre-gl-style-spec/package.json") as {
  version: string;
};
const { validateStyleMin } = require("@maplibre/maplibre-gl-style-spec") as {
  validateStyleMin: (style: unknown) => Array<{ message: string }>;
};

/** Production + preview themes (neon = dark route chrome). */
const THEMES: MapPreviewThemeId[] = [
  "paper",
  "white",
  "neon",
  "black",
  "mono",
  "dark",
];

async function main() {
  console.log(
    `validate:map-style — maplibre-gl@${mlPkg.version} style-spec@${specPkg.version}`,
  );
  console.log("Building styles (fetch liberty)…");

  let totalErrors = 0;
  const unsupported = new Set<string>();

  for (const id of THEMES) {
    let style: unknown;
    try {
      style = await buildPindmapStyle(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${id}: BUILD FAILED — ${msg}`);
      totalErrors += 1;
      continue;
    }

    let msgs: string[] = [];
    try {
      const result = validateStyleMin(style);
      msgs = (Array.isArray(result) ? result : []).map(
        (e) => e.message || String(e),
      );
    } catch (e) {
      msgs = [
        `validateStyleMin threw: ${e instanceof Error ? e.message : String(e)}`,
      ];
    }

    totalErrors += msgs.length;
    console.log(`  ${id}: ${msgs.length} error(s)`);
    for (const m of msgs) {
      console.log(`    - ${m}`);
      const unk = m.match(/unknown property "([^"]+)"/i);
      if (unk) unsupported.add(unk[1]);
    }
  }

  if (unsupported.size) {
    console.log(
      `\nUnsupported properties detected: ${[...unsupported].sort().join(", ")}`,
    );
  } else {
    console.log("\nNo unsupported paint/layout properties detected.");
  }

  if (totalErrors > 0) {
    console.error(`\nFAIL: ${totalErrors} style validation error(s)`);
    process.exit(1);
  }
  console.log("\nOK: all themes valid");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
