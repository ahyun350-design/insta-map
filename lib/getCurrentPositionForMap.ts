import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export type MapLatLng = { latitude: number; longitude: number };

/** 권한 허가(또는 iOS 대략적 위치)일 때만 위치 조회 — 먼저 requestPermissions 호출 */
function isLocationPermissionOk(location: string): boolean {
  return location === "granted" || location === "limited";
}

/** WebView(Capacitor 네이티브)는 @capacitor/geolocation, 브라우저는 navigator.geolocation */
export async function getCurrentPositionForMap(): Promise<MapLatLng> {
  if (Capacitor.isNativePlatform()) {
    const permResult = await Geolocation.requestPermissions();

    if (!isLocationPermissionOk(permResult.location)) {
      throw new Error(
        permResult.location === "denied" ? "permission_denied" : "permission_not_granted",
      );
    }

    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 20000,
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
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
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
