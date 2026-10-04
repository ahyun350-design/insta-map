import {
  MAP_BRAND_NAVY,
  MAP_NEON_ACCENT,
  MAP_NEON_CORE,
  MAP_NEON_PREVIEW,
  MAP_ROUTE_CASING_WHITE,
  MAP_ROUTE_PREVIEW_GRAY,
} from "./mapBrand";
import type { CompactRouteMode } from "./types";
import type { AdminMapLibreThemeId } from "./adminMapTheme";

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

/** Casing = main + 4px (paper). */
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

export function routeWidthPlus(extra: number): unknown {
  return ["+", ROUTE_LINE_WIDTH, extra];
}

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

export type RouteLinePaint = {
  color: string;
  opacity: number;
  width: unknown;
  dasharray: number[] | null;
  blur?: number;
};

export type RouteVisual = {
  /** Paper white casing; null when neon (glow layers replace it). */
  casing: { color: string; opacity: number; width: unknown } | null;
  /** Neon outer glow (blur). */
  glowOuter: RouteLinePaint | null;
  /** Neon mid glow (blur). */
  glowMid: RouteLinePaint | null;
  line: RouteLinePaint;
};

export function routePaintForMode(
  mode: RouteVisualMode,
  theme: AdminMapLibreThemeId = "paper",
): RouteVisual {
  if (theme === "neon") {
    if (mode === "preview") {
      return {
        casing: null,
        glowOuter: null,
        glowMid: null,
        line: {
          color: MAP_NEON_PREVIEW,
          opacity: 0.85,
          width: 2,
          dasharray: [1.2, 1.6],
          blur: 0,
        },
      };
    }
    const walk = mode === "walk";
    return {
      casing: null,
      glowOuter: {
        color: MAP_NEON_ACCENT,
        opacity: 0.35,
        width: routeWidthPlus(14),
        dasharray: null,
        blur: 12,
      },
      glowMid: {
        color: MAP_NEON_ACCENT,
        opacity: 0.6,
        width: routeWidthPlus(6),
        dasharray: null,
        blur: 4,
      },
      line: {
        color: MAP_NEON_CORE,
        opacity: 1,
        width: ROUTE_LINE_WIDTH,
        dasharray: walk ? [0.01, 1.9] : null,
        blur: 0,
      },
    };
  }

  // paper (unchanged)
  if (mode === "preview") {
    return {
      casing: null,
      glowOuter: null,
      glowMid: null,
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
      glowOuter: null,
      glowMid: null,
      line: {
        color: MAP_BRAND_NAVY,
        opacity: 1,
        width: ROUTE_LINE_WIDTH,
        dasharray: [0.01, 1.9],
      },
    };
  }
  return {
    casing: {
      color: MAP_ROUTE_CASING_WHITE,
      opacity: 0.95,
      width: ROUTE_CASING_WIDTH,
    },
    glowOuter: null,
    glowMid: null,
    line: {
      color: MAP_BRAND_NAVY,
      opacity: 1,
      width: ROUTE_LINE_WIDTH,
      dasharray: null,
    },
  };
}

export {
  MAP_BRAND_NAVY,
  MAP_ROUTE_PREVIEW_GRAY,
  MAP_ROUTE_CASING_WHITE,
  MAP_NEON_ACCENT,
  MAP_NEON_CORE,
  MAP_NEON_PREVIEW,
};
