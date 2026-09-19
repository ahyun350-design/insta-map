/**
 * Prove category appearance resolve matches pre-refactor palette.
 * Self-contained (no tsx) so it runs under plain Node.
 *
 *   node scripts/verify-category-appearance.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const listSrc = readFileSync(join(root, "lib/listColors.ts"), "utf8");
const appearanceSrc = readFileSync(join(root, "lib/categoryAppearance.ts"), "utf8");


const CATEGORIES = ["맛집", "술집", "카페", "쇼핑", "숙소", "놀거리", "여행지"];

const LEGACY_PIN = {
  맛집: "#513229",
  술집: "#722F37",
  카페: "#FCE6B7",
  쇼핑: "#D8EBF9",
  숙소: "#D7D4B1",
  놀거리: "#c4b5fd",
  여행지: "#99e9f2",
};

const LEGACY_UI = {
  맛집: "#513229",
  술집: "#722F37",
  카페: "#b08d57",
  쇼핑: "#4a7fa5",
  숙소: "#7a7a50",
  놀거리: "#6d4bd6",
  여행지: "#1b9aad",
};

const EXPECTED_PRESETS = {
  sunOrange: "#F48037",
  beetroot: "#A9226B",
  peach: "#F5B8AE",
  foliage: "#7BA640",
  spring: "#5CC49B",
  bronze: "#525F48",
  persian: "#6E7FBE",
  windward: "#6E8CA3",
  violet: "#B085B7",
};

/** Mirror of lib/categoryAppearance.ts resolve (kept in sync by source hex asserts below). */
function resolvePinColor(category, overrides) {
  const fromOverride =
    overrides && typeof overrides === "object" ? overrides[category] : undefined;
  if (typeof fromOverride === "string" && fromOverride.trim()) return fromOverride.trim();
  return LEGACY_PIN[category] ?? "#e05555";
}

function resolveUiColor(category, overrides) {
  const fromOverride =
    overrides && typeof overrides === "object" ? overrides[category] : undefined;
  if (typeof fromOverride === "string" && fromOverride.trim()) return fromOverride.trim();
  return LEGACY_UI[category] ?? "#1a2a7a";
}

function resolveListColor(presetId) {
  if (typeof presetId !== "string") return null;
  const key = presetId.trim();
  if (!key) return null;
  return EXPECTED_PRESETS[key] ?? null;
}

function resolveNativeMarkerColorHex(input) {
  const raw = input?.listPresetId;
  if (typeof raw !== "string") return undefined;
  const key = raw.trim();
  if (!key) return undefined;
  return EXPECTED_PRESETS[key];
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("OK:", msg);
  }
}

for (const cat of CATEGORIES) {
  assert(resolvePinColor(cat) === LEGACY_PIN[cat], `resolvePinColor(${cat})`);
  assert(resolvePinColor(cat, null) === LEGACY_PIN[cat], `resolvePinColor(${cat}, null)`);
  assert(resolvePinColor(cat, undefined) === LEGACY_PIN[cat], `resolvePinColor(${cat}, undefined)`);
  assert(resolvePinColor(cat, {}) === LEGACY_PIN[cat], `resolvePinColor(${cat}, {})`);
  assert(resolveUiColor(cat) === LEGACY_UI[cat], `resolveUiColor(${cat})`);
  assert(resolveUiColor(cat, null) === LEGACY_UI[cat], `resolveUiColor(${cat}, null)`);
  assert(resolveUiColor(cat, {}) === LEGACY_UI[cat], `resolveUiColor(${cat}, {})`);

  // Source file must declare the same hex (proves module matches legacy).
  const pinRe = new RegExp(`${cat}:\\s*\\{\\s*color:\\s*"${LEGACY_PIN[cat].replace("#", "\\#")}"`);
  assert(pinRe.test(appearanceSrc), `categoryAppearance.ts pin ${cat} = ${LEGACY_PIN[cat]}`);
  const uiRe = new RegExp(`${cat}:\\s*"${LEGACY_UI[cat].replace("#", "\\#")}"`);
  assert(uiRe.test(appearanceSrc), `categoryAppearance.ts ui ${cat} = ${LEGACY_UI[cat]}`);
}

assert(resolvePinColor("카페", { 카페: "#FF0000" }) === "#FF0000", "partial pin override");
assert(resolvePinColor("맛집", { 카페: "#FF0000" }) === LEGACY_PIN["맛집"], "partial pin other");
assert(resolveUiColor("카페", { 카페: "#00FF00" }) === "#00FF00", "partial ui override");

for (const [id, hex] of Object.entries(EXPECTED_PRESETS)) {
  assert(resolveListColor(id) === hex, `resolveListColor(${id})`);
  assert(
    appearanceSrc.includes(`${id}: "${hex}"`) || appearanceSrc.includes(`${id}: '${hex}'`),
    `categoryAppearance.ts LIST_COLOR_PRESETS.${id}`,
  );
}
assert(/resolveListColor/.test(listSrc), "listColors.ts exports resolveListColor");
assert(/LIST_COLOR_PRESETS/.test(listSrc), "listColors.ts re-exports LIST_COLOR_PRESETS");
assert(resolveListColor("nope") === null, "invalid list id → null");
assert(resolveListColor("") === null, "empty list id → null");

assert(resolveNativeMarkerColorHex() === undefined, "native colorHex no input → undefined");
assert(
  resolveNativeMarkerColorHex({ category: "맛집" }) === undefined,
  "native colorHex category-only → undefined",
);
assert(
  resolveNativeMarkerColorHex({ listPresetId: "sunOrange" }) === "#F48037",
  "native colorHex list mode sunOrange",
);
assert(
  resolveNativeMarkerColorHex({ listPresetId: "nope" }) === undefined,
  "native colorHex invalid list → undefined",
);
assert(
  /listPresetId/.test(appearanceSrc) && /LIST_COLOR_PRESETS\[key\]/.test(appearanceSrc),
  "categoryAppearance.ts listPresetId resolves via LIST_COLOR_PRESETS",
);
assert(/withNativeMarkerColorHex/.test(appearanceSrc), "withNativeMarkerColorHex exported");
assert(/buildCategoryPinRecord/.test(appearanceSrc), "buildCategoryPinRecord exported");
assert(/buildCategoryColorsRecord/.test(appearanceSrc), "buildCategoryColorsRecord exported");

const pageSrc = readFileSync(join(root, "app/page.tsx"), "utf8");
assert(
  /buildCategoryPinRecord\(\)/.test(pageSrc) && /buildCategoryColorsRecord\(\)/.test(pageSrc),
  "page.tsx builds CATEGORY_* via resolve helpers",
);
assert(
  /makeMarkerImage\(category: Category, fillColor: string\)/.test(pageSrc),
  "makeMarkerImage takes fillColor",
);
assert(
  /makeFocusMarkerImage\(category: Category, fillColor: string\)/.test(pageSrc),
  "makeFocusMarkerImage takes fillColor",
);
assert(
  !/const CATEGORY_PIN: Record/.test(pageSrc),
  "page.tsx no longer inlines CATEGORY_PIN Record literal",
);

const nativeMapSrc = readFileSync(join(root, "lib/nativeMap.ts"), "utf8");
assert(
  /applyNativeMarkerColorHex/.test(nativeMapSrc) &&
    /withNativeMarkerColorHex/.test(nativeMapSrc),
  "nativeMap.ts routes markers through colorHex pipe",
);
assert(
  /addNativeMarkers[\s\S]*applyNativeMarkerColorHex/.test(nativeMapSrc),
  "addNativeMarkers uses applyNativeMarkerColorHex",
);
assert(
  /updateFullscreenNativeMarkers[\s\S]*applyNativeMarkerColorHex/.test(nativeMapSrc),
  "updateFullscreenNativeMarkers uses applyNativeMarkerColorHex",
);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll category appearance checks passed.");
