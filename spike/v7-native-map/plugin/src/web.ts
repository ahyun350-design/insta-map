import { WebPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type {
  AddMarkersOptions,
  CreateMapOptions,
  MarkerClickEvent,
  PindmapNativeMapPlugin,
  RemoveMarkersOptions,
  SetCameraOptions,
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

  async clearMarkers(): Promise<void> {
    console.warn('[PindmapNativeMap] web stub — clearMarkers noop');
  }

  addListener(
    eventName: 'markerClick',
    listenerFunc: (event: MarkerClickEvent) => void,
  ): Promise<PluginListenerHandle> & PluginListenerHandle {
    return super.addListener(eventName, listenerFunc) as Promise<PluginListenerHandle> & PluginListenerHandle;
  }
}
