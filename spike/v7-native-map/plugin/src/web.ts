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
  FullscreenPlaceDetailEvent,
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

  async setFullscreenCourseNavigation(_options: import('./definitions').SetFullscreenCourseNavigationOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — setFullscreenCourseNavigation noop (iOS only)');
  }

  async clearFullscreenCourseNavigation(): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — clearFullscreenCourseNavigation noop (iOS only)');
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

  async setFullscreenPlaceSaved(_options: import('./definitions').SetFullscreenPlaceSavedOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — setFullscreenPlaceSaved noop (iOS only)');
  }

  async setFullscreenDirectionsInfo(_options: import('./definitions').SetFullscreenDirectionsInfoOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — setFullscreenDirectionsInfo noop (iOS only)');
  }

  async showFullscreenPlaceSheet(_options: import('./definitions').ShowFullscreenPlaceSheetOptions): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — showFullscreenPlaceSheet noop (iOS only)');
  }

  addListener(
    eventName:
      | 'markerClick'
      | 'fullscreenSearch'
      | 'fullscreenMapDismissed'
      | 'fullscreenDirections'
      | 'fullscreenResearchArea'
      | 'fullscreenPlaceDetail'
      | 'fullscreenToggleSave'
      | 'fullscreenCuration'
      | 'fullscreenOpenExternal'
      | 'fullscreenImageLightbox',
    listenerFunc:
      | ((event: import('./definitions').MarkerClickEvent) => void)
      | ((event: import('./definitions').FullscreenSearchEvent) => void)
      | ((event: import('./definitions').FullscreenMapDismissedEvent) => void)
      | ((event: import('./definitions').FullscreenDirectionsEvent) => void)
      | ((event: import('./definitions').FullscreenResearchAreaEvent) => void)
      | ((event: import('./definitions').FullscreenPlaceDetailEvent) => void)
      | ((event: import('./definitions').FullscreenToggleSaveEvent) => void)
      | ((event: import('./definitions').FullscreenCurationEvent) => void)
      | ((event: import('./definitions').FullscreenOpenExternalEvent) => void)
      | ((event: import('./definitions').FullscreenImageLightboxEvent) => void),
  ): Promise<PluginListenerHandle> & PluginListenerHandle {
    return super.addListener(eventName, listenerFunc) as Promise<PluginListenerHandle> & PluginListenerHandle;
  }
}
