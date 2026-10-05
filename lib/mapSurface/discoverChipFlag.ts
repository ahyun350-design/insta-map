/**
 * Admin-only: show "인기 장소" chip on MapLibre fullscreen.
 * Default off — chip hidden unless explicitly enabled in MY settings.
 */

export const DISCOVER_CHIP_STORAGE_KEY = "pindmap_admin_discover_chip";

export function readDiscoverChipEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISCOVER_CHIP_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDiscoverChipEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) {
      window.localStorage.setItem(DISCOVER_CHIP_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(DISCOVER_CHIP_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}
