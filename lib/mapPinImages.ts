import { DEFAULT_CATEGORY_PIN } from "@/lib/categoryAppearance";
import type { FeedPostCategory } from "@/lib/feedPost";

/** Matches Kakao MarkerImage Size(36, 44) on the compact minimap. */
export const MAP_PIN_WIDTH = 36;
export const MAP_PIN_HEIGHT = 44;
export const MAP_FOCUS_PIN_WIDTH = 48;
export const MAP_FOCUS_PIN_HEIGHT = 58;
export const MAP_MYLOC_SIZE = 24;

/** CSS-pixel icon-size (image is registered with device pixelRatio). */
export const MAP_PIN_ICON_SIZE = 1;
export const MAP_FOCUS_PIN_ICON_SIZE = 1;
export const MAP_MYLOC_ICON_SIZE = 1;

export function clampMapPinDpr(dpr?: number): number {
  const n = Number.isFinite(dpr) ? Number(dpr) : 1;
  return Math.max(1, Math.min(3, Math.round(n || 1)));
}

export function pinMarkerSvg(category: string, fillColor: string): string {
  const emoji =
    category in DEFAULT_CATEGORY_PIN
      ? DEFAULT_CATEGORY_PIN[category as FeedPostCategory].emoji
      : "📍";
  const stroke = category === "맛집" ? "#fff" : "#999";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><defs><filter id="s" x="-30%" y="-20%" width="160%" height="160%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.1" flood-color="#000000" flood-opacity="0.28"/></filter></defs><path filter="url(#s)" d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${fillColor}" stroke="${stroke}" stroke-width="1"/><circle cx="18" cy="18" r="13" fill="white" opacity="0.9"/><text x="18" y="23" text-anchor="middle" font-size="14">${emoji}</text></svg>`;
}

export function focusMarkerSvg(category: string, fillColor: string): string {
  const emoji =
    category in DEFAULT_CATEGORY_PIN
      ? DEFAULT_CATEGORY_PIN[category as FeedPostCategory].emoji
      : "📍";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="58" viewBox="0 0 48 58"><defs><filter id="s" x="-30%" y="-20%" width="160%" height="160%"><feDropShadow dx="0" dy="1.4" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.3"/></filter></defs><path filter="url(#s)" d="M24 1C11.3 1 1 11.3 1 24c0 17.5 23 33 23 33s23-15.5 23-33C47 11.3 36.7 1 24 1z" fill="${fillColor}" stroke="#1a2a7a" stroke-width="2.5"/><circle cx="24" cy="24" r="15" fill="white" opacity="0.95"/><text x="24" y="30" text-anchor="middle" font-size="16">${emoji}</text></svg>`;
}

/** Same asset as Kakao compact `makeMyLocationImage` (24×24 ring). */
export function myLocationMarkerSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1a2a7a" stroke="white" stroke-width="2.5"/><circle cx="12" cy="12" r="4" fill="white"/></svg>`;
}

export function pinImageKey(kind: "pin" | "focus", category: string, fillColor: string) {
  return `${kind}:${category}:${fillColor.toLowerCase()}`;
}

export const MY_LOCATION_IMAGE_ID = "myloc-ring";

/** Load SVG into a MapLibre image at `dpr` (≤3) so it stays sharp on Retina. */
export function loadMapImageFromSvg(
  map: { hasImage: (id: string) => boolean; addImage: (id: string, img: HTMLImageElement, opts?: { pixelRatio?: number }) => void },
  id: string,
  svg: string,
  cssW: number,
  cssH: number,
  dpr: number,
): Promise<void> {
  const pr = clampMapPinDpr(dpr);
  if (map.hasImage(id)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const img = new Image(cssW * pr, cssH * pr);
    img.onload = () => {
      if (!map.hasImage(id)) {
        map.addImage(id, img, { pixelRatio: pr });
      }
      resolve();
    };
    img.onerror = () => reject(new Error(`image_${id}`));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
