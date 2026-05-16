import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export type MapLatLng = { latitude: number; longitude: number };

type PositionRequestOptions = {
  enableHighAccuracy: boolean;
  timeout: number;
  maximumAge: number;
};

/** Stage 1: 빠른 대략 위치 (와이파이/셀, 1분 캐시 허용) */
const STAGE1_OPTIONS: PositionRequestOptions = {
  enableHighAccuracy: false,
  timeout: 5_000,
  maximumAge: 60_000,
};

/** Stage 2: 정밀 GPS 보강 */
const STAGE2_OPTIONS: PositionRequestOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0,
};

/** 권한 허가(또는 iOS 대략적 위치)일 때만 위치 조회 — 먼저 requestPermissions 호출 */
function isLocationPermissionOk(location: string): boolean {
  return location === "granted" || location === "limited";
}

async function ensureNativeLocationPermission(): Promise<void> {
  const permResult = await Geolocation.requestPermissions();
  if (!isLocationPermissionOk(permResult.location)) {
    throw new Error(
      permResult.location === "denied" ? "permission_denied" : "permission_not_granted",
    );
  }
}

async function getPositionWithOptions(opts: PositionRequestOptions): Promise<MapLatLng> {
  if (Capacitor.isNativePlatform()) {
    await ensureNativeLocationPermission();
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: opts.enableHighAccuracy,
      timeout: opts.timeout,
      maximumAge: opts.maximumAge,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  }

  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
        });
      },
      reject,
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        timeout: opts.timeout,
        maximumAge: opts.maximumAge,
      },
    );
  });
}

/** Stage 1 — 지도 진입 시 즉시 표시용 */
export async function getCurrentPositionForMapStage1(): Promise<MapLatLng> {
  return getPositionWithOptions(STAGE1_OPTIONS);
}

/** Stage 2 — 백그라운드 정밀 보강 */
export async function getCurrentPositionForMapStage2(): Promise<MapLatLng> {
  return getPositionWithOptions(STAGE2_OPTIONS);
}

/** 하위 호환: Stage 1과 동일 (빠른 위치) */
export async function getCurrentPositionForMap(): Promise<MapLatLng> {
  return getCurrentPositionForMapStage1();
}

export function isGeolocationPermissionDenied(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.message === "permission_denied" || err.message === "permission_not_granted") {
      return true;
    }
  }
  if (err && typeof err === "object" && "code" in err) {
    return (err as GeolocationPositionError).code === 1;
  }
  return false;
}
