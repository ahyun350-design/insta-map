export type MapLatLng = { lat: number; lng: number };

export type CompactPinInput = {
  id: string;
  lat: number;
  lng: number;
  category: string;
  /** Resolved fill hex (category or list color) */
  fillColor: string;
  name?: string;
};

export type CompactRouteMode = "car" | "walk";

/**
 * Minimal surface used by the admin compact MapLibre path.
 * Kakao remains the production default; this is not a full dual-stack adapter yet.
 */
export type CompactMapSurface = {
  readonly provider: "maplibre";
  resize: () => void;
  setCenter: (lat: number, lng: number) => void;
  setLevel: (kakaoLevel: number) => void;
  getLevel: () => number;
  getCenter: () => MapLatLng;
  fitPoints: (
    points: MapLatLng[],
    padding?: { top: number; right: number; bottom: number; left: number },
  ) => void;
  /** Id-diff pin sync (cluster off). */
  setPins: (pins: CompactPinInput[]) => void;
  setMyLocation: (lat: number, lng: number) => void;
  clearMyLocation: () => void;
  setRoute: (path: MapLatLng[], mode: CompactRouteMode) => void;
  clearRoute: () => void;
  setFocusMarker: (pin: CompactPinInput) => void;
  clearFocusMarker: () => void;
  destroy: () => void;
};

/** Alias — compact MapLibre surface for admin minimap. */
export type MapSurface = CompactMapSurface;
