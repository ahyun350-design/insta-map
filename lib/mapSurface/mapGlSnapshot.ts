/**
 * Admin MapLibre minimap last-frame snapshot (device-local image only).
 * Meta uses numeric lat/lng/level for validity — no address strings.
 */

export const MAP_GL_SNAPSHOT_IMG_KEY = "pindmap_mapgl_snap_img";
export const MAP_GL_SNAPSHOT_META_KEY = "pindmap_mapgl_snap_meta";
/** Soft cap — over this we skip persist. */
export const MAP_GL_SNAPSHOT_MAX_BYTES = 300 * 1024;
/** Discard snapshot if camera moved farther than this (km). */
export const MAP_GL_SNAPSHOT_MAX_DISTANCE_KM = 30;
/** Discard if Kakao-equivalent level differs by more than this. */
export const MAP_GL_SNAPSHOT_MAX_LEVEL_DELTA = 2;

export type MapGlSnapshotMeta = {
  /** Schema version */
  v: 1;
  lat: number;
  lng: number;
  level: number;
  /** 0 = paper, 1 = neon — short code, not a URL */
  theme: 0 | 1;
};

export type MapGlSnapshotRecord = {
  dataUrl: string;
  meta: MapGlSnapshotMeta;
};

export function themeToCode(theme: "paper" | "neon"): 0 | 1 {
  return theme === "neon" ? 1 : 0;
}

export function codeToTheme(code: 0 | 1): "paper" | "neon" {
  return code === 1 ? "neon" : "paper";
}

/** Approximate great-circle distance in km. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function dataUrlByteLength(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  // base64 → bytes
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Whether a stored snapshot may be shown for the upcoming camera.
 * Pure — used by unit tests and load path.
 */
export function shouldUseMapGlSnapshot(
  meta: MapGlSnapshotMeta | null | undefined,
  current: { lat: number; lng: number; level: number; theme: 0 | 1 },
  opts?: {
    maxDistanceKm?: number;
    maxLevelDelta?: number;
  },
): boolean {
  if (!meta || meta.v !== 1) return false;
  if (
    !Number.isFinite(meta.lat) ||
    !Number.isFinite(meta.lng) ||
    !Number.isFinite(meta.level)
  ) {
    return false;
  }
  if (
    !Number.isFinite(current.lat) ||
    !Number.isFinite(current.lng) ||
    !Number.isFinite(current.level)
  ) {
    return false;
  }
  if (meta.theme !== current.theme) return false;
  const maxKm = opts?.maxDistanceKm ?? MAP_GL_SNAPSHOT_MAX_DISTANCE_KM;
  const maxLevel = opts?.maxLevelDelta ?? MAP_GL_SNAPSHOT_MAX_LEVEL_DELTA;
  if (Math.abs(meta.level - current.level) > maxLevel) return false;
  if (distanceKm(meta, current) > maxKm) return false;
  return true;
}

/** Persist only when under byte cap; returns false if skipped. */
export function canPersistMapGlSnapshot(
  dataUrl: string,
  maxBytes: number = MAP_GL_SNAPSHOT_MAX_BYTES,
): boolean {
  if (!dataUrl.startsWith("data:image/")) return false;
  return dataUrlByteLength(dataUrl) <= maxBytes;
}

export function parseMapGlSnapshotMeta(raw: string | null): MapGlSnapshotMeta | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<MapGlSnapshotMeta>;
    if (o?.v !== 1) return null;
    if (
      typeof o.lat !== "number" ||
      typeof o.lng !== "number" ||
      typeof o.level !== "number"
    ) {
      return null;
    }
    const theme = o.theme === 1 ? 1 : o.theme === 0 ? 0 : null;
    if (theme == null) return null;
    return { v: 1, lat: o.lat, lng: o.lng, level: o.level, theme };
  } catch {
    return null;
  }
}

async function prefsGet(key: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key });
    return value;
  } catch {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

async function prefsSet(key: string, value: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value });
    return;
  } catch {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }
}

async function prefsRemove(key: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key });
    return;
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export async function readMapGlSnapshot(): Promise<MapGlSnapshotRecord | null> {
  try {
    const [img, metaRaw] = await Promise.all([
      prefsGet(MAP_GL_SNAPSHOT_IMG_KEY),
      prefsGet(MAP_GL_SNAPSHOT_META_KEY),
    ]);
    if (!img || !img.startsWith("data:image/")) return null;
    const meta = parseMapGlSnapshotMeta(metaRaw);
    if (!meta) return null;
    if (!canPersistMapGlSnapshot(img)) return null;
    return { dataUrl: img, meta };
  } catch {
    return null;
  }
}

export async function writeMapGlSnapshot(
  dataUrl: string,
  meta: Omit<MapGlSnapshotMeta, "v">,
): Promise<boolean> {
  try {
    if (!canPersistMapGlSnapshot(dataUrl)) return false;
    const payload: MapGlSnapshotMeta = {
      v: 1,
      lat: meta.lat,
      lng: meta.lng,
      level: meta.level,
      theme: meta.theme,
    };
    await prefsSet(MAP_GL_SNAPSHOT_META_KEY, JSON.stringify(payload));
    await prefsSet(MAP_GL_SNAPSHOT_IMG_KEY, dataUrl);
    return true;
  } catch {
    return false;
  }
}

export async function clearMapGlSnapshot(): Promise<void> {
  await Promise.all([
    prefsRemove(MAP_GL_SNAPSHOT_IMG_KEY),
    prefsRemove(MAP_GL_SNAPSHOT_META_KEY),
  ]);
}


/** Live map replaces snapshot after idle/ready — fade then clear. */
export const MAP_GL_SNAPSHOT_FADE_MS = 200;

export function shouldFadeSnapshotAfterReady(input: {
  liveMapReady: boolean;
  snapshotVisible: boolean;
}): boolean {
  return Boolean(input.liveMapReady && input.snapshotVisible);
}
