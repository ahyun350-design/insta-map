import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type WalkCachedRoute = {
  path: Array<{ lat: number; lng: number }>;
  distanceM: number;
  timeSec: number;
  expiresAtMs: number;
};

export type WalkCacheSource = "l1" | "l2" | "tmap";

const WALK_MODE = "walk";
const L1_MAX = 1000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Module-scope LRU (Map insertion order). */
const l1Cache = new Map<string, WalkCachedRoute>();

function roundCoord(n: number): string {
  return n.toFixed(5);
}

export function walkRouteCacheKey(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: string = WALK_MODE,
): string {
  return [
    mode,
    `${roundCoord(origin.lat)},${roundCoord(origin.lng)}`,
    `${roundCoord(destination.lat)},${roundCoord(destination.lng)}`,
  ].join("|");
}

function isFresh(entry: WalkCachedRoute, now = Date.now()): boolean {
  return entry.expiresAtMs > now;
}

export function l1Get(key: string): WalkCachedRoute | null {
  const hit = l1Cache.get(key);
  if (!hit) return null;
  if (!isFresh(hit)) {
    l1Cache.delete(key);
    return null;
  }
  // LRU touch
  l1Cache.delete(key);
  l1Cache.set(key, hit);
  return hit;
}

export function l1Set(key: string, entry: WalkCachedRoute): void {
  if (l1Cache.has(key)) l1Cache.delete(key);
  l1Cache.set(key, entry);
  while (l1Cache.size > L1_MAX) {
    const oldest = l1Cache.keys().next().value;
    if (oldest === undefined) break;
    l1Cache.delete(oldest);
  }
}

/** Test/ops: clear in-process L1 (does not touch Supabase). */
export function l1Clear(): void {
  l1Cache.clear();
}

type L2Row = {
  cache_key: string;
  path: unknown;
  distance_m: number;
  time_sec: number;
  expires_at: string;
};

function parsePath(raw: unknown): Array<{ lat: number; lng: number }> | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const path: Array<{ lat: number; lng: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const lat = Number((item as { lat?: unknown }).lat);
    const lng = Number((item as { lng?: unknown }).lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    path.push({ lat, lng });
  }
  return path.length >= 2 ? path : null;
}

function rowToEntry(row: L2Row): WalkCachedRoute | null {
  const path = parsePath(row.path);
  if (!path) return null;
  const distanceM = Number(row.distance_m);
  const timeSec = Number(row.time_sec);
  const expiresAtMs = Date.parse(row.expires_at);
  if (!Number.isFinite(distanceM) || distanceM < 0) return null;
  if (!Number.isFinite(timeSec) || timeSec < 0) return null;
  if (!Number.isFinite(expiresAtMs)) return null;
  if (expiresAtMs <= Date.now()) return null;
  return {
    path,
    distanceM: Math.round(distanceM),
    timeSec: Math.round(timeSec),
    expiresAtMs,
  };
}

/** One IN query for all keys. Missing/expired keys omitted. */
export async function l2GetMany(keys: string[]): Promise<Map<string, WalkCachedRoute>> {
  const out = new Map<string, WalkCachedRoute>();
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return out;

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("walk_route_cache")
      .select("cache_key, path, distance_m, time_sec, expires_at")
      .in("cache_key", unique)
      .gt("expires_at", new Date().toISOString());

    if (error) {
      console.error("[walk-cache] l2 get failed", error.message);
      return out;
    }

    for (const row of (data ?? []) as L2Row[]) {
      const entry = rowToEntry(row);
      if (!entry) continue;
      out.set(row.cache_key, entry);
      l1Set(row.cache_key, entry);
    }
  } catch (err) {
    console.error("[walk-cache] l2 get exception", err);
  }
  return out;
}

/** Fire-and-forget upsert — never await from request path. */
export function l2WriteMany(
  entries: Array<{ key: string; route: WalkCachedRoute }>,
): void {
  if (entries.length === 0) return;
  const now = Date.now();
  const rows = entries.map(({ key, route }) => ({
    cache_key: key,
    path: route.path,
    distance_m: route.distanceM,
    time_sec: route.timeSec,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(route.expiresAtMs).toISOString(),
  }));

  void (async () => {
    try {
      const admin = getSupabaseAdmin();
      const { error } = await admin.from("walk_route_cache").upsert(rows, {
        onConflict: "cache_key",
      });
      if (error) console.error("[walk-cache] l2 write failed", error.message);
    } catch (err) {
      console.error("[walk-cache] l2 write exception", err);
    }
  })();
}

export function makeCachedRoute(
  path: Array<{ lat: number; lng: number }>,
  distanceM: number,
  timeSec: number,
): WalkCachedRoute {
  return {
    path,
    distanceM: Math.round(distanceM),
    timeSec: Math.round(timeSec),
    expiresAtMs: Date.now() + TTL_MS,
  };
}

type TmapFeature = {
  geometry?: { type?: string; coordinates?: number[] | number[][] };
  properties?: {
    totalDistance?: number;
    totalTime?: number;
    distance?: number;
    time?: number;
  };
};

type TmapGeoJson = {
  properties?: { totalDistance?: number; totalTime?: number };
  features?: TmapFeature[];
};

/** Extract path + totals only — never store raw Tmap payload. */
export function extractRouteFromTmapGeoJson(
  data: unknown,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): WalkCachedRoute | null {
  if (!data || typeof data !== "object") return null;
  const geo = data as TmapGeoJson;
  const path: Array<{ lat: number; lng: number }> = [];
  for (const feature of geo.features ?? []) {
    if (feature.geometry?.type !== "LineString") continue;
    const coords = feature.geometry.coordinates;
    if (!Array.isArray(coords)) continue;
    for (const coord of coords as number[][]) {
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) path.push({ lat, lng });
    }
  }
  if (path.length < 2) {
    path.length = 0;
    path.push(origin, destination);
  }

  let distanceM: number | null = null;
  let timeSec: number | null = null;
  for (const feature of geo.features ?? []) {
    if (feature.geometry?.type !== "Point") continue;
    const d = Number(feature.properties?.totalDistance);
    const t = Number(feature.properties?.totalTime);
    if (Number.isFinite(d) && d > 0) distanceM = Math.round(d);
    if (Number.isFinite(t) && t > 0) timeSec = Math.round(t);
    if (distanceM != null || timeSec != null) break;
  }
  if (distanceM == null) {
    const topD = Number(geo.properties?.totalDistance);
    if (Number.isFinite(topD) && topD > 0) distanceM = Math.round(topD);
  }
  if (timeSec == null) {
    const topT = Number(geo.properties?.totalTime);
    if (Number.isFinite(topT) && topT > 0) timeSec = Math.round(topT);
  }
  if (distanceM == null || distanceM <= 0) return null;
  if (timeSec == null || timeSec <= 0) {
    timeSec = Math.max(60, Math.round(distanceM / 1.4));
  }
  return makeCachedRoute(path, distanceM, timeSec);
}

/** Minimal GeoJSON so existing clients keep parsing path + totals. */
export function cachedRouteToGeoJson(route: WalkCachedRoute): Record<string, unknown> {
  const start = route.path[0]!;
  const end = route.path[route.path.length - 1]!;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [start.lng, start.lat] },
        properties: {
          pointType: "SP",
          description: "출발",
          totalDistance: route.distanceM,
          totalTime: route.timeSec,
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: route.path.map((p) => [p.lng, p.lat]),
        },
        properties: {
          distance: route.distanceM,
          time: route.timeSec,
        },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [end.lng, end.lat] },
        properties: {
          pointType: "EP",
          description: "도착",
        },
      },
    ],
  };
}

export function rememberRoute(key: string, route: WalkCachedRoute): void {
  l1Set(key, route);
  l2WriteMany([{ key, route }]);
}
