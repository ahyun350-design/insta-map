import { Capacitor } from "@capacitor/core";
import { PindmapNativeMap } from "@pindmap/native-map";
import type {
  CreateMapOptions,
  NativeMapProvider,
  PindmapNativeMapPlugin,
  SetCameraOptions,
} from "@pindmap/native-map";

/** Re-export plugin types for Step 3 consumers */
export type { NativeMapProvider, CreateMapOptions, SetCameraOptions };

export type CreateNativeMapOptions = {
  elementId: string;
  lat: number;
  lng: number;
  zoom?: number;
  /** Default: `kakao` */
  provider?: NativeMapProvider;
};

export type SetNativeCameraOptions = {
  lat: number;
  lng: number;
  zoom?: number;
  animated?: boolean;
};

export type NativeCameraIdlePayload = {
  lat: number;
  lng: number;
  zoom: number;
};

export type NativeMapCallOptions = {
  /**
   * When true (default), failures resolve with no-op results instead of rejecting.
   * When false, errors propagate via Promise rejection.
   */
  silent?: boolean;
};

export type NativeMapDebugInfo = {
  provider: string;
  frame: string;
};

const DEFAULT_PROVIDER: NativeMapProvider = "kakao";
const UNAVAILABLE_MAP_ID = "unavailable";

let debugLogging = false;
let activeMapId: string | null = null;

type PluginResolver = () => PindmapNativeMapPlugin;
let pluginResolver: PluginResolver = () => PindmapNativeMap;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function isDevBuild(): boolean {
  return process.env.NODE_ENV === "development";
}

function shouldLog(): boolean {
  return isDevBuild() || debugLogging;
}

function nativeMapLog(message: string, detail?: unknown): void {
  if (!shouldLog()) return;
  if (detail !== undefined) {
    console.log(`[nativeMap] ${message}`, detail);
  } else {
    console.log(`[nativeMap] ${message}`);
  }
}

function nativeMapWarn(message: string, detail?: unknown): void {
  if (!shouldLog()) return;
  if (detail !== undefined) {
    console.warn(`[nativeMap] ${message}`, detail);
  } else {
    console.warn(`[nativeMap] ${message}`);
  }
}

function getPlugin(): PindmapNativeMapPlugin {
  return pluginResolver();
}

function unavailableResult<T>(silent: boolean, fallback: T, reason: string): T | Promise<T> {
  nativeMapLog(reason);
  if (silent) return fallback;
  return Promise.reject(new Error(reason));
}

/**
 * Enable verbose native-map logs outside development (e.g. Safari Web Inspector).
 */
export function setNativeMapDebug(enabled: boolean): void {
  debugLogging = enabled;
}

/**
 * Test hook — inject a mock plugin without loading Capacitor native bindings.
 */
export function __setNativeMapPluginResolverForTests(resolver: PluginResolver | null): void {
  pluginResolver = resolver ?? (() => PindmapNativeMap);
}

/**
 * iOS Capacitor app with PindmapNativeMap plugin linked.
 * False on web, SSR, and non-iOS native shells.
 */
export function isNativeMapAvailable(): boolean {
  if (!isBrowser()) return false;
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

/**
 * Create a native map view behind the WebView at the given DOM element slot.
 * No-op on web / SSR when `silent` is true (default).
 */
export async function createNativeMap(
  options: CreateNativeMapOptions,
  callOptions: NativeMapCallOptions = {},
): Promise<{ mapId: string }> {
  const silent = callOptions.silent ?? true;

  if (!isNativeMapAvailable()) {
    const result = unavailableResult(silent, { mapId: UNAVAILABLE_MAP_ID }, "createNativeMap skipped — not iOS native");
    return result instanceof Promise ? result : Promise.resolve(result);
  }

  const payload: CreateMapOptions = {
    elementId: options.elementId,
    lat: options.lat,
    lng: options.lng,
    zoom: options.zoom,
    provider: options.provider ?? DEFAULT_PROVIDER,
  };

  try {
    nativeMapLog("createNativeMap", payload);
    const result = await getPlugin().createMap(payload);
    activeMapId = result.mapId;
    return result;
  } catch (err) {
    nativeMapWarn("createNativeMap failed", err);
    if (silent) {
      return { mapId: UNAVAILABLE_MAP_ID };
    }
    return Promise.reject(err);
  }
}

/**
 * Move the native map camera. `mapId` is validated locally; plugin supports one map at a time.
 */
export async function setNativeCamera(
  mapId: string,
  options: SetNativeCameraOptions,
  callOptions: NativeMapCallOptions = {},
): Promise<void> {
  const silent = callOptions.silent ?? true;

  if (!isNativeMapAvailable()) {
    const result = unavailableResult(silent, undefined, "setNativeCamera skipped — not iOS native");
    return result instanceof Promise ? result : Promise.resolve();
  }

  if (activeMapId && mapId !== activeMapId) {
    nativeMapWarn(`setNativeCamera mapId mismatch (expected ${activeMapId}, got ${mapId})`);
  }

  const payload: SetCameraOptions = {
    lat: options.lat,
    lng: options.lng,
    zoom: options.zoom,
    animated: options.animated,
  };

  try {
    nativeMapLog("setNativeCamera", { mapId, ...payload });
    await getPlugin().setCamera(payload);
  } catch (err) {
    nativeMapWarn("setNativeCamera failed", err);
    if (!silent) {
      return Promise.reject(err);
    }
  }
}

/**
 * Tear down the native map overlay.
 */
export async function destroyNativeMap(
  mapId?: string,
  callOptions: NativeMapCallOptions = {},
): Promise<void> {
  const silent = callOptions.silent ?? true;

  if (!isNativeMapAvailable()) {
    const result = unavailableResult(silent, undefined, "destroyNativeMap skipped — not iOS native");
    return result instanceof Promise ? result : Promise.resolve();
  }

  if (mapId && activeMapId && mapId !== activeMapId) {
    nativeMapWarn(`destroyNativeMap mapId mismatch (expected ${activeMapId}, got ${mapId})`);
  }

  try {
    nativeMapLog("destroyNativeMap", { mapId: mapId ?? activeMapId });
    await getPlugin().destroyMap();
    activeMapId = null;
  } catch (err) {
    nativeMapWarn("destroyNativeMap failed", err);
    if (!silent) {
      return Promise.reject(err);
    }
  }
}

/**
 * Reserved for Step 3 — native camera idle events are not exposed by the plugin yet.
 * Returns an unsubscribe no-op.
 */
export function onNativeCameraIdle(
  _mapId: string,
  _callback: (payload: NativeCameraIdlePayload) => void,
): () => void {
  nativeMapLog("onNativeCameraIdle not implemented — plugin listener pending");
  return () => {
    /* noop */
  };
}

/**
 * Debug helper — native frame / provider from the plugin.
 */
export async function getNativeMapDebugInfo(
  callOptions: NativeMapCallOptions = {},
): Promise<NativeMapDebugInfo | null> {
  const silent = callOptions.silent ?? true;

  if (!isNativeMapAvailable()) {
    const result = unavailableResult(silent, null, "getNativeMapDebugInfo skipped — not iOS native");
    return result instanceof Promise ? result : Promise.resolve(result);
  }

  try {
    return await getPlugin().getDebugInfo();
  } catch (err) {
    nativeMapWarn("getNativeMapDebugInfo failed", err);
    if (silent) return null;
    return Promise.reject(err);
  }
}
