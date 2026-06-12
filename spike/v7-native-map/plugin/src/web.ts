import { WebPlugin } from '@capacitor/core';
import type {
  CreateMapOptions,
  PindmapNativeMapPlugin,
  SetCameraOptions,
} from './definitions';

/** Web fallback — spike UI only; production map stays Kakao JS API */
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
}
