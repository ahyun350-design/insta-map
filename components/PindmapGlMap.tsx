"use client";

import { useEffect, useRef } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MlMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./PindmapGlMap.css";
import { DEFAULT_CATEGORY_PIN, resolvePinColor } from "@/lib/categoryAppearance";
import {
  MAP_PIN_HEIGHT,
  MAP_PIN_ICON_SIZE,
  MAP_PIN_PIXEL_RATIO,
  MAP_PIN_WIDTH,
  pinMarkerSvg,
} from "@/lib/mapPinImages";
import type { FeedPostCategory } from "@/lib/feedPost";
import {
  buildPindmapStyle,
  type MapPreviewThemeId,
  type PindmapMapThemeId,
} from "@/lib/pindmapMapStyle";

export type PindmapGlPin = {
  id: string;
  lng: number;
  lat: number;
  category: string;
  name?: string;
};

type Props = {
  /** Production: paper | white. Preview may pass black/mono/dark. */
  theme?: MapPreviewThemeId;
  pins: PindmapGlPin[];
  className?: string;
  fitPadding?: number;
  singleZoom?: number;
  cluster?: boolean;
  interactive?: boolean;
  showAttribution?: boolean;
  testId?: string;
  onReady?: () => void;
  onError?: (err: Error) => void;
  onPinClick?: (pinId: string) => void;
};

const PIN_SOURCE = "pindmap-pins";
const FEED_CATS = Object.keys(DEFAULT_CATEGORY_PIN) as FeedPostCategory[];

function pinSvg(category: string): string {
  return pinMarkerSvg(category, resolvePinColor(category));
}


async function ensurePinImages(map: MlMap) {
  const cats = new Set<string>(FEED_CATS);
  await Promise.all(
    [...cats].map(
      (cat) =>
        new Promise<void>((resolve, reject) => {
          const id = `pin-${cat}`;
          if (map.hasImage(id)) {
            resolve();
            return;
          }
          const img = new Image(MAP_PIN_WIDTH, MAP_PIN_HEIGHT);
          img.onload = () => {
            if (!map.hasImage(id)) {
              map.addImage(id, img, { pixelRatio: MAP_PIN_PIXEL_RATIO });
            }
            resolve();
          };
          img.onerror = () => reject(new Error(`pin_image_${cat}`));
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg(cat))}`;
        }),
    ),
  );
  // fallback pin for unknown categories
  const fallbackId = "pin-fallback";
  if (!map.hasImage(fallbackId)) {
    await new Promise<void>((resolve, reject) => {
      const img = new Image(MAP_PIN_WIDTH, MAP_PIN_HEIGHT);
      img.onload = () => {
        if (!map.hasImage(fallbackId)) {
          map.addImage(fallbackId, img, { pixelRatio: MAP_PIN_PIXEL_RATIO });
        }
        resolve();
      };
      img.onerror = () => reject(new Error("pin_image_fallback"));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg("기타"))}`;
    });
  }
}

function toGeoJson(pins: PindmapGlPin[]) {
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
  pins: PindmapGlPin[],
  padding: number,
  singleZoom: number,
) {
  if (pins.length === 0) return;
  if (pins.length === 1) {
    map.jumpTo({
      center: [pins[0]!.lng, pins[0]!.lat],
      zoom: singleZoom,
    });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const p of pins) bounds.extend([p.lng, p.lat]);
  map.fitBounds(bounds, { padding, maxZoom: 16, duration: 0 });
}

function addPinLayers(
  map: MlMap,
  pins: PindmapGlPin[],
  cluster: boolean,
  themeId: MapPreviewThemeId,
) {
  if (map.getSource(PIN_SOURCE)) {
    (map.getSource(PIN_SOURCE) as GeoJSONSource).setData(toGeoJson(pins));
    return;
  }

  map.addSource(PIN_SOURCE, {
    type: "geojson",
    data: toGeoJson(pins),
    cluster,
    clusterMaxZoom: 16,
    clusterRadius: 52,
  });

  const dark = themeId === "dark" || themeId === "black";
  map.addLayer({
    id: "pindmap-clusters",
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

  map.addLayer({
    id: "pindmap-cluster-count",
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
    id: "pindmap-unclustered",
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
      "icon-size": MAP_PIN_ICON_SIZE,
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

export default function PindmapGlMap({
  theme = "paper",
  pins,
  className,
  fitPadding = 40,
  singleZoom = 15,
  cluster = true,
  interactive = true,
  showAttribution = true,
  testId,
  onReady,
  onError,
  onPinClick,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;
  const handlersBound = useRef(false);
  const themeReady = useRef(false);
  const initialTheme = useRef(theme);
  const themePropRef = useRef(theme);
  themePropRef.current = theme;

  useEffect(() => {
    let cancelled = false;
    const el = rootRef.current;
    if (!el) return;

    const canvas = el.querySelector<HTMLElement>(".pindmapGlMapCanvas");
    if (!canvas) return;

    (async () => {
      try {
        const style = await buildPindmapStyle(initialTheme.current);
        if (cancelled) return;
        const map = new maplibregl.Map({
          container: canvas,
          style: style as StyleSpecification,
          center: pinsRef.current[0]
            ? [pinsRef.current[0].lng, pinsRef.current[0].lat]
            : [127.055, 37.544],
          zoom: singleZoom,
          attributionControl: false,
          interactive,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        mapRef.current = map;

        map.on("error", (ev) => {
          const err =
            ev.error instanceof Error
              ? ev.error
              : new Error(String(ev.error?.message ?? "map_error"));
          // Ignore benign tile 404 noise; style fetch failures already throw
          if (/ajax|tile|Failed to fetch/i.test(err.message)) {
            /* keep map if some tiles fail */
          }
        });

        map.on("load", () => {
          void (async () => {
            try {
              await ensurePinImages(map);
              if (cancelled) return;
              addPinLayers(map, pinsRef.current, cluster, initialTheme.current);
              themeReady.current = true;
              fitToPins(map, pinsRef.current, fitPadding, singleZoom);

              if (!handlersBound.current) {
                handlersBound.current = true;
                map.on("click", "pindmap-clusters", (e) => {
                  const feat = e.features?.[0];
                  if (!feat || feat.geometry.type !== "Point") return;
                  const coords = feat.geometry.coordinates as [number, number];
                  const clusterId = feat.properties?.cluster_id as
                    | number
                    | undefined;
                  if (clusterId == null) return;
                  const src = map.getSource(PIN_SOURCE) as GeoJSONSource;
                  void src.getClusterExpansionZoom(clusterId).then((z) => {
                    map.easeTo({ center: coords, zoom: z });
                  });
                });
                map.on("click", "pindmap-unclustered", (e) => {
                  const id = e.features?.[0]?.properties?.id;
                  if (typeof id === "string") onPinClickRef.current?.(id);
                });
              }

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
    // Mount once; theme/pins updates handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme change → restyle (skip first paint; mount effect owns initial style)
  useEffect(() => {
    if (!themeReady.current) return;
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    void buildPindmapStyle(theme)
      .then((style) => {
        if (cancelled || !mapRef.current) return;
        map.setStyle(style as StyleSpecification);
        map.once("style.load", () => {
          void ensurePinImages(map).then(() => {
            if (cancelled) return;
            addPinLayers(map, pinsRef.current, cluster, theme);
            fitToPins(map, pinsRef.current, fitPadding, singleZoom);
            onReadyRef.current?.();
          });
        });
      })
      .catch((e) => {
        onErrorRef.current?.(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      cancelled = true;
    };
  }, [theme, cluster, fitPadding, singleZoom]);

  // Pins data update
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(PIN_SOURCE)) return;
    (map.getSource(PIN_SOURCE) as GeoJSONSource).setData(toGeoJson(pins));
    fitToPins(map, pins, fitPadding, singleZoom);
  }, [pins, fitPadding, singleZoom]);

  const dark = theme === "dark" || theme === "black";

  return (
    <div
      ref={rootRef}
      className={`pindmapGlMapRoot${dark ? " is-dark" : ""}${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      <div className="pindmapGlMapCanvas" />
      {showAttribution ? (
        <div className="pindmapGlMapAttrib">© OpenStreetMap contributors</div>
      ) : null}
    </div>
  );
}

export type { PindmapMapThemeId };
