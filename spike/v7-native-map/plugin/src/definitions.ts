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

export interface PindmapNativeMapPlugin {
  createMap(options: CreateMapOptions): Promise<{ mapId: string }>;
  destroyMap(): Promise<void>;
  setCamera(options: SetCameraOptions): Promise<void>;
  /** Debug: returns native frame applied to map view */
  getDebugInfo(): Promise<{ provider: string; frame: string }>;
}
