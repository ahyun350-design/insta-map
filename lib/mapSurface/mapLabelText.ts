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

export const SHOP_TEXT_RAW: unknown = [
  "coalesce",
  ["get", "name:ko"],
  ["get", "name"],
];

/**
 * Strip trailing parenthetical (e.g. "NH금융타워(타워2)") when the name is long.
 * Uses MapLibre index-of / slice (supported in 4.7).
 */
export function stripLongParenName(rawExpr: unknown): unknown {
  return [
    "let",
    "raw",
    ["to-string", ["coalesce", rawExpr, ""]],
    [
      "case",
      [
        "all",
        [">", ["length", ["var", "raw"]], 10],
        [">=", ["index-of", "(", ["var", "raw"]], 0],
      ],
      [
        "slice",
        ["var", "raw"],
        0,
        ["index-of", "(", ["var", "raw"]],
      ],
      [
        "all",
        [">", ["length", ["var", "raw"]], 10],
        [">=", ["index-of", "（", ["var", "raw"]], 0],
      ],
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

export const KO_TEXT: unknown = stripLongParenName(KO_TEXT_RAW);
export const SHOP_TEXT: unknown = stripLongParenName(SHOP_TEXT_RAW);
export const GEOJSON_NAME_TEXT: unknown = stripLongParenName(["get", "name"]);

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
  2,
  13,
  2,
  14,
  1.5,
  15,
  1.5,
  16,
  1,
];

export const PLACE_VARIABLE_ANCHOR = ["right", "left", "top", "bottom"] as const;
export const ADMIN_VARIABLE_ANCHOR = ["center", "top", "bottom"] as const;
/** 20px circle icon → ~10px radius + gap ≈ 1.05em */
export const ICON_TEXT_RADIAL_OFFSET = 1.05;
