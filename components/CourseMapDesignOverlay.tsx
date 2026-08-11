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

type ScreenPin = {
  id: string;
  name: string;
  order: number;
  x: number;
  y: number;
  side: "left" | "right";
};

type Props = {
  /** kakao.maps.Map instance */
  map: unknown;
  places: CourseMapDesignPlace[];
  path: CourseMapDesignPathPoint[];
  onPinClick?: (place: CourseMapDesignPlace, index: number) => void;
};

function truncateLabel(name: string, max = 16): string {
  const t = name.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatOrder(order: number): string {
  return String(order).padStart(2, "0");
}

/**
 * 코스 지도 실험 UI — 딤 위에 핀·라벨·점선 경로를 HTML/SVG로 직접 그림.
 * 카카오 Marker/Polyline과 분리되어 딤에 가려지지 않음.
 */
export function CourseMapDesignOverlay({ map, places, path, onPinClick }: Props) {
  const [pins, setPins] = useState<ScreenPin[]>([]);
  const [polyPoints, setPolyPoints] = useState("");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const rafRef = useRef(0);
  const placesRef = useRef(places);
  const pathRef = useRef(path);
  placesRef.current = places;
  pathRef.current = path;

  const project = useCallback(() => {
    const m = map as {
      getProjection?: () => {
        containerPointFromCoords?: (latlng: unknown) => { x: number; y: number } | null;
      } | null;
      getNode?: () => HTMLElement | undefined;
    } | null;
    if (!m || !window.kakao?.maps) return;

    const node = m.getNode?.();
    const w = node?.clientWidth || 0;
    const h = node?.clientHeight || 0;
    setSize({ w, h });

    const proj = m.getProjection?.();
    const toPoint = proj?.containerPointFromCoords;
    if (!toPoint) return;

    const nextPins: ScreenPin[] = [];
    placesRef.current.forEach((place, idx) => {
      try {
        const latlng = new window.kakao.maps.LatLng(place.lat, place.lng);
        const pt = toPoint.call(proj, latlng);
        if (!pt) return;
        const side: "left" | "right" = w > 0 && pt.x > w * 0.62 ? "left" : "right";
        nextPins.push({
          id: place.id,
          name: place.name,
          order: idx + 1,
          x: pt.x,
          y: pt.y,
          side,
        });
      } catch {
        /* ignore bad coords */
      }
    });
    setPins(nextPins);

    const pts: string[] = [];
    pathRef.current.forEach((p) => {
      try {
        const latlng = new window.kakao.maps.LatLng(p.lat, p.lng);
        const pt = toPoint.call(proj, latlng);
        if (!pt) return;
        pts.push(`${pt.x},${pt.y}`);
      } catch {
        /* ignore */
      }
    });
    setPolyPoints(pts.join(" "));
  }, [map]);

  const scheduleProject = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      project();
    });
  }, [project]);

  useEffect(() => {
    scheduleProject();
  }, [places, path, scheduleProject]);

  useEffect(() => {
    const m = map as { constructor?: unknown } | null;
    if (!m || !window.kakao?.maps?.event) return;

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
  }, [map, scheduleProject]);

  return (
    <div
      aria-hidden
      data-experiment="course-map-design"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 2,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(20,20,22,0.55)",
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
            stroke="rgba(255,255,255,0.8)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="7 8"
            opacity={0.8}
          />
        </svg>
      )}

      {pins.map((pin, index) => {
        const place = places[index];
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
            }}
          >
            <button
              type="button"
              aria-label={`${formatOrder(pin.order)} ${pin.name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (place) onPinClick?.(place, index);
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
                boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                padding: 0,
              }}
            >
              {formatOrder(pin.order)}
            </button>
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
                textShadow: "0 1px 3px rgba(0,0,0,0.75), 0 0 8px rgba(0,0,0,0.35)",
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
