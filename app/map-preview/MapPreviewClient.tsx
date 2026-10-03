"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PindmapGlMap from "@/components/PindmapGlMap";
import {
  EDGE_SWIPE_PRIORITY,
  useEdgeSwipeBack,
} from "@/lib/useEdgeSwipeBack";
import { safeRouterBack } from "@/lib/safeRouterBack";
import {
  MAP_PREVIEW_THEME_ORDER,
  MAP_PREVIEW_THEMES,
  parseMapPreviewThemeId,
  type MapPreviewThemeId,
} from "./buildStyle";
import {
  MAP_PREVIEW_PINS,
  generateSeoulDemoPins,
} from "./samplePins";
import "./map-preview.css";

type PreviewQuery = {
  theme: MapPreviewThemeId;
  pinCount: number;
  cluster: boolean;
  fps: boolean;
};

function readPreviewQuery(): PreviewQuery {
  if (typeof window === "undefined") {
    return { theme: "paper", pinCount: 0, cluster: true, fps: false };
  }
  const sp = new URLSearchParams(window.location.search);
  const pinsRaw = Number(sp.get("pins") || "0");
  const pinCount =
    Number.isFinite(pinsRaw) && pinsRaw > 0 ? Math.min(5000, Math.floor(pinsRaw)) : 0;
  return {
    theme: parseMapPreviewThemeId(sp.get("theme")),
    pinCount,
    cluster: sp.get("cluster") !== "0",
    fps: sp.get("fps") === "1",
  };
}

function writeThemeToUrl(themeId: MapPreviewThemeId) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("theme", themeId);
  const q = url.searchParams.toString();
  window.history.replaceState(null, "", `${url.pathname}${q ? `?${q}` : ""}`);
}

function FpsOverlay({ enabled }: { enabled: boolean }) {
  const [fps, setFps] = useState(0);
  const rafRef = useRef(0);
  const lastRef = useRef(performance.now());
  const framesRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = (now: number) => {
      if (!alive) return;
      framesRef.current += 1;
      const elapsed = now - lastRef.current;
      if (elapsed >= 500) {
        setFps(Math.round((framesRef.current * 1000) / elapsed));
        framesRef.current = 0;
        lastRef.current = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  if (!enabled) return null;
  return <div className="map-preview-fps">FPS {fps || "—"}</div>;
}

export default function MapPreviewClient() {
  const router = useRouter();
  const [theme, setTheme] = useState<MapPreviewThemeId>("paper");
  const [pinCount, setPinCount] = useState(0);
  const [cluster, setCluster] = useState(true);
  const [showFps, setShowFps] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [selected, setSelected] = useState<{ id: string; name: string; category: string } | null>(null);

  const leave = useCallback(() => {
    safeRouterBack(router, "/?tab=mypage");
  }, [router]);

  useEdgeSwipeBack({
    id: "map-preview-router",
    enabled: true,
    priority: EDGE_SWIPE_PRIORITY.ROUTER_SCREEN,
    onClose: leave,
  });

  useEffect(() => {
    const q = readPreviewQuery();
    setTheme(q.theme);
    setPinCount(q.pinCount);
    setCluster(q.cluster);
    setShowFps(q.fps);
    writeThemeToUrl(q.theme);
    setHydrated(true);
  }, []);

  const pins = useMemo(() => {
    const base =
      pinCount > 0 ? generateSeoulDemoPins(pinCount) : MAP_PREVIEW_PINS;
    return base.map((p) => ({
      id: p.id,
      lng: p.lng,
      lat: p.lat,
      category: p.category,
      name: p.name,
    }));
  }, [pinCount]);

  const pinById = useMemo(() => {
    const m = new Map<string, { id: string; name: string; category: string }>();
    for (const p of pins) {
      m.set(p.id, { id: p.id, name: p.name || p.id, category: p.category });
    }
    return m;
  }, [pins]);

  const switchTheme = useCallback((next: MapPreviewThemeId) => {
    setTheme(next);
    writeThemeToUrl(next);
    setStatus("loading");
    setSelected(null);
  }, []);

  const rootTone =
    theme === "black" || theme === "dark" ? "is-dark" : "is-light";

  const fitZoom = pinCount > 0 ? 11 : 14;

  return (
    <div className={`map-preview-root ${rootTone}`}>
      <header className="map-preview-bar">
        <button
          type="button"
          className="map-preview-back"
          onClick={leave}
          aria-label="뒤로"
        >
          ←
        </button>
        <div className="map-preview-title">
          핀맵 지도 미리보기
          {pinCount > 0 ? ` · ${pinCount}핀` : ""}
          {!cluster ? " · cluster off" : ""}
        </div>
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
            key={`gl-${pinCount}-${cluster ? 1 : 0}`}
            theme={theme}
            pins={pins}
            singleZoom={fitZoom}
            fitPadding={pinCount > 0 ? 28 : 48}
            cluster={cluster}
            onReady={() => setStatus("ready")}
            onError={(e) => {
              setStatus("error");
              setErrorMsg(e.message);
            }}
            onPinClick={(id) => {
              const p = pinById.get(id) ?? null;
              setSelected(p);
            }}
          />
        ) : null}
      </div>

      <FpsOverlay enabled={showFps} />

      {selected ? (
        <div className="map-preview-card" role="dialog" aria-label="선택 핀">
          <div className="map-preview-card-name">{selected.name}</div>
          <div className="map-preview-card-meta">{selected.category}</div>
          <button
            type="button"
            className="map-preview-card-close"
            onClick={() => setSelected(null)}
          >
            닫기
          </button>
        </div>
      ) : null}

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
