"use client";

import { MapLibreMapAdapter } from "./MapLibreMapAdapter";
import type { CompactMapSurface, MapLatLng } from "./types";

export const COMPACT_MAPLIBRE_BRAND = "__pindmapCompactMapLibre" as const;

export type CompactMapLibreShim = {
  [COMPACT_MAPLIBRE_BRAND]: true;
  provider: "maplibre";
  adapter: CompactMapSurface;
  setCenter: (latlng: { getLat: () => number; getLng: () => number }) => void;
  setLevel: (level: number) => void;
  getLevel: () => number;
  getCenter: () => { getLat: () => number; getLng: () => number };
  setBounds: (
    bounds: {
      getSouthWest: () => { getLat: () => number; getLng: () => number };
      getNorthEast: () => { getLat: () => number; getLng: () => number };
    },
    top?: number,
    right?: number,
    bottom?: number,
    left?: number,
  ) => void;
  relayout: () => void;
  setMapTypeId?: (id: unknown) => void;
};

export function isCompactMapLibre(map: unknown): map is CompactMapLibreShim {
  return Boolean(
    map &&
      typeof map === "object" &&
      (map as CompactMapLibreShim)[COMPACT_MAPLIBRE_BRAND] === true,
  );
}

export function getCompactMapLibreAdapter(
  map: unknown,
): CompactMapSurface | null {
  return isCompactMapLibre(map) ? map.adapter : null;
}

export function createCompactMapLibreShim(
  adapter: CompactMapSurface,
): CompactMapLibreShim {
  return {
    [COMPACT_MAPLIBRE_BRAND]: true,
    provider: "maplibre",
    adapter,
    setCenter(latlng) {
      adapter.setCenter(latlng.getLat(), latlng.getLng());
    },
    setLevel(level) {
      adapter.setLevel(level);
    },
    getLevel() {
      return adapter.getLevel();
    },
    getCenter() {
      const c = adapter.getCenter();
      return {
        getLat: () => c.lat,
        getLng: () => c.lng,
      };
    },
    setBounds(bounds, top = 48, right = 36, bottom = 300, left = 36) {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      adapter.fitPoints(
        [
          { lat: sw.getLat(), lng: sw.getLng() },
          { lat: ne.getLat(), lng: ne.getLng() },
        ],
        { top, right, bottom, left },
      );
    },
    relayout() {
      adapter.resize();
    },
    setMapTypeId() {
      /* no-op for MapLibre */
    },
  };
}

export type { MapLatLng };
export { MapLibreMapAdapter };
