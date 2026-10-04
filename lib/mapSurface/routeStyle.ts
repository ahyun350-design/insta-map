import {
  MAP_BRAND_NAVY,
  MAP_ROUTE_CASING_WHITE,
  MAP_ROUTE_PREVIEW_GRAY,
} from "./mapBrand";
import type { CompactRouteMode } from "./types";

/** Main stroke width by zoom (z10→3, z13→4.5, z16→6). */
export const ROUTE_LINE_WIDTH: unknown = [
  "interpolate",
  ["linear"],
  ["zoom"],
  10,
  3,
  13,
  4.5,
  16,
  6,
];

/** Casing = main + 4px. */
export const ROUTE_CASING_WIDTH: unknown = [
  "interpolate",
  ["linear"],
  ["zoom"],
  10,
  7,
  13,
  8.5,
  16,
  10,
];

export const ROUTE_LAYOUT = {
  "line-cap": "round" as const,
  "line-join": "round" as const,
};

/** Compact minimap fit padding. */
export const COMPACT_ROUTE_FIT_PADDING = {
  top: 28,
  right: 28,
  bottom: 28,
  left: 28,
};

/** Expanded fullscreen default fit padding (search bar / sheet). */
export const EXPANDED_ROUTE_FIT_PADDING = {
  top: 108,
  right: 28,
  bottom: 280,
  left: 28,
};

export type RouteVisualMode = CompactRouteMode;

export function routePaintForMode(mode: RouteVisualMode): {
  casing: { color: string; opacity: number; width: unknown } | null;
  line: {
    color: string;
    opacity: number;
    width: unknown;
    dasharray: number[] | null;
  };
} {
  if (mode === "preview") {
    return {
      casing: null,
      line: {
        color: MAP_ROUTE_PREVIEW_GRAY,
        opacity: 1,
        width: 2,
        dasharray: [1.2, 1.6],
      },
    };
  }
  if (mode === "walk") {
    return {
      casing: {
        color: MAP_ROUTE_CASING_WHITE,
        opacity: 0.95,
        width: ROUTE_CASING_WIDTH,
      },
      line: {
        color: MAP_BRAND_NAVY,
        opacity: 1,
        // Round-cap + tiny dash → dotted “beads”
        width: ROUTE_LINE_WIDTH,
        dasharray: [0.01, 1.9],
      },
    };
  }
  // car | course — solid navy + white casing
  return {
    casing: {
      color: MAP_ROUTE_CASING_WHITE,
      opacity: 0.95,
      width: ROUTE_CASING_WIDTH,
    },
    line: {
      color: MAP_BRAND_NAVY,
      opacity: 1,
      width: ROUTE_LINE_WIDTH,
      dasharray: null,
    },
  };
}

export { MAP_BRAND_NAVY, MAP_ROUTE_PREVIEW_GRAY, MAP_ROUTE_CASING_WHITE };
