import { registerPlugin } from '@capacitor/core';
import type { PindmapNativeMapPlugin } from './definitions';

export * from './definitions';

export const PindmapNativeMap = registerPlugin<PindmapNativeMapPlugin>('PindmapNativeMap', {
  web: () => import('./web').then((m) => new m.PindmapNativeMapWeb()),
});
