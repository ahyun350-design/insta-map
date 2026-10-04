"use client";

import maplibregl, {
  type GeoJSONSource,
  type Map as MlMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  MAP_FOCUS_PIN_HEIGHT,
  MAP_FOCUS_PIN_ICON_SIZE,
  MAP_FOCUS_PIN_WIDTH,
  MAP_MYLOC_ICON_SIZE,
  MAP_MYLOC_SIZE,
  MAP_PIN_HEIGHT,
  MAP_PIN_ICON_SIZE,
  MAP_PIN_PIXEL_RATIO,
  MAP_PIN_WIDTH,
  MY_LOCATION_IMAGE_ID,
  focusMarkerSvg,
  myLocationMarkerSvg,
  pinImageKey,
  pinMarkerSvg,
} from "@/lib/mapPinImages";
import { buildPindmapStyle } from "@/lib/pindmapMapStyle";
import {
  horizontalSpanKmForMapLibreZoom,
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
const MYLOC_LAYER = "compact-myloc-symbol";

const EDGE_PX = 24;
const HIT_PAD_PX = 14;
const FIRST_TILE_TIMEOUT_MS = 4000;

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
      if (!map.hasImage(id)) {
        map.addImage(id, img, { pixelRatio: MAP_PIN_PIXEL_RATIO });
      }
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
  private onViewIdle: ((view: { lat: number; lng: number; level: number }) => void) | null =
    null;

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

    map.on("error", () => {});
    map.on("sourcedata", (e) => {
      if (
        e.dataType === "source" &&
        e.isSourceLoaded &&
        e.sourceId !== PIN_SOURCE &&
        e.sourceId !== "seoul_gu_labels"
      ) {
        this.firstTileSeen = true;
      }
    });

    map.on("load", () => {
      void (async () => {
        try {
          if (this.destroyed || !this.map) return;
          this.styleReady = true;
          await ensureImage(
            this.map,
            MY_LOCATION_IMAGE_ID,
            myLocationMarkerSvg(),
            MAP_MYLOC_SIZE,
            MAP_MYLOC_SIZE,
          );
          this.addLayers(this.map);
          this.bindClicks(this.map);
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

    // My-location below pins — non-interactive (no click handler)
    map.addSource(MYLOC_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: MYLOC_LAYER,
      type: "symbol",
      source: MYLOC_SOURCE,
      layout: {
        "icon-image": MY_LOCATION_IMAGE_ID,
        "icon-size": MAP_MYLOC_ICON_SIZE,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });

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
        "icon-size": MAP_PIN_ICON_SIZE,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
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
        "icon-size": MAP_FOCUS_PIN_ICON_SIZE,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }

  private bindClicks(map: MlMap) {
    map.on("click", (e) => {
      const bbox: [[number, number], [number, number]] = [
        [e.point.x - HIT_PAD_PX, e.point.y - HIT_PAD_PX],
        [e.point.x + HIT_PAD_PX, e.point.y + HIT_PAD_PX],
      ];
      const feats = map.queryRenderedFeatures(bbox, {
        layers: [PIN_LAYER, FOCUS_LAYER],
      });
      if (feats.length > 0) {
        let bestId: string | null = null;
        let bestD = Infinity;
        for (const f of feats) {
          const id = f.properties?.id;
          if (typeof id !== "string") continue;
          if (f.geometry.type !== "Point") continue;
          const coords = f.geometry.coordinates as [number, number];
          const projected = map.project(coords);
          const d =
            (projected.x - e.point.x) ** 2 + (projected.y - e.point.y) ** 2;
          if (d < bestD) {
            bestD = d;
            bestId = id;
          }
        }
        if (bestId) {
          this.onPinClick?.(bestId);
          return;
        }
      }
      this.onMapClickEmpty?.();
    });
    map.on("mouseenter", PIN_LAYER, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", PIN_LAYER, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  /** Current horizontal ground span (km) for diagnostics. */
  getHorizontalSpanKm(): number | null {
    if (!this.map) return null;
    const canvas = this.map.getCanvas();
    const w = canvas.clientWidth || canvas.width;
    if (!w) return null;
    return horizontalSpanKmForMapLibreZoom(
      this.map.getZoom(),
      this.map.getCenter().lat,
      w,
    );
  }

  getZoom(): number {
    return this.map?.getZoom() ?? 0;
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
          pinImageKey("pin", p.category, p.fillColor),
          pinMarkerSvg(p.category, p.fillColor),
          MAP_PIN_WIDTH,
          MAP_PIN_HEIGHT,
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
          icon: pinImageKey("pin", p.category, p.fillColor),
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
    const icon = pinImageKey("focus", pin.category, pin.fillColor);
    await ensureImage(
      map,
      icon,
      focusMarkerSvg(pin.category, pin.fillColor),
      MAP_FOCUS_PIN_WIDTH,
      MAP_FOCUS_PIN_HEIGHT,
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
