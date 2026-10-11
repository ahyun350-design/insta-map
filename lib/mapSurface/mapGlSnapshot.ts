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
/** Live map replaces snapshot after idle/ready — fade then clear. */
export const MAP_GL_SNAPSHOT_FADE_MS = 200;
/** Hard cap: remove stuck placeholder even if fade path failed. */
export const MAP_GL_SNAPSHOT_FAILSAFE_MS = 5000;

export const MAP_GL_SNAPSHOT_BG_PAPER = "#F7F5F0";
export const MAP_GL_SNAPSHOT_BG_NEON = "#0E1230";

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

export type SnapshotRgba = { r: number; g: number; b: number; a: number };

export type SnapshotSampleVerdict = "ok" | "black" | "transparent" | "flat";

export function themeToCode(theme: "paper" | "neon"): 0 | 1 {
  return theme === "neon" ? 1 : 0;
}

export function codeToTheme(code: 0 | 1): "paper" | "neon" {
  return code === 1 ? "neon" : "paper";
}

export function snapshotBackgroundCss(theme: "paper" | "neon" | 0 | 1): string {
  if (theme === "neon" || theme === 1) return MAP_GL_SNAPSHOT_BG_NEON;
  return MAP_GL_SNAPSHOT_BG_PAPER;
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

function luminance(s: SnapshotRgba): number {
  return 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
}

/** Sample a grid of pixels from raw RGBA image data (row-major). */
export function sampleImageDataPixels(
  image: { data: ArrayLike<number>; width: number; height: number },
  grid = 5,
): SnapshotRgba[] {
  const { data, width, height } = image;
  if (width < 2 || height < 2) return [];
  const n = Math.max(2, Math.min(8, Math.floor(grid)));
  const out: SnapshotRgba[] = [];
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const x = Math.min(
        width - 1,
        Math.max(0, Math.round(((gx + 0.5) / n) * (width - 1))),
      );
      const y = Math.min(
        height - 1,
        Math.max(0, Math.round(((gy + 0.5) / n) * (height - 1))),
      );
      const i = (y * width + x) * 4;
      out.push({
        r: data[i] ?? 0,
        g: data[i + 1] ?? 0,
        b: data[i + 2] ?? 0,
        a: data[i + 3] ?? 0,
      });
    }
  }
  return out;
}

/**
 * Reject cleared WebGL buffers (black/transparent) and paper-only flat fills.
 * A real map frame has enough luminance range across a 5×5 sample grid.
 */
export function classifySnapshotSamples(
  samples: SnapshotRgba[],
): SnapshotSampleVerdict {
  if (samples.length < 4) return "flat";
  let transparent = 0;
  let nearBlack = 0;
  let minL = 255;
  let maxL = 0;
  for (const s of samples) {
    if (s.a < 16) transparent += 1;
    const l = luminance(s);
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
    if (s.a >= 16 && s.r < 18 && s.g < 18 && s.b < 18) nearBlack += 1;
  }
  const n = samples.length;
  if (transparent / n >= 0.8) return "transparent";
  if (nearBlack / n >= 0.85) return "black";
  if (maxL - minL < 8) return "flat";
  return "ok";
}

export function isUsableSnapshotSamples(samples: SnapshotRgba[]): boolean {
  return classifySnapshotSamples(samples) === "ok";
}

/**
 * Paint theme background, draw GL canvas, JPEG-encode.
 * Sync — call only inside a MapLibre `render` handler (or with a live buffer).
 * Does not enable preserveDrawingBuffer.
 */
export function composeMapCanvasToJpeg(
  glCanvas: HTMLCanvasElement,
  bgCss: string,
  quality = 0.72,
): string | null {
  try {
    const w = glCanvas.width;
    const h = glCanvas.height;
    if (w < 2 || h < 2) return null;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d", { alpha: false });
    if (!ctx) return null;
    ctx.fillStyle = bgCss || MAP_GL_SNAPSHOT_BG_PAPER;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(glCanvas, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    if (!isUsableSnapshotSamples(sampleImageDataPixels(imageData, 5))) {
      return null;
    }
    const dataUrl = out.toDataURL("image/jpeg", quality);
    if (!canPersistMapGlSnapshot(dataUrl)) return null;
    return dataUrl;
  } catch {
    return null;
  }
}

/** Decode data URL → sample → usable? (browser only). */
export async function isUsableSnapshotDataUrl(
  dataUrl: string,
): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (!dataUrl.startsWith("data:image/")) return false;
  try {
    const img = await loadHtmlImage(dataUrl);
    if (!img || img.naturalWidth < 2 || img.naturalHeight < 2) return false;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { alpha: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    return isUsableSnapshotSamples(sampleImageDataPixels(imageData, 5));
  } catch {
    return false;
  }
}

function loadHtmlImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    } catch {
      resolve(null);
    }
  });
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
    if (!meta) {
      await clearMapGlSnapshot();
      return null;
    }
    if (!canPersistMapGlSnapshot(img)) {
      await clearMapGlSnapshot();
      return null;
    }
    const usable = await isUsableSnapshotDataUrl(img);
    if (!usable) {
      await clearMapGlSnapshot();
      return null;
    }
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
    const usable = await isUsableSnapshotDataUrl(dataUrl);
    if (!usable) return false;
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

export function shouldFadeSnapshotAfterReady(input: {
  liveMapReady: boolean;
  snapshotVisible: boolean;
}): boolean {
  return Boolean(input.liveMapReady && input.snapshotVisible);
}
