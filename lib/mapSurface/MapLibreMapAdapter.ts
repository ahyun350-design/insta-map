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
  MAP_PIN_WIDTH,
  MY_LOCATION_IMAGE_ID,
  clampMapPinDpr,
  focusMarkerSvg,
  loadMapImageFromSvg,
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
  CourseStopInput,
  ExpandedMapSurface,
  MapLatLng,
  SearchPinInput,
} from "./types";

const PIN_SOURCE = "compact-pins";
const PIN_LAYER = "compact-pins-symbol";
const ROUTE_SOURCE = "compact-route";
const ROUTE_LAYER = "compact-route-line";
const FOCUS_SOURCE = "compact-focus";
const FOCUS_LAYER = "compact-focus-symbol";
const MYLOC_SOURCE = "compact-myloc";
const MYLOC_LAYER = "compact-myloc-symbol";
const SEARCH_SOURCE = "compact-search";
const SEARCH_LAYER = "compact-search-symbol";
const COURSE_SOURCE = "compact-course";
const COURSE_PIN_LAYER = "compact-course-pins";
const COURSE_LABEL_LAYER = "compact-course-labels";
const SEARCH_IMAGE_ID = "pindmap-search-pin";

const EDGE_PX = 24;
const HIT_PAD_PX = 14;
const FIRST_TILE_TIMEOUT_MS = 4000;
/** Clusters while zoom < 10; L9 → ML zoom 10 shows individual pins. */
const CLUSTER_MAX_ZOOM = 9;
const CLUSTER_RADIUS = 52;
const PIN_CLUSTER_LAYER = "compact-pins-clusters";
const PIN_CLUSTER_COUNT_LAYER = "compact-pins-cluster-count";

export type CreateCompactMapLibreOptions = {
  container: HTMLElement;
  center: MapLatLng;
  level: number;
  /** compact = minimap; expanded = fullscreen admin map */
  mode?: "compact" | "expanded";
  onPinClick?: (pinId: string) => void;
  onSearchPinClick?: (pinId: string) => void;
  onCourseStopClick?: (stopId: string) => void;
  onMapClickEmpty?: () => void;
  onReady?: () => void;
  onFallback?: (reason: string) => void;
  onViewIdle?: (view: { lat: number; lng: number; level: number }) => void;
};

function searchPinSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
  <circle cx="14" cy="14" r="9" fill="#1a2a7a" stroke="#ffffff" stroke-width="3"/>
</svg>`;
}

function courseOrderPinSvg(order: number): string {
  const label = String(order);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
  <path d="M16 1C8.3 1 2 7.3 2 15c0 10.5 14 24 14 24s14-13.5 14-24C30 7.3 23.7 1 16 1z" fill="#1a2a7a"/>
  <circle cx="16" cy="15" r="8" fill="#ffffff"/>
  <text x="16" y="19" text-anchor="middle" font-size="11" font-weight="700" font-family="system-ui,sans-serif" fill="#1a2a7a">${label}</text>
</svg>`;
}

export class MapLibreMapAdapter implements CompactMapSurface, ExpandedMapSurface {
  readonly provider = "maplibre" as const;
  private map: MlMap | null = null;
  private destroyed = false;
  private pins: CompactPinInput[] = [];
  private fallbackTimer: number | null = null;
  private firstTileSeen = false;
  private styleReady = false;
  private touchCleanups: Array<() => void> = [];
  private onPinClick: ((id: string) => void) | null = null;
  private onSearchPinClick: ((id: string) => void) | null = null;
  private onCourseStopClick: ((id: string) => void) | null = null;
  private onMapClickEmpty: (() => void) | null = null;
  private onViewIdle: ((view: { lat: number; lng: number; level: number }) => void) | null =
    null;
  private imageDpr = 2;
  private mode: "compact" | "expanded" = "compact";

  static async create(
    options: CreateCompactMapLibreOptions,
  ): Promise<MapLibreMapAdapter> {
    const adapter = new MapLibreMapAdapter();
    adapter.mode = options.mode ?? "compact";
    adapter.onPinClick = options.onPinClick ?? null;
    adapter.onSearchPinClick = options.onSearchPinClick ?? null;
    adapter.onCourseStopClick = options.onCourseStopClick ?? null;
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
        ? clampMapPinDpr(window.devicePixelRatio || 1)
        : 1;

    this.imageDpr = dpr;

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
          await loadMapImageFromSvg(
            this.map,
            MY_LOCATION_IMAGE_ID,
            myLocationMarkerSvg(),
            MAP_MYLOC_SIZE,
            MAP_MYLOC_SIZE,
            this.imageDpr,
          );
          await loadMapImageFromSvg(
            this.map,
            SEARCH_IMAGE_ID,
            searchPinSvg(),
            28,
            28,
            this.imageDpr,
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
    el.className =
      this.mode === "expanded"
        ? "expandedMapLibreAttrib"
        : "compactMapLibreAttrib";
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
      cluster: true,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterRadius: CLUSTER_RADIUS,
    });
    map.addLayer({
      id: PIN_CLUSTER_LAYER,
      type: "circle",
      source: PIN_SOURCE,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#1a2a7a",
        "circle-radius": ["step", ["get", "point_count"], 16, 8, 20, 25, 26],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    map.addLayer({
      id: PIN_CLUSTER_COUNT_LAYER,
      type: "symbol",
      source: PIN_SOURCE,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#ffffff" },
    });
    map.addLayer({
      id: PIN_LAYER,
      type: "symbol",
      source: PIN_SOURCE,
      filter: ["!", ["has", "point_count"]],
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

    map.addSource(SEARCH_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: SEARCH_LAYER,
      type: "symbol",
      source: SEARCH_SOURCE,
      layout: {
        "icon-image": SEARCH_IMAGE_ID,
        "icon-size": 0.9,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });

    map.addSource(COURSE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: COURSE_PIN_LAYER,
      type: "symbol",
      source: COURSE_SOURCE,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 1,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    map.addLayer({
      id: COURSE_LABEL_LAYER,
      type: "symbol",
      source: COURSE_SOURCE,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-offset": [0, -2.8],
        "text-anchor": "bottom",
        "text-max-width": 10,
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": "#1a1a2e",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4,
      },
    });
  }

  private bindClicks(map: MlMap) {
    map.on("click", PIN_CLUSTER_LAYER, (e) => {
      const feat = e.features?.[0];
      if (!feat || feat.geometry.type !== "Point") return;
      const clusterId = feat.properties?.cluster_id as number | undefined;
      if (clusterId == null) return;
      const src = map.getSource(PIN_SOURCE) as GeoJSONSource;
      const coords = feat.geometry.coordinates as [number, number];
      void src.getClusterExpansionZoom(clusterId).then((z) => {
        map.easeTo({ center: coords, zoom: Math.min(z, 12) });
      });
    });
    map.on("click", (e) => {
      const bbox: [[number, number], [number, number]] = [
        [e.point.x - HIT_PAD_PX, e.point.y - HIT_PAD_PX],
        [e.point.x + HIT_PAD_PX, e.point.y + HIT_PAD_PX],
      ];
      const clusterHits = map.queryRenderedFeatures(bbox, {
        layers: [PIN_CLUSTER_LAYER],
      });
      if (clusterHits.length > 0) return; // cluster handler owns this
      const feats = map.queryRenderedFeatures(bbox, {
        layers: [PIN_LAYER, FOCUS_LAYER, SEARCH_LAYER, COURSE_PIN_LAYER],
      });
      if (feats.length > 0) {
        let bestId: string | null = null;
        let bestLayer: string | null = null;
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
            bestLayer = f.layer?.id ?? null;
          }
        }
        if (bestId) {
          if (bestLayer === SEARCH_LAYER) this.onSearchPinClick?.(bestId);
          else if (bestLayer === COURSE_PIN_LAYER) this.onCourseStopClick?.(bestId);
          else this.onPinClick?.(bestId);
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
        loadMapImageFromSvg(
          map,
          pinImageKey("pin", p.category, p.fillColor),
          pinMarkerSvg(p.category, p.fillColor),
          MAP_PIN_WIDTH,
          MAP_PIN_HEIGHT,
          this.imageDpr,
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
    await loadMapImageFromSvg(
      map,
      icon,
      focusMarkerSvg(pin.category, pin.fillColor),
      MAP_FOCUS_PIN_WIDTH,
      MAP_FOCUS_PIN_HEIGHT,
      this.imageDpr,
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

  panTo(lat: number, lng: number) {
    this.map?.easeTo({ center: [lng, lat], duration: 450 });
  }

  getBounds() {
    if (!this.map) return null;
    const b = this.map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    return {
      getSouthWest: () => ({ lat: sw.lat, lng: sw.lng }),
      getNorthEast: () => ({ lat: ne.lat, lng: ne.lng }),
    };
  }

  project(lat: number, lng: number) {
    if (!this.map) return null;
    const p = this.map.project([lng, lat]);
    return { x: p.x, y: p.y };
  }

  unproject(x: number, y: number) {
    if (!this.map) return null;
    const ll = this.map.unproject([x, y]);
    return { lat: ll.lat, lng: ll.lng };
  }

  setSearchPins(pins: SearchPinInput[]) {
    const map = this.map;
    if (!map?.getSource(SEARCH_SOURCE)) return;
    (map.getSource(SEARCH_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: pins.map((p) => ({
        type: "Feature",
        properties: { id: p.id },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      })),
    });
  }

  clearSearchPins() {
    this.setSearchPins([]);
  }

  setCourseStops(stops: CourseStopInput[]) {
    void this.applyCourseStops(stops);
  }

  private async applyCourseStops(stops: CourseStopInput[]) {
    const map = this.map;
    if (!map?.getSource(COURSE_SOURCE)) return;
    await Promise.all(
      stops.map((s) =>
        loadMapImageFromSvg(
          map,
          `course-order-${s.order}`,
          courseOrderPinSvg(s.order),
          32,
          40,
          this.imageDpr,
        ),
      ),
    );
    if (this.destroyed || !this.map) return;
    (this.map.getSource(COURSE_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: stops.map((s) => ({
        type: "Feature",
        properties: {
          id: s.id,
          name: s.name,
          icon: `course-order-${s.order}`,
        },
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      })),
    });
  }

  clearCourseStops() {
    const map = this.map;
    if (!map?.getSource(COURSE_SOURCE)) return;
    (map.getSource(COURSE_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  setRouteStyle(opts: {
    color?: string;
    width?: number;
    dasharray?: number[];
    opacity?: number;
  }) {
    const map = this.map;
    if (!map?.getLayer(ROUTE_LAYER)) return;
    if (opts.color) map.setPaintProperty(ROUTE_LAYER, "line-color", opts.color);
    if (opts.width != null) map.setPaintProperty(ROUTE_LAYER, "line-width", opts.width);
    if (opts.dasharray) {
      map.setPaintProperty(ROUTE_LAYER, "line-dasharray", opts.dasharray);
    }
    if (opts.opacity != null) {
      map.setPaintProperty(ROUTE_LAYER, "line-opacity", opts.opacity);
    }
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
