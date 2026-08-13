"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CourseMapDesignPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

export type CourseMapDesignPathPoint = {
  lat: number;
  lng: number;
};

export type CourseMapDesignGuideStep = {
  lat: number;
  lng: number;
  active?: boolean;
};

type ScreenPin = {
  id: string;
  name: string;
  order: number;
  x: number;
  y: number;
  side: "left" | "right";
  labelOffsetY: number;
  showLabel: boolean;
};

type ScreenGuide = {
  index: number;
  x: number;
  y: number;
  active: boolean;
};

type Props = {
  /** kakao.maps.Map instance */
  map: unknown;
  places: CourseMapDesignPlace[];
  path: CourseMapDesignPathPoint[];
  /** 턴바이턴 안내 지점 (관리자) */
  guideSteps?: CourseMapDesignGuideStep[];
  onGuideStepClick?: (index: number) => void;
  onPinClick?: (place: CourseMapDesignPlace, index: number) => void;
  /** 관리자 임시 진단 로그 */
  debugAdmin?: boolean;
};

function truncateLabel(name: string, max = 16): string {
  const t = name.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatOrder(order: number): string {
  return String(order).padStart(2, "0");
}

function readKakaoPoint(pt: unknown): { x: number; y: number } | null {
  if (!pt || typeof pt !== "object") return null;
  const p = pt as { x?: unknown; y?: unknown; getX?: () => number; getY?: () => number };
  const x =
    typeof p.x === "number"
      ? p.x
      : typeof p.getX === "function"
        ? p.getX()
        : NaN;
  const y =
    typeof p.y === "number"
      ? p.y
      : typeof p.getY === "function"
        ? p.getY()
        : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** 가까운 핀 라벨을 위·아래로 밀고, 그래도 겹치면 앞번호만 표시 */
function resolveLabelCollisions(pins: ScreenPin[]): ScreenPin[] {
  const result = pins.map((p) => ({ ...p, labelOffsetY: 0, showLabel: true }));
  const STAGGER_PX = 52;
  const HIDE_PX = 34;

  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i]!;
      const b = result[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d >= STAGGER_PX) continue;
      a.labelOffsetY = -20;
      b.labelOffsetY = 20;
      if (a.side === b.side) {
        b.side = a.side === "right" ? "left" : "right";
      }
    }
  }

  const labelAnchor = (p: ScreenPin) => ({
    x: p.x + (p.side === "right" ? 48 : -48),
    y: p.y + p.labelOffsetY,
  });

  for (let i = 0; i < result.length; i++) {
    const a = result[i]!;
    if (!a.showLabel) continue;
    for (let j = i + 1; j < result.length; j++) {
      const b = result[j]!;
      if (!b.showLabel) continue;
      const la = labelAnchor(a);
      const lb = labelAnchor(b);
      if (Math.hypot(la.x - lb.x, la.y - lb.y) < HIDE_PX) {
        if (a.order <= b.order) b.showLabel = false;
        else a.showLabel = false;
      }
    }
  }

  return result;
}

/**
 * 코스 지도 실험 UI — 딤 위에 핀·라벨·점선 경로를 HTML/SVG로 직접 그림.
 * 카카오 Marker/Polyline과 분리되어 딤에 가려지지 않음.
 */
export function CourseMapDesignOverlay({
  map,
  places,
  path,
  guideSteps = [],
  onGuideStepClick,
  onPinClick,
  debugAdmin = false,
}: Props) {
  const [pins, setPins] = useState<ScreenPin[]>([]);
  const [guides, setGuides] = useState<ScreenGuide[]>([]);
  const [polyPoints, setPolyPoints] = useState("");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const rafRef = useRef(0);
  const placesRef = useRef(places);
  const pathRef = useRef(path);
  const guideStepsRef = useRef(guideSteps);
  const debugOnceRef = useRef(false);
  placesRef.current = places;
  pathRef.current = path;
  guideStepsRef.current = guideSteps;

  useEffect(() => {
    if (!debugAdmin) return;
    console.log("[crs][admin-map] CourseMapDesignOverlay MOUNT", {
      places: places.length,
      pathPts: path.length,
      hasMap: !!map,
    });
    return () => {
      console.log("[crs][admin-map] CourseMapDesignOverlay UNMOUNT");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, []);

  const project = useCallback(() => {
    const m = map as {
      getProjection?: () => {
        containerPointFromCoords?: (latlng: unknown) => unknown;
        pointFromCoords?: (latlng: unknown) => unknown;
      } | null;
      getNode?: () => HTMLElement | undefined;
    } | null;
    if (!m || !window.kakao?.maps) {
      if (debugAdmin) console.log("[crs][admin-map] project abort: no map/kakao");
      return;
    }

    const node = m.getNode?.();
    const w = node?.clientWidth || 0;
    const h = node?.clientHeight || 0;
    setSize({ w, h });

    const proj = m.getProjection?.();
    const toContainer = proj?.containerPointFromCoords;
    const toPoint = proj?.pointFromCoords;
    if (!toContainer && !toPoint) {
      if (debugAdmin) {
        console.log("[crs][admin-map] project abort: no projection methods", {
          hasProj: !!proj,
          keys: proj ? Object.keys(proj as object).slice(0, 20) : [],
        });
      }
      return;
    }

    const projectOne = (lat: number, lng: number): { x: number; y: number; via: string } | null => {
      const latlng = new window.kakao.maps.LatLng(lat, lng);
      if (toContainer) {
        const raw = toContainer.call(proj, latlng);
        const pt = readKakaoPoint(raw);
        if (pt) return { ...pt, via: "containerPointFromCoords" };
      }
      if (toPoint) {
        const raw = toPoint.call(proj, latlng);
        const pt = readKakaoPoint(raw);
        if (pt) return { ...pt, via: "pointFromCoords" };
      }
      return null;
    };

    const nextPins: ScreenPin[] = [];
    placesRef.current.forEach((place, idx) => {
      try {
        const pt = projectOne(place.lat, place.lng);
        if (!pt) return;
        const side: "left" | "right" = w > 0 && pt.x > w * 0.62 ? "left" : "right";
        nextPins.push({
          id: place.id,
          name: place.name,
          order: idx + 1,
          x: pt.x,
          y: pt.y,
          side,
          labelOffsetY: 0,
          showLabel: true,
        });
      } catch (err) {
        if (debugAdmin) console.log("[crs][admin-map] pin project error", place.name, err);
      }
    });
    setPins(resolveLabelCollisions(nextPins));

    const pts: string[] = [];
    pathRef.current.forEach((p) => {
      try {
        const pt = projectOne(p.lat, p.lng);
        if (!pt) return;
        pts.push(`${pt.x},${pt.y}`);
      } catch {
        /* ignore */
      }
    });
    setPolyPoints(pts.join(" "));

    const nextGuides: ScreenGuide[] = [];
    guideStepsRef.current.forEach((step, idx) => {
      try {
        const pt = projectOne(step.lat, step.lng);
        if (!pt) return;
        nextGuides.push({
          index: idx,
          x: pt.x,
          y: pt.y,
          active: Boolean(step.active),
        });
      } catch {
        /* ignore */
      }
    });
    setGuides(nextGuides);

    if (debugAdmin && !debugOnceRef.current) {
      debugOnceRef.current = true;
      const sample = nextPins[0];
      console.log("[crs][admin-map] project first result", {
        size: { w, h },
        pinCount: nextPins.length,
        polyCount: pts.length,
        samplePin: sample
          ? { name: sample.name, x: sample.x, y: sample.y, side: sample.side }
          : null,
        hasContainerFn: !!toContainer,
        hasPointFn: !!toPoint,
        sampleVia: placesRef.current[0]
          ? projectOne(placesRef.current[0].lat, placesRef.current[0].lng)?.via
          : null,
      });
    }
  }, [map, debugAdmin]);

  const scheduleProject = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      project();
    });
  }, [project]);

  useEffect(() => {
    debugOnceRef.current = false;
    scheduleProject();
  }, [places, path, guideSteps, scheduleProject]);

  useEffect(() => {
    const m = map as { constructor?: unknown } | null;
    if (!m || !window.kakao?.maps?.event) {
      if (debugAdmin) console.log("[crs][admin-map] listeners skip: no map/event");
      return;
    }

    const events = ["center_changed", "zoom_changed", "bounds_changed", "idle"] as const;
    events.forEach((ev) => {
      window.kakao.maps.event.addListener(m, ev, scheduleProject);
    });

    const node = (map as { getNode?: () => HTMLElement | undefined }).getNode?.();
    const ro =
      typeof ResizeObserver !== "undefined" && node
        ? new ResizeObserver(() => scheduleProject())
        : null;
    if (node && ro) ro.observe(node);

    scheduleProject();

    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      events.forEach((ev) => {
        try {
          window.kakao.maps.event.removeListener(m, ev, scheduleProject);
        } catch {
          /* noop */
        }
      });
      ro?.disconnect();
    };
  }, [map, scheduleProject, debugAdmin]);

  return (
    <div
      aria-hidden
      data-experiment="course-map-design"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 25,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(18,18,20,0.78)",
          pointerEvents: "none",
        }}
      />

      {size.w > 0 && size.h > 0 && polyPoints && (
        <svg
          width={size.w}
          height={size.h}
          style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
        >
          <polyline
            points={polyPoints}
            fill="none"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="7 8"
            opacity={0.9}
          />
        </svg>
      )}

      {pins.map((pin) => {
        const place = places.find((p) => p.id === pin.id);
        const placeIndex = places.findIndex((p) => p.id === pin.id);
        const label = truncateLabel(pin.name);
        return (
          <div
            key={`${pin.id}-${pin.order}`}
            style={{
              position: "absolute",
              left: pin.x,
              top: pin.y,
              transform: "translate(-50%, -50%)",
              display: "flex",
              alignItems: "center",
              flexDirection: pin.side === "left" ? "row-reverse" : "row",
              gap: 8,
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <button
              type="button"
              aria-label={`${formatOrder(pin.order)} ${pin.name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (place && placeIndex >= 0) onPinClick?.(place, placeIndex);
              }}
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                border: "none",
                background: "#FF8FA3",
                color: "#fff",
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1,
                cursor: "pointer",
                pointerEvents: "auto",
                flexShrink: 0,
                fontFamily: "inherit",
                boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
                padding: 0,
              }}
            >
              {formatOrder(pin.order)}
            </button>
            {pin.showLabel && (
              <span
                style={{
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  maxWidth: 140,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 0 10px rgba(0,0,0,0.45)",
                  pointerEvents: "none",
                  userSelect: "none",
                  transform: pin.labelOffsetY ? `translateY(${pin.labelOffsetY}px)` : undefined,
                }}
              >
                {label}
              </span>
            )}
          </div>
        );
      })}

      {guides.map((g) => (
        <button
          key={`guide-${g.index}`}
          type="button"
          aria-label={`안내 ${g.index + 1}`}
          className={
            g.active
              ? "courseMapGuideDot courseMapGuideDotActive"
              : "courseMapGuideDot"
          }
          onClick={(e) => {
            e.stopPropagation();
            onGuideStepClick?.(g.index);
          }}
          style={{
            position: "absolute",
            left: g.x,
            top: g.y,
            transform: "translate(-50%, -50%)",
            zIndex: g.active ? 3 : 1,
            pointerEvents: "auto",
          }}
        />
      ))}
    </div>
  );
}
