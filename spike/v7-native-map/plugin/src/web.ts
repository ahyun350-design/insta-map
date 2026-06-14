import { WebPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type {
  AddMarkersOptions,
  ClearMarkersOptions,
  CreateMapOptions,
  MarkerClickEvent,
  FullscreenSearchEvent,
  FullscreenMapDismissedEvent,
  FullscreenDirectionsEvent,
  FullscreenResearchAreaEvent,
  PindmapNativeMapPlugin,
  PresentFullscreenMapOptions,
  RemoveMarkersOptions,
  SetCameraOptions,
  SetFullscreenCameraOptions,
  SetFullscreenRouteOptions,
  SetFullscreenMyLocationOptions,
  SetFullscreenSearchResultsOptions,
  UpdateFullscreenMarkersOptions,
} from './definitions';

/** Web fallback — spike UI only; production map stays Kakao JS API */
/** addListener('markerClick') inherited from WebPlugin — no native events on web */
export class PindmapNativeMapWeb extends WebPlugin implements PindmapNativeMapPlugin {
  async createMap(options: CreateMapOptions): Promise<{ mapId: string }> {
    console.warn('[PindmapNativeMap] web stub — native iOS only', options);
    return { mapId: 'web-stub' };
  }

  async destroyMap(): Promise<void> {
    /* noop */
  }

  async setCamera(_options: SetCameraOptions): Promise<void> {
    /* noop */
  }

  async getDebugInfo(): Promise<{ provider: string; frame: string }> {
    return { provider: 'web-stub', frame: 'n/a' };
  }

  async addMarkers(_options: AddMarkersOptions): Promise<{ added: number }> {
    console.warn('[PindmapNativeMap] web stub — addMarkers noop');
    return { added: 0 };
  }

  async removeMarkers(_options: RemoveMarkersOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — removeMarkers noop');
  }

  async clearMarkers(_options?: ClearMarkersOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — clearMarkers noop');
  }

  async presentNativeMapTest(): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — presentNativeMapTest noop (iOS only)');
  }

  async presentFullscreenMap(_options: PresentFullscreenMapOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — presentFullscreenMap noop (iOS only)');
  }

  async dismissFullscreenMap(): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — dismissFullscreenMap noop (iOS only)');
  }

  async updateFullscreenMarkers(_options: UpdateFullscreenMarkersOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — updateFullscreenMarkers noop (iOS only)');
  }

  async setFullscreenCamera(_options: SetFullscreenCameraOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — setFullscreenCamera noop (iOS only)');
  }

  async setFullscreenRoute(_options: SetFullscreenRouteOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — setFullscreenRoute noop (iOS only)');
  }

  async clearFullscreenRoute(): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — clearFullscreenRoute noop (iOS only)');
  }

  async setFullscreenMyLocation(_options: SetFullscreenMyLocationOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — setFullscreenMyLocation noop (iOS only)');
  }

  async clearFullscreenMyLocation(): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — clearFullscreenMyLocation noop (iOS only)');
  }

  async setFullscreenSearchResults(_options: SetFullscreenSearchResultsOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — setFullscreenSearchResults noop (iOS only)');
  }

  async clearFullscreenSearchResults(): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — clearFullscreenSearchResults noop (iOS only)');
  }

  addListener(
    eventName: 'markerClick' | 'fullscreenSearch' | 'fullscreenMapDismissed' | 'fullscreenDirections' | 'fullscreenResearchArea',
    listenerFunc:
      | ((event: MarkerClickEvent) => void)
      | ((event: FullscreenSearchEvent) => void)
      | ((event: FullscreenMapDismissedEvent) => void)
      | ((event: FullscreenDirectionsEvent) => void)
      | ((event: FullscreenResearchAreaEvent) => void),
  ): Promise<PluginListenerHandle> & PluginListenerHandle {
    return super.addListener(eventName, listenerFunc) as Promise<PluginListenerHandle> & PluginListenerHandle;
  }
}
