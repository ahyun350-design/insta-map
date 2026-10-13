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
