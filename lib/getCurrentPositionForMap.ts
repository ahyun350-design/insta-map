import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export type MapLatLng = { latitude: number; longitude: number };

/** WebView(Capacitor 네이티브)에서는 Capacitor Geolocation, 브라우저에서는 navigator.geolocation */
export async function getCurrentPositionForMap(): Promise<MapLatLng> {
  if (Capacitor.isNativePlatform()) {
    const perm = await Geolocation.requestPermissions();
    if (perm.location === "denied") {
      const err = new Error("permission_denied");
      throw err;
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export function isGeolocationPermissionDenied(err: unknown): boolean {
  if (err instanceof Error && err.message === "permission_denied") return true;
  if (err && typeof err === "object" && "code" in err) {
    return (err as GeolocationPositionError).code === 1;
  }
  return false;
}
