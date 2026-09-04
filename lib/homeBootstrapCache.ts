/** 홈(지도) 부트스트랩 캐시 — Capacitor Preferences (+ localStorage 폴백) */

export const CACHE_PLACES_KEY = "pindmap_cache_places";
export const CACHE_MAPVIEW_KEY = "pindmap_cache_mapview";

export type CachedPlace = {
  id: string;
  name: string;
  address: string;
  category: string;
  lat?: number;
  lng?: number;
  created_at?: string;
};

export type CachedPlacesPayload = {
  userId: string;
  places: CachedPlace[];
};

export type CachedMapView = {
  lat: number;
  lng: number;
  level: number;
};

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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parsePlace(raw: unknown): CachedPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  if (typeof o.name !== "string") return null;
  if (typeof o.address !== "string") return null;
  if (typeof o.category !== "string") return null;
  const place: CachedPlace = {
    id: o.id,
    name: o.name,
    address: o.address,
    category: o.category,
  };
  if (isFiniteNumber(o.lat) && isFiniteNumber(o.lng)) {
    place.lat = o.lat;
    place.lng = o.lng;
  }
  if (typeof o.created_at === "string" && o.created_at.trim()) {
    place.created_at = o.created_at.trim();
  }
  return place;
}

export async function readCachedPlaces(): Promise<CachedPlacesPayload | null> {
  const raw = await prefsGet(CACHE_PLACES_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.userId !== "string" || !o.userId) return null;
    if (!Array.isArray(o.places)) return null;
    const places = o.places.map(parsePlace).filter((p): p is CachedPlace => p !== null);
    return { userId: o.userId, places };
  } catch {
    return null;
  }
}

export async function writeCachedPlaces(userId: string, places: CachedPlace[]): Promise<void> {
  if (!userId) return;
  const payload: CachedPlacesPayload = {
    userId,
    places: places.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      category: p.category,
      ...(isFiniteNumber(p.lat) && isFiniteNumber(p.lng) ? { lat: p.lat, lng: p.lng } : {}),
      ...(typeof p.created_at === "string" && p.created_at.trim()
        ? { created_at: p.created_at.trim() }
        : {}),
    })),
  };
  await prefsSet(CACHE_PLACES_KEY, JSON.stringify(payload));
}

export async function readCachedMapView(): Promise<CachedMapView | null> {
  const raw = await prefsGet(CACHE_MAPVIEW_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (!isFiniteNumber(o.lat) || !isFiniteNumber(o.lng) || !isFiniteNumber(o.level)) return null;
    if (o.level < 1 || o.level > 14) return null;
    return { lat: o.lat, lng: o.lng, level: o.level };
  } catch {
    return null;
  }
}

export async function writeCachedMapView(view: CachedMapView): Promise<void> {
  if (!isFiniteNumber(view.lat) || !isFiniteNumber(view.lng) || !isFiniteNumber(view.level)) return;
  await prefsSet(CACHE_MAPVIEW_KEY, JSON.stringify(view));
}

export async function clearHomeBootstrapCache(): Promise<void> {
  await Promise.all([prefsRemove(CACHE_PLACES_KEY), prefsRemove(CACHE_MAPVIEW_KEY)]);
}

/** 동일 스냅샷이면 setState 스킵용 */
export function placesCacheFingerprint(places: ReadonlyArray<CachedPlace>): string {
  return places
    .map(
      (p) =>
        `${p.id}\t${p.name}\t${p.address}\t${p.category}\t${p.lat ?? ""}\t${p.lng ?? ""}\t${p.created_at ?? ""}`,
    )
    .sort()
    .join("\n");
}

export function placesAreEqual(
  a: ReadonlyArray<CachedPlace>,
  b: ReadonlyArray<CachedPlace>,
): boolean {
  if (a.length !== b.length) return false;
  return placesCacheFingerprint(a) === placesCacheFingerprint(b);
}
