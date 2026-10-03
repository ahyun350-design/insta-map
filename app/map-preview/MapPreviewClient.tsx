"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map-preview.css";
import { DEFAULT_CATEGORY_PIN } from "@/lib/categoryAppearance";
import type { FeedPostCategory } from "@/lib/feedPost";
import {
  MAP_PREVIEW_THEME_ORDER,
  MAP_PREVIEW_THEMES,
  buildPreviewStyle,
  parseMapPreviewThemeId,
  type MapPreviewThemeId,
} from "./buildStyle";
import {
  MAP_PREVIEW_CENTER,
  MAP_PREVIEW_PINS,
  MAP_PREVIEW_ZOOM,
} from "./samplePins";

const PIN_SOURCE = "preview-pins";

function pinSvg(category: FeedPostCategory): string {
  const { color, emoji } = DEFAULT_CATEGORY_PIN[category];
  const stroke = category === "맛집" ? "#fff" : "#999";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${color}" stroke="${stroke}" stroke-width="1"/><circle cx="18" cy="18" r="13" fill="white" opacity="0.9"/><text x="18" y="23" text-anchor="middle" font-size="14">${emoji}</text></svg>`;
}

function writeThemeToUrl(themeId: MapPreviewThemeId) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("theme", themeId);
  window.history.replaceState(null, "", `${url.pathname}?theme=${themeId}`);
}

function readThemeFromUrl(): MapPreviewThemeId {
  if (typeof window === "undefined") return "paper";
  return parseMapPreviewThemeId(
    new URLSearchParams(window.location.search).get("theme"),
  );
}

function clusterPaint(themeId: MapPreviewThemeId) {
  if (themeId === "black") {
    return { color: "#555555", stroke: "#0B0B0B" };
  }
  if (themeId === "dark") {
    return { color: "#3d5a8a", stroke: "#0E1A30" };
  }
  return { color: "#1a2a7a", stroke: "#ffffff" };
}

async function addPinImages(map: MlMap) {
  const cats = Object.keys(DEFAULT_CATEGORY_PIN) as FeedPostCategory[];
  await Promise.all(
    cats.map(
      (cat) =>
        new Promise<void>((resolve, reject) => {
          const id = `pin-${cat}`;
          if (map.hasImage(id)) {
            resolve();
            return;
          }
          const img = new Image(36, 44);
          img.onload = () => {
            if (!map.hasImage(id)) {
              map.addImage(id, img, { pixelRatio: 2 });
            }
            resolve();
          };
          img.onerror = () => reject(new Error(`pin image ${cat}`));
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg(cat))}`;
        }),
    ),
  );
}

function pinsGeoJson() {
  return {
    type: "FeatureCollection" as const,
    features: MAP_PREVIEW_PINS.map((p) => ({
      type: "Feature" as const,
      id: p.id,
      properties: {
        id: p.id,
        name: p.name,
        category: p.category,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [p.lng, p.lat],
      },
    })),
  };
}

function addPinLayers(map: MlMap, themeId: MapPreviewThemeId) {
  if (map.getSource(PIN_SOURCE)) return;

  const cluster = clusterPaint(themeId);
  map.addSource(PIN_SOURCE, {
    type: "geojson",
    data: pinsGeoJson(),
    cluster: true,
    clusterMaxZoom: 16,
    clusterRadius: 52,
  });

  map.addLayer({
    id: "preview-clusters",
    type: "circle",
    source: PIN_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": cluster.color,
      "circle-radius": ["step", ["get", "point_count"], 16, 5, 20, 12, 24],
      "circle-stroke-width": 2,
      "circle-stroke-color": cluster.stroke,
    },
  });

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
    paint: {
      "text-color": "#ffffff",
    },
  });

  map.addLayer({
    id: "preview-unclustered",
    type: "symbol",
    source: PIN_SOURCE,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": ["concat", "pin-", ["get", "category"]],
      "icon-size": 0.55,
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

export default function MapPreviewClient() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const clusterClickBound = useRef(false);
  const [theme, setTheme] = useState<MapPreviewThemeId>("paper");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const mountPins = useCallback(async (map: MlMap, themeId: MapPreviewThemeId) => {
    await addPinImages(map);
    addPinLayers(map, themeId);
    if (!clusterClickBound.current) {
      clusterClickBound.current = true;
      map.on("click", "preview-clusters", (e) => {
        const feat = e.features?.[0];
        if (!feat || feat.geometry.type !== "Point") return;
        const coords = feat.geometry.coordinates as [number, number];
        const clusterId = feat.properties?.cluster_id as number | undefined;
        if (clusterId == null) return;
        const src = map.getSource(PIN_SOURCE) as GeoJSONSource | undefined;
        if (!src) return;
        void src.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: coords, zoom });
        });
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    const initialTheme = readThemeFromUrl();
    setTheme(initialTheme);
    writeThemeToUrl(initialTheme);

    (async () => {
      try {
        const style = await buildPreviewStyle(initialTheme);
        if (cancelled) return;
        const map = new maplibregl.Map({
          container: el,
          style: style as maplibregl.StyleSpecification,
          center: MAP_PREVIEW_CENTER,
          zoom: MAP_PREVIEW_ZOOM,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "bottom-right",
        );
        mapRef.current = map;
        map.on("load", () => {
          void mountPins(map, initialTheme).then(() => {
            if (!cancelled) setStatus("ready");
          });
        });
        map.on("error", (ev) => {
          console.error("[map-preview]", ev.error);
        });
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      clusterClickBound.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [mountPins]);

  const switchTheme = useCallback(
    async (next: MapPreviewThemeId) => {
      const map = mapRef.current;
      if (!map || next === themeRef.current) return;
      setTheme(next);
      writeThemeToUrl(next);
      setStatus("loading");
      try {
        const style = await buildPreviewStyle(next);
        map.setStyle(style as maplibregl.StyleSpecification);
        map.once("style.load", () => {
          void mountPins(map, next).then(() => setStatus("ready"));
        });
      } catch (e) {
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    },
    [mountPins],
  );

  const rootTone =
    theme === "black" || theme === "dark" ? "is-dark" : "is-light";

  return (
    <div className={`map-preview-root ${rootTone}`}>
      <header className="map-preview-bar">
        <div className="map-preview-title">핀맵 지도 미리보기</div>
        <div className="map-preview-themes" role="group" aria-label="지도 스타일">
          {MAP_PREVIEW_THEME_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className={
                theme === id
                  ? "map-preview-theme-btn is-active"
                  : "map-preview-theme-btn"
              }
              onClick={() => void switchTheme(id)}
            >
              {MAP_PREVIEW_THEMES[id].label}
            </button>
          ))}
        </div>
      </header>

      <div ref={containerRef} className="map-preview-map" />

      {status === "loading" && (
        <div className="map-preview-status">지도 불러오는 중…</div>
      )}
      {status === "error" && (
        <div className="map-preview-status is-error">
          타일을 불러오지 못했습니다
          {errorMsg ? ` (${errorMsg})` : ""}. 대안: MapTiler 무료키 스타일 또는
          자체 PMTiles.
        </div>
      )}

      <div className="map-preview-attrib">© OpenStreetMap contributors</div>
    </div>
  );
}
