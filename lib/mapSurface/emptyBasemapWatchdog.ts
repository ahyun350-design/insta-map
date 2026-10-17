/**
 * Safety net: if the viewport paints zero basemap features for ≥3s,
 * soft-fail self-tiles → OFM and force a tile refresh (camera kept).
 * Never leaves the user on a permanently blank grey map.
 */

import {
  applyOfmPlanetTilesToMap,
  breakSelfTilesToOfmSession,
  isSelfTilesBroken,
  readSelfTilesEnabled,
} from "./selfTiles";

const POLL_MS = 1000;
/** Ignore emptiness while PMTiles Range + first paint settle. */
const WARMUP_MS = 8000;
const EMPTY_STREAK_REQUIRED = 4;

/** Overlay / app GeoJSON sources — not basemap. */
const NON_BASEMAP_SOURCE_RE =
  /compact-|korea_|pindmap_|subway|landmark|gu_label|dong|station_label|major_label|places_extra|apt_complex|named_building|sangga/i;

type WatchMap = {
  getStyle: () => {
    layers?: { id: string; type?: string; source?: string }[];
  };
  getLayer: (id: string) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryRenderedFeatures: (...args: any[]) => unknown[];
  triggerRepaint?: () => void;
  getSource: (id: string) => unknown;
  getCenter: () => { lat: number; lng: number };
  getZoom: () => number;
  jumpTo?: (o: { center: [number, number]; zoom: number }) => void;
  isStyleLoaded?: () => boolean | void;
};

function basemapLayerIds(map: WatchMap): string[] {
  const layers = map.getStyle()?.layers ?? [];
  return layers
    .filter((l) => {
      if (!l.id || !l.source) return false;
      if (l.source !== "openmaptiles") return false;
      if (NON_BASEMAP_SOURCE_RE.test(l.id)) return false;
      return l.type === "fill" || l.type === "line" || l.type === "symbol";
    })
    .map((l) => l.id)
    .filter((id) => !!map.getLayer(id));
}

function countBasemapFeatures(map: WatchMap): number {
  const ids = basemapLayerIds(map);
  if (ids.length === 0) return -1; // style not ready
  try {
    return map.queryRenderedFeatures(undefined, { layers: ids }).length;
  } catch {
    return -1;
  }
}

/**
 * Start polling. Returns a disposer.
 * Fires at most once per map instance (session soft-fail is sticky).
 */
export function attachEmptyBasemapWatchdog(
  map: WatchMap,
  surface: "compact" | "expanded" = "expanded",
): () => void {
  let emptyStreak = 0;
  let fired = false;
  let stopped = false;
  const startedAt = Date.now();

  const tick = () => {
    if (stopped || fired) return;
    if (Date.now() - startedAt < WARMUP_MS) {
      emptyStreak = 0;
      return;
    }
    if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) {
      emptyStreak = 0;
      return;
    }
    const n = countBasemapFeatures(map);
    if (n < 0) {
      emptyStreak = 0;
      return;
    }
    if (n > 0) {
      emptyStreak = 0;
      return;
    }
    emptyStreak += 1;
    if (emptyStreak < EMPTY_STREAK_REQUIRED) return;
    fired = true;
    void recoverFromEmptyBasemap(map, surface);
  };

  const id = window.setInterval(tick, POLL_MS);
  // First check after one interval so style/tiles have a chance.
  return () => {
    stopped = true;
    window.clearInterval(id);
  };
}

async function recoverFromEmptyBasemap(
  map: WatchMap,
  surface: "compact" | "expanded",
): Promise<void> {
  try {
    if (readSelfTilesEnabled() && !isSelfTilesBroken()) {
      breakSelfTilesToOfmSession(surface);
    }
    await applyOfmPlanetTilesToMap(map);
    // Nudge MapLibre to re-request tiles without changing camera.
    const c = map.getCenter();
    const z = map.getZoom();
    if (typeof map.jumpTo === "function") {
      map.jumpTo({ center: [c.lng, c.lat], zoom: z });
    } else {
      map.triggerRepaint?.();
    }
  } catch {
    /* keep polling disabled; next remount will re-attach */
  }
}
