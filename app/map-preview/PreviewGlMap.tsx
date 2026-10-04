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
import type { FeedPostCategory } from "@/lib/feedPost";
import {
  buildLitePreviewStyle,
  buildPindmapStyle,
  type MapPreviewThemeId,
} from "./buildStyle";

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
  onReady?: () => void;
  onError?: (err: Error) => void;
  onPinClick?: (pinId: string) => void;
  onDiagnostics?: (d: PreviewDiagnostics) => void;
};

const PIN_SOURCE = "preview-pins";
const FEED_CATS = Object.keys(DEFAULT_CATEGORY_PIN) as FeedPostCategory[];

function pinSvg(category: string) {
  const fill = resolvePinColor(category);
  const stroke = category === "카페" || category === "쇼핑" || category === "여행지" ? "#666" : "#999";
  const emoji =
    FEED_CATS.includes(category as FeedPostCategory)
      ? DEFAULT_CATEGORY_PIN[category as FeedPostCategory].emoji
      : "📍";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${fill}" stroke="${stroke}" stroke-width="1"/><circle cx="18" cy="18" r="13" fill="white" opacity="0.9"/><text x="18" y="23" text-anchor="middle" font-size="14">${emoji}</text></svg>`;
}

async function ensurePinImages(map: MlMap) {
  await Promise.all(
    FEED_CATS.map(
      (cat) =>
        new Promise<void>((resolve, reject) => {
          const id = `pin-${cat}`;
          if (map.hasImage(id)) {
            resolve();
            return;
          }
          const img = new Image(36, 44);
          img.onload = () => {
            if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
            resolve();
          };
          img.onerror = () => reject(new Error(`pin_image_${cat}`));
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg(cat))}`;
        }),
    ),
  );
  if (!map.hasImage("pin-fallback")) {
    await new Promise<void>((resolve, reject) => {
      const img = new Image(36, 44);
      img.onload = () => {
        if (!map.hasImage("pin-fallback")) {
          map.addImage("pin-fallback", img, { pixelRatio: 2 });
        }
        resolve();
      };
      img.onerror = () => reject(new Error("pin_image_fallback"));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg("기타"))}`;
    });
  }
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

  map.addLayer({
    id: "preview-clusters",
    type: "circle",
    source: PIN_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": dark ? "#555555" : "#1a2a7a",
      "circle-radius": ["step", ["get", "point_count"], 16, 5, 20, 12, 24],
      "circle-stroke-width": 2,
      "circle-stroke-color": dark ? "#0B0B0B" : "#ffffff",
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

  map.addLayer({
    id: "preview-unclustered",
    type: "symbol",
    source: PIN_SOURCE,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": [
        "case",
        ["==", ["get", "category"], "fallback"],
        "pin-fallback",
        ["concat", "pin-", ["get", "category"]],
      ],
      "icon-size": 0.55,
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
  onReady,
  onError,
  onPinClick,
  onDiagnostics,
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
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;
  const onDiagRef = useRef(onDiagnostics);
  onDiagRef.current = onDiagnostics;
  const handlersBound = useRef(false);
  const bootAtRef = useRef(0);

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

        map.on("error", (ev) => {
          const msg = String(ev.error?.message ?? "");
          if (/ajax|tile|Failed to fetch/i.test(msg)) return;
        });

        map.on("load", () => {
          void (async () => {
            try {
              if (modeRef.current === "default") {
                await ensurePinImages(map);
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
