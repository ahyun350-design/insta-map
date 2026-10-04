"use client";

import maplibregl, {
  type GeoJSONSource,
  type Map as MlMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CATEGORY_PIN } from "@/lib/categoryAppearance";
import type { FeedPostCategory } from "@/lib/feedPost";
import { buildPindmapStyle } from "@/lib/pindmapMapStyle";
import {
  kakaoLevelToMapLibreZoom,
  mapLibreZoomToKakaoLevel,
} from "./kakaoZoom";
import type {
  CompactMapSurface,
  CompactPinInput,
  CompactRouteMode,
  MapLatLng,
} from "./types";

const PIN_SOURCE = "compact-pins";
const PIN_LAYER = "compact-pins-symbol";
const ROUTE_SOURCE = "compact-route";
const ROUTE_LAYER = "compact-route-line";
const FOCUS_SOURCE = "compact-focus";
const FOCUS_LAYER = "compact-focus-symbol";
const MYLOC_SOURCE = "compact-myloc";
const MYLOC_LAYER = "compact-myloc-circle";

const EDGE_PX = 24;
const FIRST_TILE_TIMEOUT_MS = 4000;

function pinSvg(category: string, fillColor: string) {
  const emoji =
    category in DEFAULT_CATEGORY_PIN
      ? DEFAULT_CATEGORY_PIN[category as FeedPostCategory].emoji
      : "📍";
  const stroke = category === "맛집" ? "#fff" : "#999";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${fillColor}" stroke="${stroke}" stroke-width="1"/><circle cx="18" cy="18" r="13" fill="white" opacity="0.9"/><text x="18" y="23" text-anchor="middle" font-size="14">${emoji}</text></svg>`;
}

function focusPinSvg(category: string, fillColor: string) {
  const emoji =
    category in DEFAULT_CATEGORY_PIN
      ? DEFAULT_CATEGORY_PIN[category as FeedPostCategory].emoji
      : "📍";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="58" viewBox="0 0 48 58"><path d="M24 1C11.3 1 1 11.3 1 24c0 17.5 23 33 23 33s23-15.5 23-33C47 11.3 36.7 1 24 1z" fill="${fillColor}" stroke="#1a2a7a" stroke-width="2.5"/><circle cx="24" cy="24" r="15" fill="white" opacity="0.95"/><text x="24" y="30" text-anchor="middle" font-size="16">${emoji}</text></svg>`;
}

function imageKey(kind: "pin" | "focus", category: string, fillColor: string) {
  return `${kind}:${category}:${fillColor.toLowerCase()}`;
}

async function ensureImage(
  map: MlMap,
  id: string,
  svg: string,
  w: number,
  h: number,
) {
  if (map.hasImage(id)) return;
  await new Promise<void>((resolve, reject) => {
    const img = new Image(w, h);
    img.onload = () => {
      if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
      resolve();
    };
    img.onerror = () => reject(new Error(`image_${id}`));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export type CreateCompactMapLibreOptions = {
  container: HTMLElement;
  center: MapLatLng;
  level: number;
  onPinClick?: (pinId: string) => void;
  onMapClickEmpty?: () => void;
  onReady?: () => void;
  onFallback?: (reason: string) => void;
  onViewIdle?: (view: { lat: number; lng: number; level: number }) => void;
};

export class MapLibreMapAdapter implements CompactMapSurface {
  readonly provider = "maplibre" as const;
  private map: MlMap | null = null;
  private destroyed = false;
  private pins: CompactPinInput[] = [];
  private fallbackTimer: number | null = null;
  private firstTileSeen = false;
  private styleReady = false;
  private touchCleanups: Array<() => void> = [];
  private onPinClick: ((id: string) => void) | null = null;
  private onMapClickEmpty: (() => void) | null = null;
  private onViewIdle: ((view: { lat: number; lng: number; level: number }) => void) | null = null;

  static async create(
    options: CreateCompactMapLibreOptions,
  ): Promise<MapLibreMapAdapter> {
    const adapter = new MapLibreMapAdapter();
    adapter.onPinClick = options.onPinClick ?? null;
    adapter.onMapClickEmpty = options.onMapClickEmpty ?? null;
    adapter.onViewIdle = options.onViewIdle ?? null;
    await adapter.mount(options);
    return adapter;
  }

  private async mount(options: CreateCompactMapLibreOptions) {
    const style = await buildPindmapStyle("paper");
    if (this.destroyed) return;

    const dpr =
      typeof window !== "undefined"
        ? Math.min(window.devicePixelRatio || 1, 2)
        : 1;

    const map = new maplibregl.Map({
      container: options.container,
      style: style as StyleSpecification,
      center: [options.center.lng, options.center.lat],
      zoom: kakaoLevelToMapLibreZoom(options.level),
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      pitch: 0,
      maxPitch: 0,
      fadeDuration: 0,
      antialias: false,
      renderWorldCopies: false,
      pixelRatio: dpr,
    });
    this.map = map;
    map.touchZoomRotate.disableRotation();
    this.installEdgeGestureGuard(map);
    this.installAttribution(options.container);
    map.on("moveend", () => {
      if (this.destroyed || !this.map) return;
      const c = this.map.getCenter();
      this.onViewIdle?.({
        lat: c.lat,
        lng: c.lng,
        level: mapLibreZoomToKakaoLevel(this.map.getZoom()),
      });
    });

    this.fallbackTimer = window.setTimeout(() => {
      if (this.destroyed) return;
      if (!this.styleReady || !this.firstTileSeen) {
        options.onFallback?.(
          !this.styleReady ? "style_timeout" : "tile_timeout",
        );
      }
    }, FIRST_TILE_TIMEOUT_MS);

    map.on("error", () => {
      /* tile noise ignored; timeout handles hard failure */
    });

    map.on("sourcedata", (e) => {
      if (e.dataType === "source" && e.isSourceLoaded && e.sourceId !== PIN_SOURCE) {
        this.firstTileSeen = true;
      }
    });

    map.on("load", () => {
      void (async () => {
        try {
          if (this.destroyed || !this.map) return;
          this.styleReady = true;
          this.addLayers(this.map);
          this.bindClicks(this.map);
          // Empty-ish load still counts as first paint if no tiles requested yet
          window.setTimeout(() => {
            if (!this.firstTileSeen) this.firstTileSeen = true;
          }, 800);
          options.onReady?.();
        } catch {
          options.onFallback?.("load_error");
        }
      })();
    });
  }

  private installAttribution(container: HTMLElement) {
    const el = document.createElement("div");
    el.className = "compactMapLibreAttrib";
    el.textContent = "© OpenStreetMap contributors";
    container.appendChild(el);
    this.touchCleanups.push(() => el.remove());
  }

  private installEdgeGestureGuard(map: MlMap) {
    const canvas = map.getCanvas();
    let disabled = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX <= EDGE_PX) {
        if (map.dragPan.isEnabled()) {
          map.dragPan.disable();
          disabled = true;
        }
      }
    };
    const onEnd = () => {
      if (disabled) {
        map.dragPan.enable();
        disabled = false;
      }
    };
    canvas.addEventListener("touchstart", onStart, { passive: true });
    canvas.addEventListener("touchend", onEnd, { passive: true });
    canvas.addEventListener("touchcancel", onEnd, { passive: true });
    this.touchCleanups.push(() => {
      canvas.removeEventListener("touchstart", onStart);
      canvas.removeEventListener("touchend", onEnd);
      canvas.removeEventListener("touchcancel", onEnd);
    });
  }

  private addLayers(map: MlMap) {
    map.addSource(PIN_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: false,
    });
    map.addLayer({
      id: PIN_LAYER,
      type: "symbol",
      source: PIN_SOURCE,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 0.55,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });

    map.addSource(ROUTE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: ROUTE_LAYER,
      type: "line",
      source: ROUTE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#1a2a7a",
        "line-width": 5,
        "line-opacity": 0.95,
      },
    });

    map.addSource(FOCUS_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: FOCUS_LAYER,
      type: "symbol",
      source: FOCUS_SOURCE,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 0.7,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });

    map.addSource(MYLOC_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: MYLOC_LAYER,
      type: "circle",
      source: MYLOC_SOURCE,
      paint: {
        "circle-radius": 8,
        "circle-color": "#1a2a7a",
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#ffffff",
      },
      // Not registered for click — non-interactive my-location
    });
  }

  private bindClicks(map: MlMap) {
    map.on("click", PIN_LAYER, (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") {
        e.originalEvent?.stopPropagation?.();
        this.onPinClick?.(id);
      }
    });
    map.on("click", (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: [PIN_LAYER, FOCUS_LAYER] });
      if (hits.length > 0) return;
      this.onMapClickEmpty?.();
    });
    map.on("mouseenter", PIN_LAYER, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", PIN_LAYER, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  resize() {
    this.map?.resize();
  }

  setCenter(lat: number, lng: number) {
    this.map?.jumpTo({ center: [lng, lat] });
  }

  setLevel(kakaoLevel: number) {
    this.map?.jumpTo({ zoom: kakaoLevelToMapLibreZoom(kakaoLevel) });
  }

  getLevel() {
    if (!this.map) return 9;
    return mapLibreZoomToKakaoLevel(this.map.getZoom());
  }

  getCenter(): MapLatLng {
    if (!this.map) return { lat: 37.5665, lng: 126.978 };
    const c = this.map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }

  fitPoints(
    points: MapLatLng[],
    padding = { top: 48, right: 36, bottom: 300, left: 36 },
  ) {
    const map = this.map;
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.jumpTo({
        center: [points[0]!.lng, points[0]!.lat],
        zoom: kakaoLevelToMapLibreZoom(4),
      });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const p of points) bounds.extend([p.lng, p.lat]);
    map.fitBounds(bounds, { padding, maxZoom: 16, duration: 0 });
  }

  setPins(pins: CompactPinInput[]) {
    this.pins = pins;
    void this.applyPins(pins);
  }

  private async applyPins(pins: CompactPinInput[]) {
    const map = this.map;
    if (!map?.getSource(PIN_SOURCE)) return;
    await Promise.all(
      pins.map((p) =>
        ensureImage(
          map,
          imageKey("pin", p.category, p.fillColor),
          pinSvg(p.category, p.fillColor),
          36,
          44,
        ),
      ),
    );
    if (this.destroyed || !this.map) return;
    const src = this.map.getSource(PIN_SOURCE) as GeoJSONSource;
    src.setData({
      type: "FeatureCollection",
      features: pins.map((p) => ({
        type: "Feature",
        id: p.id,
        properties: {
          id: p.id,
          icon: imageKey("pin", p.category, p.fillColor),
          name: p.name ?? "",
        },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      })),
    });
  }

  setMyLocation(lat: number, lng: number) {
    const map = this.map;
    if (!map?.getSource(MYLOC_SOURCE)) return;
    (map.getSource(MYLOC_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [lng, lat] },
        },
      ],
    });
  }

  clearMyLocation() {
    const map = this.map;
    if (!map?.getSource(MYLOC_SOURCE)) return;
    (map.getSource(MYLOC_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  setRoute(path: MapLatLng[], mode: CompactRouteMode) {
    const map = this.map;
    if (!map?.getSource(ROUTE_SOURCE) || path.length < 2) return;
    if (map.getLayer(ROUTE_LAYER)) {
      map.setPaintProperty(
        ROUTE_LAYER,
        "line-color",
        mode === "walk" ? "#16a34a" : "#1a2a7a",
      );
      map.setPaintProperty(ROUTE_LAYER, "line-width", mode === "walk" ? 7 : 5);
      map.setPaintProperty(
        ROUTE_LAYER,
        "line-dasharray",
        mode === "walk" ? [1.5, 1.2] : [1, 0],
      );
    }
    (map.getSource(ROUTE_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: path.map((p) => [p.lng, p.lat]),
          },
        },
      ],
    });
  }

  clearRoute() {
    const map = this.map;
    if (!map?.getSource(ROUTE_SOURCE)) return;
    (map.getSource(ROUTE_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  setFocusMarker(pin: CompactPinInput) {
    void this.applyFocusMarker(pin);
  }

  private async applyFocusMarker(pin: CompactPinInput) {
    const map = this.map;
    if (!map?.getSource(FOCUS_SOURCE)) return;
    const icon = imageKey("focus", pin.category, pin.fillColor);
    await ensureImage(
      map,
      icon,
      focusPinSvg(pin.category, pin.fillColor),
      48,
      58,
    );
    if (this.destroyed || !this.map) return;
    (this.map.getSource(FOCUS_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { icon, id: pin.id },
          geometry: { type: "Point", coordinates: [pin.lng, pin.lat] },
        },
      ],
    });
  }

  clearFocusMarker() {
    const map = this.map;
    if (!map?.getSource(FOCUS_SOURCE)) return;
    (map.getSource(FOCUS_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  destroy() {
    this.destroyed = true;
    if (this.fallbackTimer != null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    for (const off of this.touchCleanups) off();
    this.touchCleanups = [];
    try {
      this.map?.remove();
    } catch {
      /* noop */
    }
    this.map = null;
  }
}
