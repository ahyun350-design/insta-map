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
import {
  buildPindmapStyle,
  invalidateLibertyStyleCache,
} from "@/lib/pindmapMapStyle";
import type { AdminMapLibreThemeId } from "./adminMapTheme";
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
  DiscoverPinInput,
  ExpandedMapSurface,
  MapLatLng,
  SearchPinInput,
  SetCourseStopsOptions,
} from "./types";
import { trackMapGlFallback, trackMapGlReady } from "./mapGlTelemetry";
import { claimMapGlSlot, releaseMapGlSlot } from "./mapGlRecovery";
import { attachSubwayOverlay, prefetchSubwayOverlay } from "./subwayOverlay";
import {
  MAP_BRAND_NAVY,
  MAP_NEON_ACCENT,
  MAP_NEON_CLUSTER_FILL,
  MAP_NEON_CORE,
} from "./mapBrand";
import {
  COMPACT_ROUTE_FIT_PADDING,
  EXPANDED_ROUTE_FIT_PADDING,
  ROUTE_LAYOUT,
  routePaintForMode,
} from "./routeStyle";
import { installMapLibreCornerAttribution } from "./mapAttribution";

const PIN_SOURCE = "compact-pins";
const PIN_LAYER = "compact-pins-symbol";
const ROUTE_SOURCE = "compact-route";
const ROUTE_GLOW_OUTER_LAYER = "compact-route-glow-outer";
const ROUTE_GLOW_MID_LAYER = "compact-route-glow-mid";
const ROUTE_CASING_LAYER = "compact-route-casing";
const ROUTE_LAYER = "compact-route-line";
const ROUTE_ORIGIN_SOURCE = "compact-route-origin";
const ROUTE_ORIGIN_LAYER = "compact-route-origin-circle";
const FOCUS_SOURCE = "compact-focus";
const FOCUS_LAYER = "compact-focus-symbol";
const MYLOC_SOURCE = "compact-myloc";
const MYLOC_LAYER = "compact-myloc-symbol";
const DISCOVER_SOURCE = "compact-discover";
const DISCOVER_CIRCLE_LAYER = "compact-discover-circles";
const DISCOVER_LABEL_HOT_LAYER = "compact-discover-labels-hot";
const DISCOVER_LABEL_REST_LAYER = "compact-discover-labels-rest";
const SEARCH_SOURCE = "compact-search";
const SEARCH_LAYER = "compact-search-symbol";
const COURSE_SOURCE = "compact-course";
const COURSE_CIRCLE_LAYER = "compact-course-circles";
const COURSE_NUMBER_LAYER = "compact-course-numbers";
const COURSE_LABEL_LAYER = "compact-course-labels";
const SEARCH_IMAGE_ID = "pindmap-search-pin";
/** Discover dots only at MapLibre zoom ≥ 11. */
const DISCOVER_MIN_ZOOM = 11;

const EDGE_PX = 24;
const HIT_PAD_PX = 14;
const FIRST_TILE_TIMEOUT_MS = 4000;
/** Clusters while zoom < 10; L9 → ML zoom 10 shows individual pins. */
const CLUSTER_MAX_ZOOM = 9;
const CLUSTER_RADIUS = 52;
const PIN_CLUSTER_LAYER = "compact-pins-clusters";
const PIN_CLUSTER_COUNT_LAYER = "compact-pins-cluster-count";
/** Photo DOM pins (expanded admin MapLibre only). */
const PHOTO_PIN_MIN_ZOOM = 14;
const PHOTO_PIN_MAX = 30;
/** Selected emphasis only when unclustered (zoom ≥ 10). */
const SELECTED_PIN_MIN_ZOOM = 10;
const SELECTED_PIN_SCALE = 1.3;

export type CreateCompactMapLibreOptions = {
  container: HTMLElement;
  center: MapLatLng;
  level: number;
  /** Basemap + route chrome theme (admin neon | paper). */
  theme?: AdminMapLibreThemeId;
  /** compact = minimap; expanded = fullscreen admin map */
  mode?: "compact" | "expanded";
  onPinClick?: (pinId: string) => void;
  onSearchPinClick?: (pinId: string) => void;
  onCourseStopClick?: (stopId: string) => void;
  /** Admin discover layer — poi id as string. */
  onDiscoverPinClick?: (poiId: string) => void;
  onMapClickEmpty?: () => void;
  onReady?: () => void;
  onFallback?: (reason: string) => void;
  /**
   * webglcontextlost — page decides remount vs fallback.
   * `hidden` means tab/offscreen/covered; do not fallback, remount when visible.
   */
  onContextLost?: (info: { hidden: boolean }) => void;
  /** False while minimap is under fullscreen or tab is display:none. */
  isSurfaceVisible?: () => boolean;
  onViewIdle?: (view: { lat: number; lng: number; level: number }) => void;
  /**
   * Capacitor: corner credit opens the data-attribution modal.
   * Web: omit — OpenMapTiles / OSM names link to official pages.
   */
  onAttributionClick?: () => void;
};

function isElementVisiblyMapped(el: HTMLElement | null | undefined): boolean {
  if (!el || !el.isConnected) return false;
  let node: HTMLElement | null = el;
  while (node) {
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    node = node.parentElement;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function searchPinSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
  <circle cx="14" cy="14" r="9" fill="${MAP_BRAND_NAVY}" stroke="#ffffff" stroke-width="3"/>
</svg>`;
}

export class MapLibreMapAdapter implements CompactMapSurface, ExpandedMapSurface {
  private theme: AdminMapLibreThemeId = "paper";
  readonly provider = "maplibre" as const;
  private map: MlMap | null = null;
  private destroyed = false;
  /** Set before map.remove() so intentional WEBGL_lose_context is not a fallback. */
  private intentionalDestroy = false;
  private pins: CompactPinInput[] = [];
  private selectedPinId: string | null = null;
  /** DOM photo / badge overlays — expanded mode, refreshed on moveend only. */
  private photoMarkers = new Map<string, maplibregl.Marker>();
  private photoFailedIds = new Set<string>();
  private fallbackTimer: number | null = null;
  private firstTileSeen = false;
  private styleReady = false;
  private touchCleanups: Array<() => void> = [];
  private contextLostHandler: ((ev: Event) => void) | null = null;
  private containerEl: HTMLElement | null = null;
  private isSurfaceVisibleFn: (() => boolean) | null = null;
  private onContextLostCb: ((info: { hidden: boolean }) => void) | null = null;
  private onPinClick: ((id: string) => void) | null = null;
  private onSearchPinClick: ((id: string) => void) | null = null;
  private onCourseStopClick: ((id: string) => void) | null = null;
  private onDiscoverPinClick: ((id: string) => void) | null = null;
  private onMapClickEmpty: (() => void) | null = null;
  private onViewIdle: ((view: { lat: number; lng: number; level: number }) => void) | null =
    null;
  private onAttributionClick: (() => void) | null = null;
  private imageDpr = 2;
  private mode: "compact" | "expanded" = "compact";
  private mountStartedAt = 0;
  private fallbackReported = false;
  private courseSelectedOrder: number | null = null;
  /** Context lost while hidden — page should remount when surface is shown again. */
  pendingHiddenContextLost = false;

  static async create(
    options: CreateCompactMapLibreOptions,
  ): Promise<MapLibreMapAdapter> {
    const adapter = new MapLibreMapAdapter();
    adapter.mode = options.mode ?? "compact";
    adapter.theme = options.theme === "neon" ? "neon" : "paper";
    adapter.onPinClick = options.onPinClick ?? null;
    adapter.onSearchPinClick = options.onSearchPinClick ?? null;
    adapter.onCourseStopClick = options.onCourseStopClick ?? null;
    adapter.onDiscoverPinClick = options.onDiscoverPinClick ?? null;
    adapter.onMapClickEmpty = options.onMapClickEmpty ?? null;
    adapter.onViewIdle = options.onViewIdle ?? null;
    adapter.onAttributionClick = options.onAttributionClick ?? null;
    await adapter.mount(options);
    return adapter;
  }

  private reportFallback(
    options: CreateCompactMapLibreOptions,
    reason:
      | "style_timeout"
      | "style_error"
      | "tile_timeout"
      | "webgl_unsupported"
      | "error"
      | "webglcontextlost",
  ) {
    if (this.fallbackReported || this.destroyed) return;
    this.fallbackReported = true;
    trackMapGlFallback(this.mode, reason);
    options.onFallback?.(reason);
  }

  private surfaceIsVisible(): boolean {
    if (this.isSurfaceVisibleFn) {
      try {
        return this.isSurfaceVisibleFn();
      } catch {
        return false;
      }
    }
    return isElementVisiblyMapped(this.containerEl);
  }

  private async mount(options: CreateCompactMapLibreOptions) {
    this.mountStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.containerEl = options.container;
    this.isSurfaceVisibleFn = options.isSurfaceVisible ?? null;
    this.onContextLostCb = options.onContextLost ?? null;
    prefetchSubwayOverlay();
    const style = await buildPindmapStyle(this.theme);
    if (this.destroyed || this.intentionalDestroy) return;

    const dpr =
      typeof window !== "undefined"
        ? clampMapPinDpr(window.devicePixelRatio || 1)
        : 1;

    this.imageDpr = dpr;

    // Drop any other live MapLibre GL before creating a second context (iOS budget).
    claimMapGlSlot(this.mode, () => {
      if (!this.destroyed && !this.intentionalDestroy) this.destroy();
    });

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
    const canvas = map.getCanvas();
    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      if (this.intentionalDestroy || this.destroyed) return;
      const hidden = !this.surfaceIsVisible();
      if (hidden) {
        this.pendingHiddenContextLost = true;
        this.onContextLostCb?.({ hidden: true });
        return;
      }
      if (this.onContextLostCb) {
        this.onContextLostCb({ hidden: false });
        return;
      }
      this.reportFallback(options, "webglcontextlost");
    };
    this.contextLostHandler = onContextLost;
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    this.touchCleanups.push(() => {
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      if (this.contextLostHandler === onContextLost) this.contextLostHandler = null;
    });
    map.on("moveend", () => {
      if (this.destroyed || !this.map) return;
      const c = this.map.getCenter();
      this.onViewIdle?.({
        lat: c.lat,
        lng: c.lng,
        level: mapLibreZoomToKakaoLevel(this.map.getZoom()),
      });
      this.refreshPhotoPins();
      this.pushPinGeoJson();
    });

    this.fallbackTimer = window.setTimeout(() => {
      if (this.destroyed) return;
      if (!this.styleReady || !this.firstTileSeen) {
        this.reportFallback(
          options,
          !this.styleReady ? "style_timeout" : "tile_timeout",
        );
      }
    }, FIRST_TILE_TIMEOUT_MS);

    map.on("error", (ev) => {
      if (this.styleReady || this.destroyed || this.fallbackReported) return;
      const msg = String(
        (ev as { error?: { message?: string } })?.error?.message ?? "",
      );
      // Style validation / parse failures never fire `load` — record style_error (no message/URL in meta).
      if (
        /layers\[|unknown property|source|style|Failed to load/i.test(msg)
      ) {
        invalidateLibertyStyleCache();
        this.reportFallback(options, "style_error");
      }
    });
    map.on("sourcedata", (e) => {
      if (
        e.dataType === "source" &&
        e.isSourceLoaded &&
        e.sourceId !== PIN_SOURCE &&
        e.sourceId !== "korea_gu_labels" &&
        e.sourceId !== "pindmap_subway"
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
          const ms =
            (typeof performance !== "undefined" ? performance.now() : Date.now()) -
            this.mountStartedAt;
          trackMapGlReady(this.mode, ms);
          options.onReady?.();
          // Subway overlay: after first paint; failure must not affect the map.
          const theme = this.theme;
          const mapRef = this.map;
          void attachSubwayOverlay(mapRef, theme).catch(() => {});
        } catch {
          this.reportFallback(options, "error");
        }
      })();
    });
  }

  private installAttribution(container: HTMLElement) {
    const base =
      this.mode === "expanded"
        ? "expandedMapLibreAttrib"
        : "compactMapLibreAttrib";
    const className = this.theme === "neon" ? `${base} is-neon` : base;
    const cleanup = installMapLibreCornerAttribution(container, {
      className,
      onClick: this.onAttributionClick ?? undefined,
    });
    this.touchCleanups.push(cleanup);
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
      id: ROUTE_GLOW_OUTER_LAYER,
      type: "line",
      source: ROUTE_SOURCE,
      layout: { ...ROUTE_LAYOUT, visibility: "none" },
      paint: {
        "line-color": MAP_NEON_ACCENT,
        "line-width": 17,
        "line-opacity": 0.35,
        "line-blur": 12,
      },
    });
    map.addLayer({
      id: ROUTE_GLOW_MID_LAYER,
      type: "line",
      source: ROUTE_SOURCE,
      layout: { ...ROUTE_LAYOUT, visibility: "none" },
      paint: {
        "line-color": MAP_NEON_ACCENT,
        "line-width": 9,
        "line-opacity": 0.6,
        "line-blur": 4,
      },
    });
    map.addLayer({
      id: ROUTE_CASING_LAYER,
      type: "line",
      source: ROUTE_SOURCE,
      layout: { ...ROUTE_LAYOUT },
      paint: {
        "line-color": "#FFFFFF",
        "line-width": 7,
        "line-opacity": 0.95,
      },
    });
    map.addLayer({
      id: ROUTE_LAYER,
      type: "line",
      source: ROUTE_SOURCE,
      layout: { ...ROUTE_LAYOUT },
      paint: {
        "line-color": MAP_BRAND_NAVY,
        "line-width": 3,
        "line-opacity": 1,
      },
    });
    map.addSource(ROUTE_ORIGIN_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "compact-route-origin-shadow",
      type: "circle",
      source: ROUTE_ORIGIN_SOURCE,
      paint: {
        "circle-radius": this.theme === "neon" ? 12 : 9,
        "circle-color": this.theme === "neon" ? MAP_NEON_ACCENT : "#000000",
        "circle-opacity": this.theme === "neon" ? 0.45 : 0.18,
        "circle-blur": this.theme === "neon" ? 0.85 : 0.55,
      },
    });
    map.addLayer({
      id: ROUTE_ORIGIN_LAYER,
      type: "circle",
      source: ROUTE_ORIGIN_SOURCE,
      paint: {
        "circle-radius": 7,
        "circle-color": this.theme === "neon" ? MAP_NEON_CLUSTER_FILL : "#FFFFFF",
        "circle-stroke-width": this.theme === "neon" ? 3.5 : 3,
        "circle-stroke-color": this.theme === "neon" ? MAP_NEON_ACCENT : MAP_BRAND_NAVY,
        "circle-opacity": 1,
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

    // Discover (admin) — below saved pins; WebGL only
    const neon = this.theme === "neon";
    map.addSource(DISCOVER_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: DISCOVER_CIRCLE_LAYER,
      type: "circle",
      source: DISCOVER_SOURCE,
      minzoom: DISCOVER_MIN_ZOOM,
      paint: {
        "circle-radius": [
          "match",
          ["get", "tier"],
          1,
          4,
          2,
          5.5,
          3,
          7,
          4,
        ],
        "circle-color": "#ffffff",
        "circle-stroke-width": neon ? 2.25 : 2,
        "circle-stroke-color": neon ? MAP_NEON_ACCENT : MAP_BRAND_NAVY,
        "circle-opacity": neon ? 0.92 : 0.95,
      },
    });
    map.addLayer({
      id: DISCOVER_LABEL_HOT_LAYER,
      type: "symbol",
      source: DISCOVER_SOURCE,
      minzoom: 14,
      filter: [">=", ["get", "user_count"], 10],
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-max-width": 8,
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": neon ? "#C9CEF5" : "#3A4155",
        "text-halo-color": neon ? "#0E1230" : "#ffffff",
        "text-halo-width": 1.35,
      },
    });
    map.addLayer({
      id: DISCOVER_LABEL_REST_LAYER,
      type: "symbol",
      source: DISCOVER_SOURCE,
      minzoom: 15,
      filter: ["<", ["get", "user_count"], 10],
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10.5,
        "text-offset": [0, 1.05],
        "text-anchor": "top",
        "text-max-width": 8,
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": neon ? "#C9CEF5" : "#3A4155",
        "text-halo-color": neon ? "#0E1230" : "#ffffff",
        "text-halo-width": 1.25,
      },
    });

    map.addSource(PIN_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterRadius: CLUSTER_RADIUS,
      promoteId: "id",
    });
    map.addLayer({
      id: PIN_CLUSTER_LAYER,
      type: "circle",
      source: PIN_SOURCE,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": this.theme === "neon" ? MAP_NEON_CLUSTER_FILL : MAP_BRAND_NAVY,
        "circle-radius": ["step", ["get", "point_count"], 16, 8, 20, 25, 26],
        "circle-stroke-width": this.theme === "neon" ? 2.5 : 2,
        "circle-stroke-color": this.theme === "neon" ? MAP_NEON_ACCENT : "#ffffff",
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
    // NOTE: feature-state is paint-only in MapLibre — using it in layout rejects the layer
    // (pins vanish; clusters still show). Selected scale uses GeoJSON property `selected`.
    map.addLayer({
      id: PIN_LAYER,
      type: "symbol",
      source: PIN_SOURCE,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": [
          "case",
          ["==", ["get", "selected"], 1],
          MAP_PIN_ICON_SIZE * SELECTED_PIN_SCALE,
          MAP_PIN_ICON_SIZE,
        ],
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        // Let major city labels compete for placement (서울 etc.)
        "icon-ignore-placement": false,
        "symbol-z-order": "source",
        "symbol-sort-key": [
          "case",
          ["==", ["get", "selected"], 1],
          10,
          0,
        ],
      },
      paint: {
        "icon-opacity": [
          "case",
          ["==", ["get", "closed"], 1],
          0.45,
          1,
        ],
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
      id: "compact-course-circle-shadow",
      type: "circle",
      source: COURSE_SOURCE,
      paint: {
        "circle-radius": [
          "case",
          ["==", ["get", "selected"], 1],
          neon ? 22 : 18,
          neon ? 17 : 15,
        ],
        "circle-color": neon ? MAP_NEON_ACCENT : "#000000",
        "circle-opacity": neon ? 0.4 : 0.16,
        "circle-blur": neon ? 0.75 : 0.45,
      },
    });
    map.addLayer({
      id: COURSE_CIRCLE_LAYER,
      type: "circle",
      source: COURSE_SOURCE,
      paint: {
        "circle-radius": [
          "case",
          ["==", ["get", "selected"], 1],
          16,
          13,
        ],
        "circle-color": neon ? MAP_NEON_CLUSTER_FILL : MAP_BRAND_NAVY,
        "circle-stroke-width": neon ? 2.5 : 2,
        "circle-stroke-color": neon ? MAP_NEON_ACCENT : "#ffffff",
        "circle-opacity": 1,
      },
    });
    map.addLayer({
      id: COURSE_NUMBER_LAYER,
      type: "symbol",
      source: COURSE_SOURCE,
      layout: {
        "text-field": ["to-string", ["get", "order"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": [
          "case",
          ["==", ["get", "selected"], 1],
          14,
          12,
        ],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": neon ? MAP_NEON_CORE : "#ffffff" },
    });
    map.addLayer({
      id: COURSE_LABEL_LAYER,
      type: "symbol",
      source: COURSE_SOURCE,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-offset": [0, 1.7],
        "text-anchor": "top",
        "text-max-width": 9,
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": neon ? "#C9CEF5" : "#3A4155",
        "text-halo-color": neon ? "#0E1230" : "#ffffff",
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
      const hitLayers = [
        PIN_LAYER,
        FOCUS_LAYER,
        SEARCH_LAYER,
        COURSE_CIRCLE_LAYER,
        DISCOVER_CIRCLE_LAYER,
      ].filter((id) => Boolean(map.getLayer(id)));
      const feats = map.queryRenderedFeatures(bbox, { layers: hitLayers });
      if (feats.length > 0) {
        const priority = new Set([
          PIN_LAYER,
          FOCUS_LAYER,
          SEARCH_LAYER,
          COURSE_CIRCLE_LAYER,
        ]);
        const preferred = feats.filter((f) => priority.has(f.layer?.id ?? ""));
        const pool = preferred.length > 0 ? preferred : feats;
        let bestId: string | null = null;
        let bestLayer: string | null = null;
        let bestD = Infinity;
        for (const f of pool) {
          const id = f.properties?.id;
          if (typeof id !== "string" && typeof id !== "number") continue;
          const idStr = String(id);
          if (f.geometry.type !== "Point") continue;
          const coords = f.geometry.coordinates as [number, number];
          const projected = map.project(coords);
          const d =
            (projected.x - e.point.x) ** 2 + (projected.y - e.point.y) ** 2;
          if (d < bestD) {
            bestD = d;
            bestId = idStr;
            bestLayer = f.layer?.id ?? null;
          }
        }
        if (bestId) {
          if (bestLayer === SEARCH_LAYER) this.onSearchPinClick?.(bestId);
          else if (bestLayer === COURSE_CIRCLE_LAYER) this.onCourseStopClick?.(bestId);
          else if (bestLayer === DISCOVER_CIRCLE_LAYER) this.onDiscoverPinClick?.(bestId);
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
    map.on("mouseenter", DISCOVER_CIRCLE_LAYER, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", DISCOVER_CIRCLE_LAYER, () => {
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
    padding?: { top: number; right: number; bottom: number; left: number },
  ) {
    const pad =
      padding ??
      (this.mode === "expanded"
        ? EXPANDED_ROUTE_FIT_PADDING
        : COMPACT_ROUTE_FIT_PADDING);
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
    map.fitBounds(bounds, { padding: pad, maxZoom: 16, duration: 0 });
  }

  setPins(pins: CompactPinInput[]) {
    this.pins = pins;
    void this.applyPins(pins);
  }

  setSelectedPinId(pinId: string | null) {
    this.selectedPinId = pinId && pinId.trim() ? pinId.trim() : null;
    // Refresh GeoJSON `selected` prop (layout cannot use feature-state).
    this.pushPinGeoJson();
    this.syncPhotoMarkerSelectedStyle();
  }

  /** Update pin GeoJSON only (no image reload). */
  private pushPinGeoJson() {
    const map = this.map;
    if (!map?.getSource(PIN_SOURCE)) return;
    const zoomOk = map.getZoom() >= SELECTED_PIN_MIN_ZOOM;
    const src = map.getSource(PIN_SOURCE) as GeoJSONSource;
    src.setData({
      type: "FeatureCollection",
      features: this.pins.map((p) => ({
        type: "Feature" as const,
        id: p.id,
        properties: {
          id: p.id,
          icon:
            pinImageKey("pin", p.category, p.fillColor) +
            (this.theme === "neon" ? ":neon" : ""),
          name: p.name ?? "",
          closed: p.closed ? 1 : 0,
          selected:
            zoomOk && this.selectedPinId && p.id === this.selectedPinId
              ? 1
              : 0,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [p.lng, p.lat],
        },
      })),
    });
  }

  private syncPhotoMarkerSelectedStyle() {
    for (const [id, marker] of this.photoMarkers) {
      const el = marker.getElement();
      if (id === this.selectedPinId && (this.map?.getZoom() ?? 0) >= SELECTED_PIN_MIN_ZOOM) {
        el.classList.add("is-selected");
        el.style.zIndex = "3";
      } else {
        el.classList.remove("is-selected");
        el.style.zIndex = "";
      }
    }
  }

  private clearPhotoPins() {
    for (const marker of this.photoMarkers.values()) {
      try {
        marker.remove();
      } catch {
        /* noop */
      }
    }
    this.photoMarkers.clear();
    this.applyPhotoHideFilter([]);
  }

  private applyPhotoHideFilter(photoIds: string[]) {
    const map = this.map;
    if (!map?.getLayer(PIN_LAYER)) return;
    if (photoIds.length === 0) {
      map.setFilter(PIN_LAYER, ["!", ["has", "point_count"]]);
      return;
    }
    map.setFilter(PIN_LAYER, [
      "all",
      ["!", ["has", "point_count"]],
      ["!", ["in", ["get", "id"], ["literal", photoIds]]],
    ]);
  }

  private formatPostCountBadge(count: number): string {
    if (count > 99) return "99+";
    return String(count);
  }

  private createPhotoMarkerEl(pin: CompactPinInput, mode: "photo" | "badge"): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = mode === "photo" ? "mlPhotoPin" : "mlPhotoPinBadgeOnly";
    if (pin.closed) el.classList.add("is-closed");
    el.setAttribute("aria-label", pin.name?.trim() || "장소");
    if (mode === "photo" && pin.photoUrl) {
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.loading = "lazy";
      img.draggable = false;
      img.src = pin.photoUrl;
      img.onerror = () => {
        this.photoFailedIds.add(pin.id);
        const existing = this.photoMarkers.get(pin.id);
        if (existing) {
          try {
            existing.remove();
          } catch {
            /* noop */
          }
          this.photoMarkers.delete(pin.id);
        }
        this.applyPhotoHideFilter([...this.photoMarkers.keys()].filter((id) => {
          const p = this.pins.find((x) => x.id === id);
          return Boolean(p?.photoUrl) && !this.photoFailedIds.has(id);
        }));
        // Retry as badge-only if postCount remains
        if ((pin.postCount ?? 0) > 0) {
          this.refreshPhotoPins();
        }
      };
      el.appendChild(img);
    }
    if ((pin.postCount ?? 0) > 0) {
      const badge = document.createElement("span");
      badge.className = "mlPhotoPinBadge";
      badge.textContent = this.formatPostCountBadge(pin.postCount!);
      el.appendChild(badge);
    }
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.onPinClick?.(pin.id);
    });
    return el;
  }

  /** Expanded admin: photo pins at z≥14 (max 30 in view); badge when postCount>0. */
  private refreshPhotoPins() {
    const map = this.map;
    if (!map || this.destroyed) return;
    if (this.mode !== "expanded") {
      this.clearPhotoPins();
      return;
    }
    const z = map.getZoom();
    if (z < PHOTO_PIN_MIN_ZOOM) {
      this.clearPhotoPins();
      return;
    }
    const bounds = map.getBounds();
    const center = map.getCenter();
    const dist2 = (p: CompactPinInput) =>
      (p.lat - center.lat) ** 2 + (p.lng - center.lng) ** 2;

    const inView = this.pins.filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        bounds.contains([p.lng, p.lat]),
    );

    const photoCandidates = inView
      .filter(
        (p) =>
          typeof p.photoUrl === "string" &&
          p.photoUrl.trim() &&
          !this.photoFailedIds.has(p.id),
      )
      .sort((a, b) => {
        if (a.id === this.selectedPinId) return -1;
        if (b.id === this.selectedPinId) return 1;
        return dist2(a) - dist2(b);
      })
      .slice(0, PHOTO_PIN_MAX);

    const photoIds = new Set(photoCandidates.map((p) => p.id));

    // Badge-only for postCount>0 pins without a photo overlay (same 30 budget leftover).
    const badgeSlots = Math.max(0, PHOTO_PIN_MAX - photoCandidates.length);
    const badgeCandidates =
      badgeSlots === 0
        ? []
        : inView
            .filter(
              (p) =>
                !photoIds.has(p.id) &&
                typeof p.postCount === "number" &&
                p.postCount > 0,
            )
            .sort((a, b) => {
              if (a.id === this.selectedPinId) return -1;
              if (b.id === this.selectedPinId) return 1;
              return dist2(a) - dist2(b);
            })
            .slice(0, badgeSlots);

    const desired = new Map<string, { pin: CompactPinInput; mode: "photo" | "badge" }>();
    for (const p of photoCandidates) desired.set(p.id, { pin: p, mode: "photo" });
    for (const p of badgeCandidates) desired.set(p.id, { pin: p, mode: "badge" });

    for (const [id, marker] of [...this.photoMarkers.entries()]) {
      if (!desired.has(id)) {
        try {
          marker.remove();
        } catch {
          /* noop */
        }
        this.photoMarkers.delete(id);
      }
    }

    for (const [id, { pin, mode }] of desired) {
      const existing = this.photoMarkers.get(id);
      if (existing) {
        existing.setLngLat([pin.lng, pin.lat]);
        const el = existing.getElement();
        const wantPhoto = mode === "photo";
        const isPhoto = el.classList.contains("mlPhotoPin");
        if (wantPhoto !== isPhoto) {
          try {
            existing.remove();
          } catch {
            /* noop */
          }
          this.photoMarkers.delete(id);
        } else {
          el.classList.toggle("is-closed", Boolean(pin.closed));
          const badgeEl = el.querySelector(".mlPhotoPinBadge");
          if ((pin.postCount ?? 0) > 0) {
            if (badgeEl) {
              badgeEl.textContent = this.formatPostCountBadge(pin.postCount!);
            } else {
              const badge = document.createElement("span");
              badge.className = "mlPhotoPinBadge";
              badge.textContent = this.formatPostCountBadge(pin.postCount!);
              el.appendChild(badge);
            }
          } else if (badgeEl) {
            badgeEl.remove();
          }
          continue;
        }
      }
      if (this.photoMarkers.has(id)) continue;
      const el = this.createPhotoMarkerEl(pin, mode);
      const marker = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
      })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
      this.photoMarkers.set(id, marker);
    }

    this.applyPhotoHideFilter([...photoIds]);
    this.syncPhotoMarkerSelectedStyle();
  }

  private async applyPins(pins: CompactPinInput[]) {
    const map = this.map;
    if (!map?.getSource(PIN_SOURCE)) return;
    const pinOpts =
      this.theme === "neon"
        ? { stroke: "#ffffff", strokeWidth: 1.5, glow: true }
        : undefined;
    await Promise.all(
      pins.map((p) =>
        loadMapImageFromSvg(
          map,
          pinImageKey("pin", p.category, p.fillColor) + (this.theme === "neon" ? ":neon" : ""),
          pinMarkerSvg(p.category, p.fillColor, pinOpts),
          MAP_PIN_WIDTH,
          MAP_PIN_HEIGHT,
          this.imageDpr,
        ),
      ),
    );
    if (this.destroyed || !this.map) return;
    this.pushPinGeoJson();
    this.refreshPhotoPins();
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
    this.applyRoutePaint(mode);
    (map.getSource(ROUTE_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { mode },
          geometry: {
            type: "LineString",
            coordinates: path.map((p) => [p.lng, p.lat]),
          },
        },
      ],
    });
    // Origin endpoint (destination = focus pin, managed separately)
    if (mode === "preview") {
      this.clearRouteOrigin();
    } else {
      const start = path[0]!;
      this.setRouteOrigin(start.lat, start.lng);
    }
  }

  private applyRoutePaint(mode: CompactRouteMode) {
    const map = this.map;
    if (!map) return;
    const visual = routePaintForMode(mode, this.theme);

    const applyGlow = (
      layerId: string,
      paint: {
        color: string;
        opacity: number;
        width: unknown;
        dasharray: number[] | null;
        blur?: number;
      } | null,
    ) => {
      if (!map.getLayer(layerId)) return;
      if (!paint) {
        map.setLayoutProperty(layerId, "visibility", "none");
        return;
      }
      map.setLayoutProperty(layerId, "visibility", "visible");
      map.setPaintProperty(layerId, "line-color", paint.color);
      map.setPaintProperty(layerId, "line-opacity", paint.opacity);
      map.setPaintProperty(layerId, "line-width", paint.width);
      map.setPaintProperty(layerId, "line-blur", paint.blur ?? 0);
      try {
        map.setPaintProperty(layerId, "line-dasharray", paint.dasharray ?? [1, 0]);
      } catch {
        /* ignore */
      }
    };

    applyGlow(ROUTE_GLOW_OUTER_LAYER, visual.glowOuter);
    applyGlow(ROUTE_GLOW_MID_LAYER, visual.glowMid);

    if (map.getLayer(ROUTE_CASING_LAYER)) {
      if (visual.casing) {
        map.setLayoutProperty(ROUTE_CASING_LAYER, "visibility", "visible");
        map.setPaintProperty(ROUTE_CASING_LAYER, "line-color", visual.casing.color);
        map.setPaintProperty(ROUTE_CASING_LAYER, "line-opacity", visual.casing.opacity);
        map.setPaintProperty(ROUTE_CASING_LAYER, "line-width", visual.casing.width);
      } else {
        map.setLayoutProperty(ROUTE_CASING_LAYER, "visibility", "none");
      }
    }
    if (map.getLayer(ROUTE_LAYER)) {
      map.setPaintProperty(ROUTE_LAYER, "line-color", visual.line.color);
      map.setPaintProperty(ROUTE_LAYER, "line-opacity", visual.line.opacity);
      map.setPaintProperty(ROUTE_LAYER, "line-width", visual.line.width);
      try {
        map.setPaintProperty(ROUTE_LAYER, "line-blur", visual.line.blur ?? 0);
      } catch {
        /* ignore */
      }
      if (visual.line.dasharray) {
        map.setPaintProperty(ROUTE_LAYER, "line-dasharray", visual.line.dasharray);
      } else {
        try {
          map.setPaintProperty(ROUTE_LAYER, "line-dasharray", [1, 0]);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private setRouteOrigin(lat: number, lng: number) {
    const map = this.map;
    if (!map?.getSource(ROUTE_ORIGIN_SOURCE)) return;
    (map.getSource(ROUTE_ORIGIN_SOURCE) as GeoJSONSource).setData({
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

  private clearRouteOrigin() {
    const map = this.map;
    if (!map?.getSource(ROUTE_ORIGIN_SOURCE)) return;
    (map.getSource(ROUTE_ORIGIN_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  clearRoute() {
    const map = this.map;
    if (!map?.getSource(ROUTE_SOURCE)) return;
    (map.getSource(ROUTE_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [],
    });
    this.clearRouteOrigin();
  }

  setFocusMarker(pin: CompactPinInput) {
    void this.applyFocusMarker(pin);
  }

  private async applyFocusMarker(pin: CompactPinInput) {
    const map = this.map;
    if (!map?.getSource(FOCUS_SOURCE)) return;
    const icon = pinImageKey("focus", pin.category, pin.fillColor) + (this.theme === "neon" ? ":neon" : "");
    await loadMapImageFromSvg(
      map,
      icon,
      focusMarkerSvg(
        pin.category,
        pin.fillColor,
        this.theme === "neon" ? { stroke: "#ffffff", glow: true } : undefined,
      ),
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

  easeToView(lat: number, lng: number, kakaoLevel: number) {
    this.map?.easeTo({
      center: [lng, lat],
      zoom: kakaoLevelToMapLibreZoom(kakaoLevel),
      duration: 520,
    });
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

  setDiscoverPins(pins: DiscoverPinInput[]) {
    const map = this.map;
    if (!map?.getSource(DISCOVER_SOURCE)) return;
    const features = pins
      .filter(
        (p) =>
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lng) &&
          Number.isFinite(p.poiId) &&
          p.userCount >= 3,
      )
      .map((p) => {
        const tier = p.userCount >= 10 ? 3 : p.userCount >= 5 ? 2 : 1;
        return {
          type: "Feature" as const,
          id: p.poiId,
          properties: {
            id: String(p.poiId),
            name: (p.name || "").trim(),
            user_count: p.userCount,
            tier,
            category: p.category ?? "",
          },
          geometry: {
            type: "Point" as const,
            coordinates: [p.lng, p.lat],
          },
        };
      });
    (map.getSource(DISCOVER_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features,
    });
  }

  clearDiscoverPins() {
    this.setDiscoverPins([]);
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

  setCourseStops(stops: CourseStopInput[], opts?: SetCourseStopsOptions) {
    this.courseSelectedOrder =
      opts?.selectedOrder == null ? null : opts.selectedOrder;
    this.applyCourseStops(stops);
  }

  private applyCourseStops(stops: CourseStopInput[]) {
    const map = this.map;
    if (!map?.getSource(COURSE_SOURCE)) return;
    const selected = this.courseSelectedOrder;
    (map.getSource(COURSE_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: stops.map((s) => ({
        type: "Feature",
        properties: {
          id: s.id,
          name: s.name,
          order: s.order,
          selected: selected != null && s.order === selected ? 1 : 0,
        },
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      })),
    });
  }

  clearCourseStops() {
    const map = this.map;
    if (!map?.getSource(COURSE_SOURCE)) return;
    this.courseSelectedOrder = null;
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
    // Prefer setRoute(mode). This remains for rare overrides (hides casing if gray preview).
    if (opts.color) map.setPaintProperty(ROUTE_LAYER, "line-color", opts.color);
    if (opts.width != null) map.setPaintProperty(ROUTE_LAYER, "line-width", opts.width);
    if (opts.dasharray) {
      map.setPaintProperty(ROUTE_LAYER, "line-dasharray", opts.dasharray);
    }
    if (opts.opacity != null) {
      map.setPaintProperty(ROUTE_LAYER, "line-opacity", opts.opacity);
    }
    if (opts.color && opts.color.toLowerCase() === "#b5bac6") {
      if (map.getLayer(ROUTE_CASING_LAYER)) {
        map.setLayoutProperty(ROUTE_CASING_LAYER, "visibility", "none");
      }
      if (map.getLayer(ROUTE_GLOW_OUTER_LAYER)) {
        map.setLayoutProperty(ROUTE_GLOW_OUTER_LAYER, "visibility", "none");
      }
      if (map.getLayer(ROUTE_GLOW_MID_LAYER)) {
        map.setLayoutProperty(ROUTE_GLOW_MID_LAYER, "visibility", "none");
      }
      this.clearRouteOrigin();
    }
  }

  destroy() {
    // Mark intentional teardown BEFORE remove — MapLibre calls WEBGL_lose_context on remove.
    this.intentionalDestroy = true;
    this.destroyed = true;
    this.clearPhotoPins();
    this.photoFailedIds.clear();
    this.selectedPinId = null;
    if (this.fallbackTimer != null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    // Detach contextlost listener before map.remove() so intentional loss is ignored.
    const canvas = this.map?.getCanvas?.();
    if (canvas && this.contextLostHandler) {
      try {
        canvas.removeEventListener("webglcontextlost", this.contextLostHandler, false);
      } catch {
        /* noop */
      }
      this.contextLostHandler = null;
    }
    for (const off of this.touchCleanups) off();
    this.touchCleanups = [];
    releaseMapGlSlot(this.mode);
    try {
      this.map?.remove();
    } catch {
      /* noop */
    }
    this.map = null;
    this.containerEl = null;
  }
}
