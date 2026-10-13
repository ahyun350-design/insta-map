"use client";

import { useEffect, useRef } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MlMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  DEFAULT_CATEGORY_PIN,
  resolvePinColor,
} from "@/lib/categoryAppearance";
import {
  MAP_PIN_HEIGHT,
  MAP_PIN_ICON_SIZE,
  MAP_PIN_WIDTH,
  clampMapPinDpr,
  loadMapImageFromSvg,
  pinMarkerSvg,
} from "@/lib/mapPinImages";
import type { FeedPostCategory } from "@/lib/feedPost";
import {
  buildLitePreviewStyle,
  buildPindmapStyle,
  type MapPreviewThemeId,
} from "./buildStyle";
import { invalidateLibertyStyleCache } from "@/lib/pindmapMapStyle";
import {
  horizontalSpanKmForMapLibreZoom,
  kakaoLevelToMapLibreZoom,
  mapLibreZoomToKakaoLevel,
} from "@/lib/mapSurface/kakaoZoom";
import MapLibreCornerAttribution from "@/components/MapLibreCornerAttribution";
import {
  claimMapGlSlot,
  releaseMapGlSlot,
} from "@/lib/mapSurface/mapGlRecovery";
import {
  attachSubwayOverlay,
  prefetchSubwayOverlay,
} from "@/lib/mapSurface/subwayOverlay";
import { MAP_LOCAL_IDEOGRAPH_FONT_FAMILY } from "@/lib/mapSurface/mapBrand";
import {
  haversineMeters,
  prefetchZ14Around,
} from "@/lib/mapSurface/tilePrefetch";
import {
  paintPreviewRouteDemo,
  type PreviewRouteMode,
} from "./routeDemo";

export type PreviewPerfMode = "default" | "lite" | "nopins";

export type PreviewGlPin = {
  id: string;
  lng: number;
  lat: number;
  category: string;
  name?: string;
};

export type PreviewDiagnostics = {
  layerCount: number;
  firstLoadMs: number | null;
  tileLoadAvgMs: number | null;
  tileSampleCount: number;
  devicePixelRatio: number;
  mode: PreviewPerfMode;
};

type Props = {
  theme?: MapPreviewThemeId;
  mode: PreviewPerfMode;
  pins: PreviewGlPin[];
  cluster?: boolean;
  fitPadding?: number;
  singleZoom?: number;
  /** Imperative camera jump for style QA (zoom and/or center). */
  zoomJump?: {
    zoom?: number;
    center?: [number, number];
    token: number;
  } | null;
  /** Initial camera (e.g. last-known location). Defaults to Korea overview. */
  initialView?: { center: [number, number]; zoom: number } | null;
  /** Route style demo: walk | car | course (Seongsu fake path). */
  routeDemo?: PreviewRouteMode | null;
  /** Directions chrome compare: dark | paper (paint-only basemap). */
  routeTheme?: "dark" | "paper" | null;
  onReady?: () => void;
  onError?: (err: Error) => void;
  onPinClick?: (pinId: string) => void;
  onDiagnostics?: (d: PreviewDiagnostics) => void;
  onCompareSample?: (s: { zoom: number; widthKm: number; level: number }) => void;
};

const PIN_SOURCE = "preview-pins";
const FEED_CATS = Object.keys(DEFAULT_CATEGORY_PIN) as FeedPostCategory[];

/** /map-preview e2e only — never set on app home surfaces. */
export type PindmapPreviewMapDiag = {
  loadMs: number | null;
  styleLoadMs: number | null;
  /** Lab phase segments (ms). MapLibre is static-imported → jsMs=0. */
  jsMs: number | null;
  createMs: number | null;
  idleMs: number | null;
  pinsMs: number | null;
  /** Short codes only (no message text / URLs). */
  errorCodes: string[];
  layerIds: string[];
  hasSubwaySource: boolean;
  hasAttrib: boolean;
};

declare global {
  interface Window {
    __PINDMAP_PREVIEW_MAP__?: MlMap | null;
    __PINDMAP_PREVIEW_DIAG__?: PindmapPreviewMapDiag;
  }
}

function previewStyleErrorCode(msg: string): string {
  if (/unknown property/i.test(msg)) return "unknown_property";
  if (/layers\[/i.test(msg)) return "layer_spec";
  if (/Failed to load|style/i.test(msg)) return "style_load";
  return "map_error";
}

function publishPreviewDiag(partial: Partial<PindmapPreviewMapDiag>) {
  if (typeof window === "undefined") return;
  const prev = window.__PINDMAP_PREVIEW_DIAG__ ?? {
    loadMs: null,
    styleLoadMs: null,
    jsMs: null,
    createMs: null,
    idleMs: null,
    pinsMs: null,
    errorCodes: [],
    layerIds: [],
    hasSubwaySource: false,
    hasAttrib: false,
  };
  window.__PINDMAP_PREVIEW_DIAG__ = { ...prev, ...partial };
}

function pinSvg(category: string, neon = false) {
  return pinMarkerSvg(
    category,
    resolvePinColor(category),
    neon ? { stroke: "#ffffff", strokeWidth: 1.5, glow: true } : undefined,
  );
}

async function ensurePinImages(map: MlMap, neon = false) {
  const dpr = clampMapPinDpr(typeof window !== "undefined" ? window.devicePixelRatio : 2);
  const cats = new Set<string>(FEED_CATS);
  const suffix = neon ? "-neon" : "";
  await Promise.all(
    [...cats].map((cat) =>
      loadMapImageFromSvg(
        map,
        `pin-${cat}${suffix}`,
        pinSvg(cat, neon),
        MAP_PIN_WIDTH,
        MAP_PIN_HEIGHT,
        dpr,
      ),
    ),
  );
  await loadMapImageFromSvg(
    map,
    `pin-fallback${suffix}`,
    pinSvg("기타", neon),
    MAP_PIN_WIDTH,
    MAP_PIN_HEIGHT,
    dpr,
  );
}


function toGeoJson(pins: PreviewGlPin[]) {
  return {
    type: "FeatureCollection" as const,
    features: pins.map((p) => ({
      type: "Feature" as const,
      id: p.id,
      properties: {
        id: p.id,
        name: p.name ?? "",
        category: FEED_CATS.includes(p.category as FeedPostCategory)
          ? p.category
          : "fallback",
      },
      geometry: {
        type: "Point" as const,
        coordinates: [p.lng, p.lat],
      },
    })),
  };
}

function fitToPins(
  map: MlMap,
  pins: PreviewGlPin[],
  padding: number,
  singleZoom: number,
  fallbackView?: { center: [number, number]; zoom: number } | null,
) {
  if (pins.length === 0) {
    const v = fallbackView ?? { center: [127.8, 36.2] as [number, number], zoom: 6.2 };
    map.jumpTo({ center: v.center, zoom: v.zoom });
    return;
  }
  if (pins.length === 1) {
    map.jumpTo({
      center: [pins[0]!.lng, pins[0]!.lat],
      zoom: singleZoom,
    });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const p of pins) bounds.extend([p.lng, p.lat]);
  map.fitBounds(bounds, { padding, maxZoom: 12, duration: 0 });
}

function circleColorExpr(): unknown {
  const cases: unknown[] = ["match", ["get", "category"]];
  for (const cat of FEED_CATS) {
    cases.push(cat, DEFAULT_CATEGORY_PIN[cat].color);
  }
  cases.push("#1a2a7a");
  return cases;
}

function addPinLayers(
  map: MlMap,
  pins: PreviewGlPin[],
  cluster: boolean,
  mode: PreviewPerfMode,
  themeId: MapPreviewThemeId,
) {
  if (map.getLayer("preview-clusters")) map.removeLayer("preview-clusters");
  if (map.getLayer("preview-cluster-count")) map.removeLayer("preview-cluster-count");
  if (map.getLayer("preview-unclustered")) map.removeLayer("preview-unclustered");
  if (map.getLayer("preview-unclustered-circle")) {
    map.removeLayer("preview-unclustered-circle");
  }
  if (map.getSource(PIN_SOURCE)) map.removeSource(PIN_SOURCE);

  if (mode === "nopins" || pins.length === 0) return;

  map.addSource(PIN_SOURCE, {
    type: "geojson",
    data: toGeoJson(pins),
    cluster,
    clusterMaxZoom: 16,
    clusterRadius: 52,
  });

  const dark = themeId === "dark" || themeId === "black";
  const neon = themeId === "neon";

  map.addLayer({
    id: "preview-clusters",
    type: "circle",
    source: PIN_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": neon ? "#12183A" : dark ? "#555555" : "#1a2a7a",
      "circle-radius": ["step", ["get", "point_count"], 16, 5, 20, 12, 24],
      "circle-stroke-width": neon ? 2.5 : 2,
      "circle-stroke-color": neon
        ? "#F0E4C3"
        : dark
          ? "#0B0B0B"
          : "#ffffff",
    },
  });

  if (mode === "lite") {
    // Lite: circle only — no icon, no cluster text
    map.addLayer({
      id: "preview-unclustered-circle",
      type: "circle",
      source: PIN_SOURCE,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": circleColorExpr() as maplibregl.ExpressionSpecification,
        "circle-radius": 5,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
      },
    });
    return;
  }

  map.addLayer({
    id: "preview-cluster-count",
    type: "symbol",
    source: PIN_SOURCE,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
    },
    paint: { "text-color": "#ffffff" },
  });

  const pinSuffix = neon ? "-neon" : "";
  map.addLayer({
    id: "preview-unclustered",
    type: "symbol",
    source: PIN_SOURCE,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": [
        "case",
        ["==", ["get", "category"], "fallback"],
        `pin-fallback${pinSuffix}`,
        ["concat", "pin-", ["get", "category"], pinSuffix],
      ],
      "icon-size": MAP_PIN_ICON_SIZE,
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

function collectTileAvgMs(sinceMs: number): { avg: number | null; count: number } {
  if (typeof performance === "undefined" || !performance.getEntriesByType) {
    return { avg: null, count: 0 };
  }
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const tiles = entries.filter(
    (e) =>
      e.startTime >= sinceMs - 50 &&
      (/\.pbf(\?|$)/i.test(e.name) || /\/planet\//i.test(e.name)),
  );
  if (tiles.length === 0) return { avg: null, count: 0 };
  const sum = tiles.reduce((a, e) => a + (e.duration || 0), 0);
  return { avg: Math.round(sum / tiles.length), count: tiles.length };
}

export default function PreviewGlMap({
  theme = "paper",
  mode,
  pins,
  cluster = true,
  fitPadding = 40,
  singleZoom = 11,
  zoomJump = null,
  initialView = null,
  routeDemo = null,
  routeTheme = null,
  onReady,
  onError,
  onPinClick,
  onDiagnostics,
  onCompareSample,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const initialViewRef = useRef(initialView);
  initialViewRef.current = initialView;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const clusterRef = useRef(cluster);
  clusterRef.current = cluster;
  const routeDemoRef = useRef(routeDemo);
  routeDemoRef.current = routeDemo;
  const routeThemeRef = useRef(routeTheme);
  routeThemeRef.current = routeTheme;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;
  const onDiagRef = useRef(onDiagnostics);
  onDiagRef.current = onDiagnostics;
  const onCompareRef = useRef(onCompareSample);
  onCompareRef.current = onCompareSample;
  const handlersBound = useRef(false);
  const bootAtRef = useRef(0);

  useEffect(() => {
    if (!zoomJump) return;
    const map = mapRef.current;
    if (!map) return;
    const next: { zoom?: number; center?: [number, number] } = {};
    if (typeof zoomJump.zoom === "number") next.zoom = zoomJump.zoom;
    if (zoomJump.center) next.center = zoomJump.center;
    if (next.zoom != null || next.center) map.jumpTo(next);
  }, [zoomJump]);

  useEffect(() => {
    let cancelled = false;
    const el = rootRef.current;
    if (!el) return;
    const canvas = el.querySelector<HTMLElement>(".map-preview-gl-canvas");
    if (!canvas) return;

    bootAtRef.current = performance.now();
    const perfOrigin = performance.now();
    prefetchSubwayOverlay();

    (async () => {
      try {
        const style =
          modeRef.current === "lite"
            ? await buildLitePreviewStyle(themeRef.current)
            : await buildPindmapStyle(themeRef.current);
        if (cancelled) return;

        const dpr =
          typeof window !== "undefined"
            ? Math.min(window.devicePixelRatio || 1, modeRef.current === "lite" ? 2 : 3)
            : 1;

        claimMapGlSlot("preview", () => {
          try {
            mapRef.current?.remove();
          } catch {
            /* noop */
          }
          mapRef.current = null;
        });
        // Static import — JS already in page bundle when this effect runs.
        const jsMs = 0;
        const createT0 = performance.now();
        const bootView = initialViewRef.current ?? {
          center: [127.8, 36.2] as [number, number],
          zoom: 6.2,
        };
        const mapT0 = performance.now();
        (
          window as unknown as { __PINDMAP_PREVIEW_MAP_T0__?: number }
        ).__PINDMAP_PREVIEW_MAP_T0__ = mapT0;
        const map = new maplibregl.Map({
          container: canvas,
          style: style as StyleSpecification,
          center: bootView.center,
          zoom: bootView.zoom,
          attributionControl: false,
          interactive: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          pitch: 0,
          maxPitch: 0,
          // Labels pop in faster; 300ms fade made the basemap feel empty after jumps.
          fadeDuration: 0,
          antialias: modeRef.current !== "lite",
          renderWorldCopies: modeRef.current !== "lite",
          pixelRatio: dpr,
          localIdeographFontFamily: MAP_LOCAL_IDEOGRAPH_FONT_FAMILY,
        });
        const createMs = Math.round(performance.now() - createT0);
        mapRef.current = map;
        // E2E / QA hook — map-preview route only
        window.__PINDMAP_PREVIEW_MAP__ = map;
        // Register code icons ASAP (don't wait for `load`) so POI labels aren't blocked.
        void (async () => {
          try {
            const { ensurePoiCategoryIcons } = await import(
              "@/lib/mapSurface/poiCategoryIcons"
            );
            const { ensureKoreaLandmarkIcon } = await import(
              "@/lib/mapSurface/koreaLandmarkIcon"
            );
            await ensurePoiCategoryIcons(map);
            await ensureKoreaLandmarkIcon(map);
          } catch {
            /* load handler retries */
          }
        })();
        // e2e / QA: search-nav helpers (HTTP tile warm + fast camera)
        (
          window as unknown as {
            __PINDMAP_SEARCH_NAV__?: {
              prefetchZ14Around: typeof prefetchZ14Around;
              goToSearchResult: (
                lat: number,
                lng: number,
                kakaoLevel?: number,
              ) => void;
            };
          }
        ).__PINDMAP_SEARCH_NAV__ = {
          prefetchZ14Around,
          goToSearchResult: (lat, lng, kakaoLevel = 3) => {
            const zoom = kakaoLevelToMapLibreZoom(kakaoLevel);
            const c = map.getCenter();
            const dist = haversineMeters(c.lat, c.lng, lat, lng);
            if (dist <= 1000) {
              map.easeTo({ center: [lng, lat], zoom, duration: 300 });
              return;
            }
            map.jumpTo({ center: [lng, lat], zoom: Math.max(1, zoom - 1) });
            map.easeTo({ center: [lng, lat], zoom, duration: 200 });
          },
        };
        publishPreviewDiag({
          loadMs: null,
          styleLoadMs: null,
          jsMs,
          createMs,
          idleMs: null,
          pinsMs: null,
          errorCodes: [],
          layerIds: [],
          hasSubwaySource: false,
          hasAttrib: !!el.querySelector(
            "[data-testid='maplibre-corner-attribution']",
          ),
        });
        const mapCreatedAt = performance.now();
        let styleLoadAt: number | null = null;
        map.on("style.load", () => {
          styleLoadAt = performance.now();
          publishPreviewDiag({
            styleLoadMs: Math.round(styleLoadAt - mapCreatedAt),
          });
        });
        map.once("idle", () => {
          const idleAt = performance.now();
          const base = styleLoadAt ?? mapCreatedAt;
          publishPreviewDiag({
            idleMs: Math.round(idleAt - base),
          });
        });
        map.touchZoomRotate.disableRotation();
        const sampleCompare = () => {
          if (!onCompareRef.current) return;
          const c = map.getCanvas();
          const w = c.clientWidth || c.width || 0;
          if (!w) return;
          const zoom = map.getZoom();
          const lat = map.getCenter().lat;
          onCompareRef.current({
            zoom,
            widthKm: horizontalSpanKmForMapLibreZoom(zoom, lat, w),
            level: mapLibreZoomToKakaoLevel(zoom),
          });
        };
        map.on("moveend", sampleCompare);
        map.on("zoomend", sampleCompare);

        map.on("error", (ev) => {
          const msg = String(ev.error?.message ?? "");
          if (/ajax|tile|Failed to fetch/i.test(msg)) return;
          const code = previewStyleErrorCode(msg);
          const prev = window.__PINDMAP_PREVIEW_DIAG__?.errorCodes ?? [];
          publishPreviewDiag({ errorCodes: [...prev, code] });
          // Style validation failures never fire `load` — surface and drop liberty cache.
          if (/layers\[|unknown property|source|style/i.test(msg)) {
            invalidateLibertyStyleCache();
            onErrorRef.current?.(new Error(msg));
          }
        });

        map.on("load", () => {
          void (async () => {
            try {
              if (modeRef.current === "default") {
                await ensurePinImages(map, themeRef.current === "neon");
              }
              const { ensurePoiCategoryIcons } = await import(
                "@/lib/mapSurface/poiCategoryIcons"
              );
              const { ensureKoreaLandmarkIcon } = await import(
                "@/lib/mapSurface/koreaLandmarkIcon"
              );
              await ensurePoiCategoryIcons(map);
              await ensureKoreaLandmarkIcon(map);
              if (cancelled) return;
              const pinsT0 = performance.now();
              addPinLayers(
                map,
                pinsRef.current,
                clusterRef.current,
                modeRef.current,
                themeRef.current,
              );
              publishPreviewDiag({
                pinsMs: Math.round(performance.now() - pinsT0),
              });
              fitToPins(
                map,
                pinsRef.current,
                fitPadding,
                singleZoom,
                initialViewRef.current,
              );
              if (routeDemoRef.current) {
                await paintPreviewRouteDemo(
                  map,
                  routeDemoRef.current,
                  themeRef.current === "neon" ? "neon" : "paper",
                  routeThemeRef.current,
                );
              }

              if (!handlersBound.current) {
                handlersBound.current = true;
                map.on("click", "preview-clusters", (e) => {
                  const feat = e.features?.[0];
                  if (!feat || feat.geometry.type !== "Point") return;
                  const coords = feat.geometry.coordinates as [number, number];
                  const clusterId = feat.properties?.cluster_id as number | undefined;
                  if (clusterId == null) return;
                  const src = map.getSource(PIN_SOURCE) as GeoJSONSource;
                  void src.getClusterExpansionZoom(clusterId).then((z) => {
                    map.easeTo({ center: coords, zoom: z });
                  });
                });
                const onUnclustered = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
                  const id = e.features?.[0]?.properties?.id;
                  if (typeof id === "string") onPinClickRef.current?.(id);
                };
                map.on("click", "preview-unclustered", onUnclustered);
                map.on("click", "preview-unclustered-circle", onUnclustered);
              }

              const firstLoadMs = Math.round(performance.now() - bootAtRef.current);
              publishPreviewDiag({
                loadMs: Math.round(performance.now() - mapCreatedAt),
              });
              // Give tiles a short window then sample
              window.setTimeout(() => {
                if (cancelled) return;
                const tile = collectTileAvgMs(perfOrigin);
                const layerCount = map.getStyle()?.layers?.length ?? 0;
                onDiagRef.current?.({
                  layerCount,
                  firstLoadMs,
                  tileLoadAvgMs: tile.avg,
                  tileSampleCount: tile.count,
                  devicePixelRatio:
                    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
                  mode: modeRef.current,
                });
              }, 1200);

              sampleCompare();
              onReadyRef.current?.();
              void attachSubwayOverlay(map, themeRef.current)
                .then((ok) => {
                  if (cancelled || !mapRef.current) return;
                  const layerIds =
                    map.getStyle()?.layers?.map((l) => l.id) ?? [];
                  publishPreviewDiag({
                    layerIds,
                    hasSubwaySource: ok && !!map.getSource("pindmap_subway"),
                    hasAttrib: !!el.querySelector(
                      "[data-testid='maplibre-corner-attribution']",
                    ),
                  });
                  console.info("[PindMap:preview] post-load layers", {
                    landmark: layerIds.includes("landmark_label"),
                    subwayLine: layerIds.includes("subway_overlay_line"),
                    subwayExit: layerIds.includes("subway_overlay_exit"),
                    attrib: !!el.querySelector(
                      "[data-testid='maplibre-corner-attribution']",
                    ),
                  });
                })
                .catch(() => {});
            } catch (e) {
              onErrorRef.current?.(
                e instanceof Error ? e : new Error(String(e)),
              );
            }
          })();
        });
      } catch (e) {
        if (!cancelled) {
          onErrorRef.current?.(
            e instanceof Error ? e : new Error(String(e)),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      handlersBound.current = false;
      releaseMapGlSlot("preview");
      if (window.__PINDMAP_PREVIEW_MAP__ === mapRef.current) {
        window.__PINDMAP_PREVIEW_MAP__ = null;
      }
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Remount when mode/theme/cluster changes (perf A/B isolation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, theme, cluster]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(PIN_SOURCE)) return;
    if (mode === "nopins") return;
    (map.getSource(PIN_SOURCE) as GeoJSONSource).setData(toGeoJson(pins));
  }, [pins, mode]);

  return (
    <div ref={rootRef} className="map-preview-gl-root">
      <div className="map-preview-gl-canvas" />
      <MapLibreCornerAttribution className="map-preview-gl-attrib" />
    </div>
  );
}
