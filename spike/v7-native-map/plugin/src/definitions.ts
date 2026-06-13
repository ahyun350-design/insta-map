import type { PluginListenerHandle } from '@capacitor/core';

export type NativeMapProvider = 'mapkit' | 'kakao';

export interface CreateMapOptions {
  /** DOM element id (must exist in WebView) */
  elementId: string;
  lat: number;
  lng: number;
  /** Kakao: map level (3–14). MapKit: converted to span. Default 9 */
  zoom?: number;
  provider?: NativeMapProvider;
}

export interface SetCameraOptions {
  lat: number;
  lng: number;
  zoom?: number;
  animated?: boolean;
}

export interface MarkerInput {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  address?: string;
  category?: string;
}

export interface AddMarkersOptions {
  markers: MarkerInput[];
}

export interface RemoveMarkersOptions {
  ids: string[];
}

export interface ClearMarkersOptions {
  prefix?: string;
}

export interface MarkerClickEvent {
  id: string;
}

export interface FullscreenSearchEvent {
  query: string;
}

export interface FullscreenMapDismissedEvent {
  /** Reserved for future dismiss reason */
  reason?: string;
}

export interface FullscreenDirectionsEvent {
  id: string;
  lat: number;
  lng: number;
}

export interface PresentFullscreenMapOptions {
  lat: number;
  lng: number;
  zoom?: number;
  markers?: MarkerInput[];
}

export interface UpdateFullscreenMarkersOptions {
  markers: MarkerInput[];
  clearPrefix?: string;
}

export interface SetFullscreenCameraOptions {
  lat: number;
  lng: number;
  zoom?: number;
  animated?: boolean;
}

export interface LatLngInput {
  lat: number;
  lng: number;
}

export type FullscreenRouteMode = 'car' | 'walk';

export interface SetFullscreenRouteOptions {
  path: LatLngInput[];
  mode?: FullscreenRouteMode;
}

export interface SetFullscreenMyLocationOptions {
  lat: number;
  lng: number;
}

export interface FullscreenSearchResultInput {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category?: string;
}

export interface SetFullscreenSearchResultsOptions {
  results: FullscreenSearchResultInput[];
}

export interface PindmapNativeMapPlugin {
  createMap(options: CreateMapOptions): Promise<{ mapId: string }>;
  destroyMap(): Promise<void>;
  setCamera(options: SetCameraOptions): Promise<void>;
  /** Debug: returns native frame applied to map view */
  getDebugInfo(): Promise<{ provider: string; frame: string }>;
  addMarkers(options: AddMarkersOptions): Promise<{ added: number }>;
  removeMarkers(options: RemoveMarkersOptions): Promise<void>;
  clearMarkers(options?: ClearMarkersOptions): Promise<void>;
  addListener(
    eventName: 'markerClick',
    listenerFunc: (event: MarkerClickEvent) => void,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addListener(
    eventName: 'fullscreenSearch',
    listenerFunc: (event: FullscreenSearchEvent) => void,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addListener(
    eventName: 'fullscreenMapDismissed',
    listenerFunc: (event: FullscreenMapDismissedEvent) => void,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addListener(
    eventName: 'fullscreenDirections',
    listenerFunc: (event: FullscreenDirectionsEvent) => void,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  /** V-7-2 prototype: modal full-screen map with normal VC lifecycle (overlay-independent) */
  presentNativeMapTest(): Promise<void>;
  /** V-7-2 production: full-screen native map VC (verified lifecycle path) */
  presentFullscreenMap(options: PresentFullscreenMapOptions): Promise<void>;
  dismissFullscreenMap(): Promise<void>;
  updateFullscreenMarkers(options: UpdateFullscreenMarkersOptions): Promise<void>;
  setFullscreenCamera(options: SetFullscreenCameraOptions): Promise<void>;
  setFullscreenRoute(options: SetFullscreenRouteOptions): Promise<void>;
  clearFullscreenRoute(): Promise<void>;
  setFullscreenMyLocation(options: SetFullscreenMyLocationOptions): Promise<void>;
  clearFullscreenMyLocation(): Promise<void>;
  setFullscreenSearchResults(options: SetFullscreenSearchResultsOptions): Promise<void>;
  clearFullscreenSearchResults(): Promise<void>;
}
