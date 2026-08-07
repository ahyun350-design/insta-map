/** 주소 → 좌표 geocode 캐시 (메모리 + Preferences) */

export type GeocodeLatLng = { lat: number; lng: number };

const GEOCODE_PREFS_KEY = "pindmap_cache_geocode_by_address";
const memory = new Map<string, GeocodeLatLng>();
let hydratePromise: Promise<void> | null = null;

function normalizeAddressKey(address: string): string {
  return address.trim().replace(/\s+/g, " ");
}

function isValidCoords(v: unknown): v is GeocodeLatLng {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.lat === "number" &&
    typeof o.lng === "number" &&
    Number.isFinite(o.lat) &&
    Number.isFinite(o.lng)
  );
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

/** 앱 기동 시 한 번 Preferences → 메모리 */
export function hydrateGeocodeCache(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const raw = await prefsGet(GEOCODE_PREFS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!k || !isValidCoords(v)) continue;
        memory.set(normalizeAddressKey(k), { lat: v.lat, lng: v.lng });
      }
    } catch {
      /* ignore corrupt cache */
    }
  })();
  return hydratePromise;
}

export function getGeocodeCacheSync(address: string): GeocodeLatLng | null {
  const key = normalizeAddressKey(address);
  if (!key) return null;
  return memory.get(key) ?? null;
}

export async function setGeocodeCache(address: string, coords: GeocodeLatLng): Promise<void> {
  const key = normalizeAddressKey(address);
  if (!key || !isValidCoords(coords)) return;
  memory.set(key, { lat: coords.lat, lng: coords.lng });
  const obj: Record<string, GeocodeLatLng> = {};
  memory.forEach((v, k) => {
    obj[k] = v;
  });
  // 너무 커지지 않게 최근 800개만 유지
  const keys = Object.keys(obj);
  if (keys.length > 800) {
    const drop = keys.slice(0, keys.length - 800);
    drop.forEach((k) => {
      delete obj[k];
      memory.delete(k);
    });
  }
  await prefsSet(GEOCODE_PREFS_KEY, JSON.stringify(obj));
}
