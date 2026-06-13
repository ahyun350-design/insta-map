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
  category?: string;
}

export interface AddMarkersOptions {
  markers: MarkerInput[];
}

export interface RemoveMarkersOptions {
  ids: string[];
}

export interface MarkerClickEvent {
  id: string;
}

export interface PindmapNativeMapPlugin {
  createMap(options: CreateMapOptions): Promise<{ mapId: string }>;
  destroyMap(): Promise<void>;
  setCamera(options: SetCameraOptions): Promise<void>;
  /** Debug: returns native frame applied to map view */
  getDebugInfo(): Promise<{ provider: string; frame: string }>;
  addMarkers(options: AddMarkersOptions): Promise<{ added: number }>;
  removeMarkers(options: RemoveMarkersOptions): Promise<void>;
  clearMarkers(): Promise<void>;
  addListener(
    eventName: 'markerClick',
    listenerFunc: (event: MarkerClickEvent) => void,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}
