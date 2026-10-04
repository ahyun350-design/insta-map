import {
  type AdminMapGlOverride,
  shouldUseMapLibre,
} from "./rollout";

export const EXPANDED_MAPLIBRE_STORAGE_KEY = "pindmap_admin_expanded_maplibre";

/** Session-only: after OpenFreeMap/WebGL fallback, stay on Kakao/native until reload. */
let sessionForceKakaoExpanded = false;

export function isSessionForceKakaoExpanded(): boolean {
  return sessionForceKakaoExpanded;
}

export function setSessionForceKakaoExpanded(force: boolean): void {
  sessionForceKakaoExpanded = force;
}

/** Tri-state: "1" force ML · "0" force Kakao · absent = auto (rollout). */
export function readExpandedMapLibreOverride(): AdminMapGlOverride {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(EXPANDED_MAPLIBRE_STORAGE_KEY);
    if (v === "1") return "force_maplibre";
    if (v === "0") return "force_kakao";
    return "auto";
  } catch {
    return "auto";
  }
}

/** @deprecated use readExpandedMapLibreOverride */
export function readExpandedMapLibreFlag(): boolean {
  return readExpandedMapLibreOverride() === "force_maplibre";
}

export function writeExpandedMapLibreOverride(
  override: AdminMapGlOverride,
): void {
  if (typeof window === "undefined") return;
  try {
    if (override === "force_maplibre") {
      window.localStorage.setItem(EXPANDED_MAPLIBRE_STORAGE_KEY, "1");
    } else if (override === "force_kakao") {
      window.localStorage.setItem(EXPANDED_MAPLIBRE_STORAGE_KEY, "0");
    } else {
      window.localStorage.removeItem(EXPANDED_MAPLIBRE_STORAGE_KEY);
    }
  } catch {
    /* ignore quota */
  }
}

/** @deprecated use writeExpandedMapLibreOverride */
export function writeExpandedMapLibreFlag(enabled: boolean): void {
  writeExpandedMapLibreOverride(enabled ? "force_maplibre" : "force_kakao");
}

/** Expanded MapLibre: session fallback > admin override > rollout. */
export function shouldUseExpandedMapLibre(
  isAdmin: boolean,
  userId?: string | null,
): boolean {
  return shouldUseMapLibre({
    isAdmin,
    userId,
    sessionForceKakao: sessionForceKakaoExpanded,
    adminOverride: isAdmin ? readExpandedMapLibreOverride() : "auto",
    surface: "expanded",
  });
}
