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
import {
  horizontalSpanKmForMapLibreZoom,
  mapLibreZoomToKakaoLevel,
} from "@/lib/mapSurface/kakaoZoom";
import {
  claimMapGlSlot,
  releaseMapGlSlot,
} from "@/lib/mapSurface/mapGlRecovery";
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
  /** Route style demo: walk | car | course (Seongsu fake path). */
  routeDemo?: PreviewRouteMode | null;
  onReady?: () => void;
  onError?: (err: Error) => void;
  onPinClick?: (pinId: string) => void;
  onDiagnostics?: (d: PreviewDiagnostics) => void;
  onCompareSample?: (s: { zoom: number; widthKm: number; level: number }) => void;
};

const PIN_SOURCE = "preview-pins";
const FEED_CATS = Object.keys(DEFAULT_CATEGORY_PIN) as FeedPostCategory[];

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
) {
  if (pins.length === 0) {
    map.jumpTo({ center: [127.8, 36.2], zoom: 6.2 });
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
  routeDemo = null,
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
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const clusterRef = useRef(cluster);
  clusterRef.current = cluster;
  const routeDemoRef = useRef(routeDemo);
  routeDemoRef.current = routeDemo;
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
        const map = new maplibregl.Map({
          container: canvas,
          style: style as StyleSpecification,
          center: [127.8, 36.2],
          zoom: 6.2,
          attributionControl: false,
          interactive: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          pitch: 0,
          maxPitch: 0,
          fadeDuration: modeRef.current === "lite" ? 0 : 300,
          antialias: modeRef.current !== "lite",
          renderWorldCopies: modeRef.current !== "lite",
          pixelRatio: dpr,
        });
        mapRef.current = map;
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
        });

        map.on("load", () => {
          void (async () => {
            try {
              if (modeRef.current === "default") {
                await ensurePinImages(map, themeRef.current === "neon");
              }
              if (cancelled) return;
              addPinLayers(
                map,
                pinsRef.current,
                clusterRef.current,
                modeRef.current,
                themeRef.current,
              );
              fitToPins(map, pinsRef.current, fitPadding, singleZoom);
              if (routeDemoRef.current) {
                await paintPreviewRouteDemo(
                  map,
                  routeDemoRef.current,
                  themeRef.current === "neon" ? "neon" : "paper",
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
      <div className="map-preview-gl-attrib">© OpenStreetMap contributors</div>
    </div>
  );
}
