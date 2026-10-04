export const COMPACT_MAPLIBRE_STORAGE_KEY = "pindmap_admin_compact_maplibre";

/** Session-only: after OpenFreeMap fallback, stay on Kakao until reload. */
let sessionForceKakao = false;

export function isSessionForceKakaoCompact(): boolean {
  return sessionForceKakao;
}

export function setSessionForceKakaoCompact(force: boolean): void {
  sessionForceKakao = force;
}

export function readCompactMapLibreFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COMPACT_MAPLIBRE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCompactMapLibreFlag(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(COMPACT_MAPLIBRE_STORAGE_KEY, "1");
    else window.localStorage.removeItem(COMPACT_MAPLIBRE_STORAGE_KEY);
  } catch {
    /* ignore quota */
  }
}

/** Admin + localStorage on + no session fallback. */
export function shouldUseCompactMapLibre(isAdmin: boolean): boolean {
  if (!isAdmin) return false;
  if (sessionForceKakao) return false;
  return readCompactMapLibreFlag();
}
