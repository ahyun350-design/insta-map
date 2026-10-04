export const EXPANDED_MAPLIBRE_STORAGE_KEY = "pindmap_admin_expanded_maplibre";

/** Session-only: after OpenFreeMap fallback, stay on Kakao/native until reload. */
let sessionForceKakaoExpanded = false;

export function isSessionForceKakaoExpanded(): boolean {
  return sessionForceKakaoExpanded;
}

export function setSessionForceKakaoExpanded(force: boolean): void {
  sessionForceKakaoExpanded = force;
}

export function readExpandedMapLibreFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(EXPANDED_MAPLIBRE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeExpandedMapLibreFlag(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(EXPANDED_MAPLIBRE_STORAGE_KEY, "1");
    else window.localStorage.removeItem(EXPANDED_MAPLIBRE_STORAGE_KEY);
  } catch {
    /* ignore quota */
  }
}

/** Admin + localStorage on + no session fallback. */
export function shouldUseExpandedMapLibre(isAdmin: boolean): boolean {
  if (!isAdmin) return false;
  if (sessionForceKakaoExpanded) return false;
  return readExpandedMapLibreFlag();
}
