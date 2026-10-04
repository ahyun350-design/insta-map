/**
 * Admin-only MapLibre basemap theme (paper | neon).
 * Non-admins always resolve to paper. Default paper.
 */
export type AdminMapLibreThemeId = "paper" | "neon";

export const ADMIN_MAP_THEME_STORAGE_KEY = "pindmap_admin_map_theme";

export function readAdminMapLibreTheme(): AdminMapLibreThemeId {
  if (typeof window === "undefined") return "paper";
  try {
    const v = window.localStorage.getItem(ADMIN_MAP_THEME_STORAGE_KEY);
    return v === "neon" ? "neon" : "paper";
  } catch {
    return "paper";
  }
}

export function writeAdminMapLibreTheme(theme: AdminMapLibreThemeId): void {
  if (typeof window === "undefined") return;
  try {
    if (theme === "paper") {
      window.localStorage.removeItem(ADMIN_MAP_THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ADMIN_MAP_THEME_STORAGE_KEY, theme);
    }
  } catch {
    /* ignore quota */
  }
}

/** Theme id passed to buildPindmapStyle for MapLibre surfaces. */
export function resolveMapLibreThemeId(isAdmin: boolean): AdminMapLibreThemeId {
  if (!isAdmin) return "paper";
  return readAdminMapLibreTheme();
}

export function adminMapThemeLabel(theme: AdminMapLibreThemeId): string {
  return theme === "neon" ? "네온" : "페이퍼";
}
