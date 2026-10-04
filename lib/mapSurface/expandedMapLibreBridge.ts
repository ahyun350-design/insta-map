"use client";

import type { ExpandedMapSurface, MapLatLng } from "./types";
import { ExpandedMapLibreAdapter } from "./ExpandedMapLibreAdapter";

export const EXPANDED_MAPLIBRE_BRAND = "__pindmapExpandedMapLibre" as const;

export type ExpandedMapLibreShim = {
  [EXPANDED_MAPLIBRE_BRAND]: true;
  provider: "maplibre";
  adapter: ExpandedMapSurface;
  setCenter: (latlng: { getLat: () => number; getLng: () => number }) => void;
  panTo: (latlng: { getLat: () => number; getLng: () => number }) => void;
  setLevel: (level: number) => void;
  getLevel: () => number;
  getCenter: () => { getLat: () => number; getLng: () => number };
  getBounds: () => {
    getSouthWest: () => { getLat: () => number; getLng: () => number };
    getNorthEast: () => { getLat: () => number; getLng: () => number };
  };
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
  getProjection: () => {
    coordsFromContainerPoint: (point: {
      x: number;
      y: number;
    }) => { getLat: () => number; getLng: () => number } | null;
    containerPointFromCoords: (latlng: {
      getLat: () => number;
      getLng: () => number;
    }) => { x: number; y: number } | null;
  };
  getNode: () => HTMLElement | null;
  relayout: () => void;
  setMapTypeId?: (id: unknown) => void;
};

export function isExpandedMapLibre(map: unknown): map is ExpandedMapLibreShim {
  return Boolean(
    map &&
      typeof map === "object" &&
      (map as ExpandedMapLibreShim)[EXPANDED_MAPLIBRE_BRAND] === true,
  );
}

export function getExpandedMapLibreAdapter(
  map: unknown,
): ExpandedMapSurface | null {
  return isExpandedMapLibre(map) ? map.adapter : null;
}

export function createExpandedMapLibreShim(
  adapter: ExpandedMapSurface,
  container: HTMLElement,
): ExpandedMapLibreShim {
  return {
    [EXPANDED_MAPLIBRE_BRAND]: true,
    provider: "maplibre",
    adapter,
    setCenter(latlng) {
      adapter.setCenter(latlng.getLat(), latlng.getLng());
    },
    panTo(latlng) {
      adapter.panTo(latlng.getLat(), latlng.getLng());
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
    getBounds() {
      const b = adapter.getBounds();
      const sw = b?.getSouthWest() ?? { lat: 33.0, lng: 124.5 };
      const ne = b?.getNorthEast() ?? { lat: 39.0, lng: 132.0 };
      return {
        getSouthWest: () => ({ getLat: () => sw.lat, getLng: () => sw.lng }),
        getNorthEast: () => ({ getLat: () => ne.lat, getLng: () => ne.lng }),
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
    getProjection() {
      return {
        coordsFromContainerPoint(point) {
          const ll = adapter.unproject(point.x, point.y);
          if (!ll) return null;
          return { getLat: () => ll.lat, getLng: () => ll.lng };
        },
        containerPointFromCoords(latlng) {
          return adapter.project(latlng.getLat(), latlng.getLng());
        },
      };
    },
    getNode() {
      return container;
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
export { ExpandedMapLibreAdapter };
