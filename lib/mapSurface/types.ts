export type MapLatLng = { lat: number; lng: number };

export type CompactPinInput = {
  id: string;
  lat: number;
  lng: number;
  category: string;
  /** Resolved fill hex (category or list color) */
  fillColor: string;
  name?: string;
  /** First related post image — admin MapLibre photo pin (expanded z≥14) */
  photoUrl?: string | null;
  /** Related curation count — badge when > 0 */
  postCount?: number;
  /** Admin MapLibre: dim pin when poi.closed_at is set (~45% opacity) */
  closed?: boolean;
};

export type CompactRouteMode = "car" | "walk" | "course" | "preview";

export type SearchPinInput = {
  id: string;
  lat: number;
  lng: number;
};

/** Admin MapLibre "발견" layer (place_popularity). */
export type DiscoverPinInput = {
  poiId: number;
  lat: number;
  lng: number;
  name: string;
  userCount: number;
  category?: string | null;
};

export type CourseStopInput = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  order: number;
  category?: string;
  fillColor?: string;
};

export type SetCourseStopsOptions = {
  /** Highlight current nav step (32px); others 26px. */
  selectedOrder?: number | null;
};

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
  /**
   * Highlight the open place-sheet pin (~1.3×, above others).
   * No-op while clustered (MapLibre zoom &lt; 10).
   */
  setSelectedPinId: (pinId: string | null) => void;
  /** Smooth camera to lat/lng at Kakao-equivalent level (expanded locate button). */
  easeToView: (lat: number, lng: number, kakaoLevel: number) => void;
  destroy: () => void;
};

/** Fullscreen admin MapLibre surface (extends compact + search/course/camera). */
export type ExpandedMapSurface = CompactMapSurface & {
  panTo: (lat: number, lng: number) => void;
  getBounds: () => {
    getSouthWest: () => MapLatLng;
    getNorthEast: () => MapLatLng;
  } | null;
  project: (lat: number, lng: number) => { x: number; y: number } | null;
  unproject: (x: number, y: number) => MapLatLng | null;
  setSearchPins: (pins: SearchPinInput[]) => void;
  clearSearchPins: () => void;
  /** Admin discover layer (WebGL). Empty / missing data → clear. */
  setDiscoverPins: (pins: DiscoverPinInput[]) => void;
  clearDiscoverPins: () => void;
  setCourseStops: (
    stops: CourseStopInput[],
    opts?: SetCourseStopsOptions,
  ) => void;
  clearCourseStops: () => void;
  /** @deprecated prefer setRoute(mode) — kept for rare overrides */
  setRouteStyle: (opts: {
    color?: string;
    width?: number;
    dasharray?: number[];
    opacity?: number;
  }) => void;
  /**
   * Admin directions chrome: paint-only basemap, hide pins, endpoint circles,
   * distance bubble. No-op on compact.
   */
  setDirectionsChrome: (opts: {
    active: boolean;
    routeTheme?: "dark" | "paper";
    path?: MapLatLng[];
    mode?: CompactRouteMode;
    distanceKm?: number | null;
    restoreCamera?: boolean;
  }) => void;
};

/** Alias — compact MapLibre surface for admin minimap. */
export type MapSurface = CompactMapSurface;
