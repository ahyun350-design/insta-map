"use client";

/**
 * /map-preview?probe=public-list — e2e-only harness for public-list MapLibre → Kakao fallback.
 * Uses demo pins only; never a real user's public list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PindmapGlMap from "@/components/PindmapGlMap";
import { trackMapGlFallback } from "@/lib/mapSurface/mapGlTelemetry";
import { MAP_PREVIEW_PINS } from "./samplePins";

const PUBLIC_LIST_GL_LOAD_TIMEOUT_MS = 8000;

function loadKakaoMapsSdk(): Promise<NonNullable<(typeof window)["kakao"]>> {
  return new Promise((resolve, reject) => {
    const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY?.trim();
    if (!key) {
      reject(new Error("missing_kakao_key"));
      return;
    }

    const w = window as Window & {
      kakao?: {
        maps: {
          load: (cb: () => void) => void;
        };
      };
    };

    const finish = () => {
      if (!w.kakao?.maps) {
        reject(new Error("kakao_maps_missing"));
        return;
      }
      w.kakao.maps.load(() => resolve(w.kakao!));
    };

    if (w.kakao?.maps) {
      finish();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-pindmap-kakao-maps]",
    );
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("kakao_script_error")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.async = true;
    script.dataset.pindmapKakaoMaps = "1";
    script.onload = finish;
    script.onerror = () => reject(new Error("kakao_script_error"));
    document.head.appendChild(script);
  });
}

export default function PublicListGlProbe() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [engine, setEngine] = useState<"gl" | "kakao">("gl");
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [mapError, setMapError] = useState(false);
  const glFallbackOnceRef = useRef(false);

  const pins = useMemo(
    () =>
      MAP_PREVIEW_PINS.map((p) => ({
        id: p.id,
        lng: p.lng,
        lat: p.lat,
        category: p.category,
        name: p.name,
      })),
    [],
  );

  const fallbackGlToKakao = useCallback(
    (reason: "style_error" | "load_timeout") => {
      if (glFallbackOnceRef.current) return;
      glFallbackOnceRef.current = true;
      trackMapGlFallback("public_list", reason);
      setMapError(false);
      setMapStatus("loading");
      setEngine("kakao");
    },
    [],
  );

  useEffect(() => {
    if (engine !== "gl" || pins.length === 0) return;
    if (mapStatus === "ready" || mapError) return;
    const t = window.setTimeout(() => {
      fallbackGlToKakao("load_timeout");
    }, PUBLIC_LIST_GL_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [engine, pins.length, mapStatus, mapError, fallbackGlToKakao]);

  useEffect(() => {
    if (engine !== "kakao") return;
    let cancelled = false;
    const markers: { setMap?: (v: null) => void }[] = [];

    const run = async () => {
      try {
        const kakao = (await loadKakaoMapsSdk()) as {
          maps: {
            LatLng: new (lat: number, lng: number) => unknown;
            Map: new (
              el: HTMLElement,
              opts: { center: unknown; level: number },
            ) => {
              setBounds?: (b: unknown) => void;
              relayout?: () => void;
            };
            Marker: new (opts: { position: unknown }) => {
              setMap: (m: unknown) => void;
            };
            LatLngBounds: new () => { extend: (ll: unknown) => void };
          };
        };
        if (cancelled) return;
        const el = mapRef.current;
        if (!el) {
          setMapError(true);
          setMapStatus("error");
          return;
        }
        const center = new kakao.maps.LatLng(pins[0]!.lat, pins[0]!.lng);
        const map = new kakao.maps.Map(el, { center, level: 5 });
        const bounds = new kakao.maps.LatLngBounds();
        for (const p of pins) {
          const pos = new kakao.maps.LatLng(p.lat, p.lng);
          bounds.extend(pos);
          const marker = new kakao.maps.Marker({ position: pos });
          marker.setMap(map);
          markers.push(marker);
        }
        try {
          map.setBounds?.(bounds);
        } catch {
          /* ignore */
        }
        if (!cancelled) {
          setMapError(false);
          setMapStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setMapError(true);
          setMapStatus("error");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      for (const m of markers) {
        try {
          m.setMap?.(null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [engine, pins]);

  const showGl = engine === "gl" && pins.length > 0 && !mapError;
  const showKakao = engine === "kakao" && !mapError;

  return (
    <div
      className="map-preview-root"
      data-testid="public-list-gl-probe"
      data-map-status={mapStatus}
      data-map-engine={engine}
    >
      <header className="map-preview-bar">
        <div className="map-preview-title">
          public-list probe · {engine} · {mapStatus}
        </div>
      </header>
      <div className="map-preview-map" style={{ minHeight: "60vh" }}>
        {showGl ? (
          <div
            className="publicListShareMap"
            data-testid="public-list-share-map"
            style={{ width: "100%", height: "100%", minHeight: "60vh" }}
          >
            <PindmapGlMap
              theme="paper"
              pins={pins}
              singleZoom={14}
              fitPadding={36}
              cluster
              onReady={() => {
                setMapError(false);
                setMapStatus("ready");
              }}
              onError={() => {
                fallbackGlToKakao("style_error");
              }}
            />
          </div>
        ) : null}
        {showKakao ? (
          <div
            ref={mapRef}
            className="publicListShareMap"
            data-testid="public-list-share-map"
            style={{ width: "100%", height: "100%", minHeight: "60vh" }}
          />
        ) : null}
        {mapError ? (
          <p data-testid="public-list-map-fallback">지도를 불러오지 못했어요</p>
        ) : null}
      </div>
    </div>
  );
}
