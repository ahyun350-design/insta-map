import { DEFAULT_CATEGORY_PIN } from "@/lib/categoryAppearance";
import type { FeedPostCategory } from "@/lib/feedPost";

/**
 * Native fullscreen pin canvas (PindmapNativeMapPlugin.swift
 * NativeMapMarkerStyleHelper.PIN_DISPLAY_SIZE) = 40×48 pt.
 * React Kakao MarkerImage reference was 36×44; native draws at 40×48.
 */
export const MAP_PIN_WIDTH = 40;
export const MAP_PIN_HEIGHT = 48;
export const MAP_FOCUS_PIN_WIDTH = 48;
export const MAP_FOCUS_PIN_HEIGHT = 58;
/** Native myLocationSize ≈ 40×24/36 ≈ 26.67 pt — use 27 CSS px. */
export const MAP_MYLOC_SIZE = 27;

/** CSS-pixel icon-size (image is registered with device pixelRatio). */
export const MAP_PIN_ICON_SIZE = 1;
export const MAP_FOCUS_PIN_ICON_SIZE = 1;
export const MAP_MYLOC_ICON_SIZE = 1;

export function clampMapPinDpr(dpr?: number): number {
  const n = Number.isFinite(dpr) ? Number(dpr) : 1;
  return Math.max(1, Math.min(3, Math.round(n || 1)));
}

export function pinMarkerSvg(
  category: string,
  fillColor: string,
  opts?: { stroke?: string; strokeWidth?: number; glow?: boolean },
): string {
  const emoji =
    category in DEFAULT_CATEGORY_PIN
      ? DEFAULT_CATEGORY_PIN[category as FeedPostCategory].emoji
      : "📍";
  const stroke = opts?.stroke ?? (category === "맛집" ? "#fff" : "#999");
  const strokeWidth = opts?.strokeWidth ?? 1;
  const shadow = opts?.glow
    ? `<feDropShadow dx="0" dy="0" stdDeviation="1.6" flood-color="#ffffff" flood-opacity="0.45"/><feDropShadow dx="0" dy="1.2" stdDeviation="1.1" flood-color="#000000" flood-opacity="0.35"/>`
    : `<feDropShadow dx="0" dy="1.2" stdDeviation="1.1" flood-color="#000000" flood-opacity="0.28"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><defs><filter id="s" x="-40%" y="-30%" width="180%" height="180%">${shadow}</filter></defs><path filter="url(#s)" d="M20 0C8.95 0 0 8.95 0 20c0 15 20 28 20 28s20-13 20-28C40 8.95 31.05 0 20 0z" fill="${fillColor}" stroke="${stroke}" stroke-width="${strokeWidth}"/><circle cx="20" cy="20" r="14.5" fill="white" opacity="0.9"/><text x="20" y="25" text-anchor="middle" font-size="15">${emoji}</text></svg>`;
}

export function focusMarkerSvg(
  category: string,
  fillColor: string,
  opts?: { stroke?: string; glow?: boolean },
): string {
  const emoji =
    category in DEFAULT_CATEGORY_PIN
      ? DEFAULT_CATEGORY_PIN[category as FeedPostCategory].emoji
      : "📍";
  const stroke = opts?.stroke ?? "#1a2a7a";
  const shadow = opts?.glow
    ? `<feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#ffffff" flood-opacity="0.4"/><feDropShadow dx="0" dy="1.4" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.35"/>`
    : `<feDropShadow dx="0" dy="1.4" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="58" viewBox="0 0 48 58"><defs><filter id="s" x="-40%" y="-30%" width="180%" height="180%">${shadow}</filter></defs><path filter="url(#s)" d="M24 1C11.3 1 1 11.3 1 24c0 17.5 23 33 23 33s23-15.5 23-33C47 11.3 36.7 1 24 1z" fill="${fillColor}" stroke="${stroke}" stroke-width="2.5"/><circle cx="24" cy="24" r="15" fill="white" opacity="0.95"/><text x="24" y="30" text-anchor="middle" font-size="16">${emoji}</text></svg>`;
}

/** Native my-location ring (~27 pt). */
export function myLocationMarkerSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="27" height="27" viewBox="0 0 27 27"><circle cx="13.5" cy="13.5" r="11" fill="#1a2a7a" stroke="white" stroke-width="2.5"/><circle cx="13.5" cy="13.5" r="4.5" fill="white"/></svg>`;
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
