"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PindmapGlMap from "@/components/PindmapGlMap";
import {
  MAP_PREVIEW_THEME_ORDER,
  MAP_PREVIEW_THEMES,
  parseMapPreviewThemeId,
  type MapPreviewThemeId,
} from "./buildStyle";
import {
  MAP_PREVIEW_PINS,
} from "./samplePins";
import "./map-preview.css";

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

export default function MapPreviewClient() {
  const [theme, setTheme] = useState<MapPreviewThemeId>("paper");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const initial = readThemeFromUrl();
    setTheme(initial);
    writeThemeToUrl(initial);
    setHydrated(true);
  }, []);

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

  const switchTheme = useCallback((next: MapPreviewThemeId) => {
    setTheme(next);
    writeThemeToUrl(next);
    setStatus("loading");
  }, []);

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
              onClick={() => switchTheme(id)}
            >
              {MAP_PREVIEW_THEMES[id].label}
            </button>
          ))}
        </div>
      </header>

      <div className="map-preview-map">
        {hydrated ? (
          <PindmapGlMap
            theme={theme}
            pins={pins}
            singleZoom={14}
            fitPadding={48}
            onReady={() => setStatus("ready")}
            onError={(e) => {
              setStatus("error");
              setErrorMsg(e.message);
            }}
          />
        ) : null}
      </div>

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
    </div>
  );
}
