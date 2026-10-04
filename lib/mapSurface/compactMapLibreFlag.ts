import {
  type AdminMapGlOverride,
  shouldUseMapLibre,
} from "./rollout";

export const COMPACT_MAPLIBRE_STORAGE_KEY = "pindmap_admin_compact_maplibre";

/** Session-only: after OpenFreeMap/WebGL fallback, stay on Kakao until reload. */
let sessionForceKakao = false;

export function isSessionForceKakaoCompact(): boolean {
  return sessionForceKakao;
}

export function setSessionForceKakaoCompact(force: boolean): void {
  sessionForceKakao = force;
}

/** Tri-state: "1" force ML · "0" force Kakao · absent = auto (rollout). */
export function readCompactMapLibreOverride(): AdminMapGlOverride {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(COMPACT_MAPLIBRE_STORAGE_KEY);
    if (v === "1") return "force_maplibre";
    if (v === "0") return "force_kakao";
    return "auto";
  } catch {
    return "auto";
  }
}

/** @deprecated use readCompactMapLibreOverride — true only for force_maplibre */
export function readCompactMapLibreFlag(): boolean {
  return readCompactMapLibreOverride() === "force_maplibre";
}

export function writeCompactMapLibreOverride(override: AdminMapGlOverride): void {
  if (typeof window === "undefined") return;
  try {
    if (override === "force_maplibre") {
      window.localStorage.setItem(COMPACT_MAPLIBRE_STORAGE_KEY, "1");
    } else if (override === "force_kakao") {
      window.localStorage.setItem(COMPACT_MAPLIBRE_STORAGE_KEY, "0");
    } else {
      window.localStorage.removeItem(COMPACT_MAPLIBRE_STORAGE_KEY);
    }
  } catch {
    /* ignore quota */
  }
}

/** @deprecated use writeCompactMapLibreOverride */
export function writeCompactMapLibreFlag(enabled: boolean): void {
  writeCompactMapLibreOverride(enabled ? "force_maplibre" : "force_kakao");
}

/** Compact MapLibre: session fallback > admin override > rollout. */
export function shouldUseCompactMapLibre(
  isAdmin: boolean,
  userId?: string | null,
): boolean {
  return shouldUseMapLibre({
    isAdmin,
    userId,
    sessionForceKakao,
    adminOverride: isAdmin ? readCompactMapLibreOverride() : "auto",
    surface: "compact",
  });
}
