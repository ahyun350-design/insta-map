/**
 * Admin-only preference: directions chrome basemap (dark | paper).
 * Default dark. Non-admins never read this for UI.
 */

export type DirectionsRouteThemeId = "dark" | "paper";

export const DIRECTIONS_ROUTE_THEME_STORAGE_KEY =
  "pindmap_admin_directions_route_theme";

export function readDirectionsRouteTheme(): DirectionsRouteThemeId {
  if (typeof window === "undefined") return "dark";
  try {
    const v = window.localStorage.getItem(DIRECTIONS_ROUTE_THEME_STORAGE_KEY);
    return v === "paper" ? "paper" : "dark";
  } catch {
    return "dark";
  }
}

export function writeDirectionsRouteTheme(
  theme: DirectionsRouteThemeId,
): void {
  if (typeof window === "undefined") return;
  try {
    if (theme === "dark") {
      window.localStorage.removeItem(DIRECTIONS_ROUTE_THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(DIRECTIONS_ROUTE_THEME_STORAGE_KEY, theme);
    }
  } catch {
    /* ignore quota */
  }
}

export function directionsRouteThemeLabel(
  theme: DirectionsRouteThemeId,
): string {
  return theme === "paper" ? "페이퍼" : "다크";
}
