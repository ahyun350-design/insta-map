"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  generateKoreaDemoPins,
} from "./samplePins";
import PreviewGlMap, {
  type PreviewDiagnostics,
  type PreviewPerfMode,
} from "./PreviewGlMap";
import "./map-preview.css";

type PreviewQuery = {
  theme: MapPreviewThemeId;
  pinCount: number;
  cluster: boolean;
  fps: boolean;
  mode: PreviewPerfMode;
  compare: boolean;
};

function parseMode(sp: URLSearchParams): PreviewPerfMode {
  const mode = sp.get("mode");
  if (mode === "lite" || mode === "nopins" || mode === "default") return mode;
  if (sp.get("lite") === "1") return "lite";
  return "default";
}

function readPreviewQuery(): PreviewQuery {
  if (typeof window === "undefined") {
    return {
      theme: "paper",
      pinCount: 0,
      cluster: true,
      fps: false,
      mode: "default",
      compare: false,
    };
  }
  const sp = new URLSearchParams(window.location.search);
  const pinsRaw = Number(sp.get("pins") || "0");
  const pinCount =
    Number.isFinite(pinsRaw) && pinsRaw > 0
      ? Math.min(5000, Math.floor(pinsRaw))
      : 0;
  return {
    theme: parseMapPreviewThemeId(sp.get("theme")),
    pinCount,
    cluster: sp.get("cluster") !== "0",
    fps: sp.get("fps") === "1",
    mode: parseMode(sp),
    compare: sp.get("compare") === "1",
  };
}

function writeQueryPatch(patch: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const q = url.searchParams.toString();
  window.history.replaceState(null, "", `${url.pathname}${q ? `?${q}` : ""}`);
}

type FpsStats = {
  current: number;
  avg5: number;
  min5: number;
};


function CompareHud({
  enabled,
  info,
}: {
  enabled: boolean;
  info: { zoom: number; km: number; level: number } | null;
}) {
  if (!enabled) return null;
  return (
    <div className="map-preview-compare" role="status" aria-label="줌 비교">
      <div>
        ML zoom {info ? info.zoom.toFixed(2) : "—"} · Kakao L
        {info ? info.level : "—"}
      </div>
      <div>가로 {info ? `${info.km.toFixed(2)} km` : "—"}</div>
    </div>
  );
}

function DiagPanel({
  enabled,
  diag,
}: {
  enabled: boolean;
  diag: PreviewDiagnostics | null;
}) {
  const [fps, setFps] = useState<FpsStats>({ current: 0, avg5: 0, min5: 0 });
  const rafRef = useRef(0);
  const lastRef = useRef(performance.now());
  const framesRef = useRef(0);
  const samplesRef = useRef<{ t: number; fps: number }[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = (now: number) => {
      if (!alive) return;
      framesRef.current += 1;
      const elapsed = now - lastRef.current;
      if (elapsed >= 400) {
        const cur = Math.round((framesRef.current * 1000) / elapsed);
        framesRef.current = 0;
        lastRef.current = now;
        const samples = samplesRef.current;
        samples.push({ t: now, fps: cur });
        const cutoff = now - 5000;
        while (samples.length && samples[0]!.t < cutoff) samples.shift();
        const vals = samples.map((s) => s.fps);
        const avg5 = vals.length
          ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
          : cur;
        const min5 = vals.length ? Math.min(...vals) : cur;
        setFps({ current: cur, avg5, min5 });
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

  const dpr =
    diag?.devicePixelRatio ??
    (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);

  return (
    <div className="map-preview-diag" role="status" aria-label="성능 진단">
      <div className="map-preview-diag-row">
        FPS {fps.current || "—"}
      </div>
      <div className="map-preview-diag-row">
        5초 평균 {fps.avg5 || "—"} / 최저 {fps.min5 || "—"}
      </div>
      <div className="map-preview-diag-row">
        레이어 {diag?.layerCount ?? "—"}
      </div>
      <div className="map-preview-diag-row">
        첫 로딩 {diag?.firstLoadMs != null ? `${diag.firstLoadMs}ms` : "—"}
      </div>
      <div className="map-preview-diag-row">
        타일평균{" "}
        {diag?.tileLoadAvgMs != null
          ? `${diag.tileLoadAvgMs}ms(${diag.tileSampleCount})`
          : "—"}
      </div>
      <div className="map-preview-diag-row">
        DPR {Number(dpr).toFixed(2)}
      </div>
    </div>
  );
}

export default function MapPreviewClient() {
  const router = useRouter();
  const [theme, setTheme] = useState<MapPreviewThemeId>("paper");
  const [pinCount, setPinCount] = useState(0);
  const [cluster, setCluster] = useState(true);
  const [showFps, setShowFps] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [compareInfo, setCompareInfo] = useState<{ zoom: number; km: number; level: number } | null>(null);
  const [mode, setMode] = useState<PreviewPerfMode>("default");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [selected, setSelected] = useState<{
    id: string;
    name: string;
    category: string;
  } | null>(null);
  const [diag, setDiag] = useState<PreviewDiagnostics | null>(null);
  const [zoomJump, setZoomJump] = useState<{ zoom: number; token: number } | null>(null);

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
    setMode(q.mode);
    setShowCompare(q.compare);
    writeQueryPatch({ theme: q.theme });
    setHydrated(true);
  }, []);

  const pins = useMemo(() => {
    if (mode === "nopins") return [];
    const base =
      pinCount > 0 ? generateKoreaDemoPins(pinCount) : MAP_PREVIEW_PINS;
    return base.map((p) => ({
      id: p.id,
      lng: p.lng,
      lat: p.lat,
      category: p.category,
      name: p.name,
    }));
  }, [pinCount, mode]);

  const pinById = useMemo(() => {
    const m = new Map<string, { id: string; name: string; category: string }>();
    for (const p of pins) {
      m.set(p.id, { id: p.id, name: p.name || p.id, category: p.category });
    }
    return m;
  }, [pins]);

  const switchTheme = useCallback((next: MapPreviewThemeId) => {
    setTheme(next);
    writeQueryPatch({ theme: next });
    setStatus("loading");
    setSelected(null);
    setDiag(null);
  }, []);

  const switchMode = useCallback((next: PreviewPerfMode) => {
    setMode(next);
    setStatus("loading");
    setSelected(null);
    setDiag(null);
    writeQueryPatch({
      mode: next === "default" ? null : next,
      lite: next === "lite" ? "1" : null,
    });
  }, []);

  const rootTone =
    theme === "black" || theme === "dark" ? "is-dark" : "is-light";

  const fitZoom = pinCount > 0 ? 6.5 : 14;
  const effectivePinCount = mode === "nopins" ? 0 : pinCount;

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
          {effectivePinCount > 0 ? ` · ${effectivePinCount}핀` : " · 핀없음"}
          {mode === "lite" ? " · lite" : ""}
          {!cluster ? " · cluster off" : ""}
        </div>
        <div className="map-preview-modes" role="group" aria-label="성능 모드">
          {(
            [
              ["default", "기본"],
              ["lite", "경량"],
              ["nopins", "핀 없음"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={
                mode === id
                  ? "map-preview-mode-btn is-active"
                  : "map-preview-mode-btn"
              }
              onClick={() => switchMode(id)}
            >
              {label}
            </button>
          ))}
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
        <div className="map-preview-zooms" role="group" aria-label="줌 바로가기">
          {[7, 10, 12, 14, 16].map((z) => (
            <button
              key={z}
              type="button"
              className="map-preview-zoom-btn"
              onClick={() => setZoomJump({ zoom: z, token: Date.now() })}
            >
              z{z}
            </button>
          ))}
        </div>
      </header>

      <div className="map-preview-map">
        {hydrated ? (
          <PreviewGlMap
            key={`gl-${mode}-${theme}-${cluster ? 1 : 0}-${effectivePinCount}`}
            theme={theme}
            mode={mode}
            pins={pins}
            singleZoom={fitZoom}
            fitPadding={effectivePinCount > 0 ? 28 : 48}
            cluster={cluster}
            zoomJump={zoomJump}
            onReady={() => setStatus("ready")}
            onError={(e) => {
              setStatus("error");
              setErrorMsg(e.message);
            }}
            onPinClick={(id) => {
              const p = pinById.get(id) ?? null;
              setSelected(p);
            }}
            onDiagnostics={setDiag}
            onCompareSample={
              showCompare
                ? (s) =>
                    setCompareInfo({
                      zoom: s.zoom,
                      km: s.widthKm,
                      level: s.level,
                    })
                : undefined
            }
          />
        ) : null}
      </div>

      <CompareHud enabled={showCompare} info={compareInfo} />
      <DiagPanel enabled={showFps} diag={diag} />

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
