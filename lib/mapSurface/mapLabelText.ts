/**
 * Shared MapLibre text-field helpers for place labels.
 */

/** Prefer Korean name fields from OpenMapTiles. */
export const KO_TEXT_RAW: unknown = [
  "coalesce",
  ["get", "name:ko"],
  ["get", "name:nonlatin"],
  ["get", "name"],
];

/** Prefer Korean (name:ko / nonlatin) so Latin-only name is last resort. */
export const SHOP_TEXT_RAW: unknown = [
  "coalesce",
  ["get", "name:ko"],
  ["get", "name:nonlatin"],
  ["get", "name"],
];

/**
 * Strip parenthetical bilingual / branch suffixes: "이름 (English)", "타워(타워2)".
 * Always strip when a paren is present (not only for long names).
 */
export function stripParenName(rawExpr: unknown): unknown {
  return [
    "let",
    "raw",
    ["to-string", ["coalesce", rawExpr, ""]],
    [
      "case",
      [">=", ["index-of", "(", ["var", "raw"]], 0],
      [
        "slice",
        ["var", "raw"],
        0,
        ["index-of", "(", ["var", "raw"]],
      ],
      [">=", ["index-of", "（", ["var", "raw"]], 0],
      [
        "slice",
        ["var", "raw"],
        0,
        ["index-of", "（", ["var", "raw"]],
      ],
      ["var", "raw"],
    ],
  ];
}

/** @deprecated alias — use stripParenName */
export function stripLongParenName(rawExpr: unknown): unknown {
  return stripParenName(rawExpr);
}

/**
 * Truncate very long labels (often Latin-only shop names) for 2-line wrap + ellipsis.
 * Korean short names pass through; MapLibre text-max-width handles soft wrap.
 */
export function truncateLongLabel(rawExpr: unknown, maxLen = 20): unknown {
  return [
    "let",
    "s",
    ["to-string", ["coalesce", rawExpr, ""]],
    [
      "case",
      [">", ["length", ["var", "s"]], maxLen],
      ["concat", ["slice", ["var", "s"], 0, maxLen - 1], "…"],
      ["var", "s"],
    ],
  ];
}

export const KO_TEXT: unknown = stripParenName(KO_TEXT_RAW);
/** Prefer KO; wrap via text-max-width; hard-cap ~10 chars for density. */
export const SHOP_TEXT: unknown = truncateLongLabel(stripParenName(SHOP_TEXT_RAW), 10);
export const GEOJSON_NAME_TEXT: unknown = stripParenName(["get", "name"]);
/** Sangga/tour names with same short cap as shops. */
export const POI_NAME_TEXT: unknown = truncateLongLabel(
  stripParenName(["get", "name"]),
  10,
);

/**
 * Dong / neighbourhood labels: ensure a 동/가/리 suffix so they don't share
 * the exact string with a station name (공덕 vs 공덕동). Keep exceptions like 여의도.
 */
export const DONG_TEXT: unknown = [
  "let",
  "base",
  KO_TEXT,
  [
    "case",
    ["==", ["var", "base"], ""],
    "",
    [
      "match",
      ["var", "base"],
      ["종로", "을지로", "세종로", "테헤란로"],
      true,
      false,
    ],
    ["var", "base"],
    [
      "match",
      ["slice", ["var", "base"], ["-", ["length", ["var", "base"]], 1]],
      ["동", "가", "리", "로"],
      true,
      false,
    ],
    ["var", "base"],
    // 공덕→공덕동, 여의도→여의도동 so station short names stay unique
    ["concat", ["var", "base"], "동"],
  ],
];

/** Shared collision padding: denser placement without allow-overlap. */
export const PLACE_TEXT_PADDING: unknown = [
  "interpolate",
  ["linear"],
  ["zoom"],
  11,
  2.5,
  13,
  2,
  14,
  1.8,
  15,
  1.6,
  16,
  1.2,
];

export const PLACE_VARIABLE_ANCHOR = ["right", "left", "top", "bottom"] as const;
/** POI icon+name: left/right only (Kakao — no top/bottom drift). Prefer name right of icon. */
export const POI_VARIABLE_ANCHOR = ["left", "right"] as const;
export const ADMIN_VARIABLE_ANCHOR = ["center", "top", "bottom"] as const;
/** 22px circle icon → ~11px radius + gap ≈ 1.1em at 12.5px text */
export const ICON_TEXT_RADIAL_OFFSET = 1.1;
/** Shop/POI name wrap ≈ 8–10 Hangul chars. */
export const POI_TEXT_MAX_WIDTH = 5;
