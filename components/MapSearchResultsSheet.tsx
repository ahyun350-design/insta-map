"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MapSearchPlaceResult = {
  id: string;
  place_name: string;
  category_name?: string;
  road_address_name?: string;
  address_name?: string;
  y?: string | number;
  x?: string | number;
};

type Props = {
  open: boolean;
  queryLabel: string;
  results: MapSearchPlaceResult[];
  userLocation?: { lat: number; lng: number } | null;
  onSelect: (place: MapSearchPlaceResult) => void;
  onClose: () => void;
};

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceMeters(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function formatCategoryPath(category?: string): string | null {
  if (!category?.trim()) return null;
  const parts = category
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return category.trim();
  return parts.join(" > ");
}

export function MapSearchResultsSheet({
  open,
  queryLabel,
  results,
  userLocation,
  onSelect,
  onClose,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [dragDelta, setDragDelta] = useState(0);
  const dragStartRef = useRef<{ y: number; wasExpanded: boolean } | null>(null);

  useEffect(() => {
    if (open) {
      setExpanded(false);
      setDragDelta(0);
    }
  }, [open, queryLabel, results.length]);

  const finishDrag = useCallback(() => {
    if (!dragStartRef.current) return;
    const delta = dragDelta;
    dragStartRef.current = null;
    setDragDelta(0);

    if (delta > 48) {
      setExpanded(true);
      return;
    }
    if (delta < -48) {
      if (expanded) {
        setExpanded(false);
      } else {
        onClose();
      }
    }
  }, [dragDelta, expanded, onClose]);

  const onHandlePointerDown = (e: React.PointerEvent) => {
    dragStartRef.current = { y: e.clientY, wasExpanded: expanded };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    setDragDelta(dragStartRef.current.y - e.clientY);
  };

  const onHandlePointerUp = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    finishDrag();
  };

  if (!open || results.length === 0) return null;

  const sheetHeight = expanded ? "70vh" : "30vh";
  const dragStyle =
    dragDelta !== 0
      ? {
          transform: `translateY(${-dragDelta}px)`,
          transition: "none",
        }
      : undefined;

  return (
    <div
      className="mapSearchResultsSheet"
      style={{ height: sheetHeight, ...dragStyle }}
      aria-label="검색 결과"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="mapSearchResultsSheetHandle"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        role="presentation"
      >
        <span className="mapSearchResultsSheetHandleBar" />
      </div>

      <div className="mapSearchResultsSheetHeader">
        <h2 className="mapSearchResultsSheetTitle">
          <span className="mapSearchResultsSheetQuery">{queryLabel}</span> 검색 결과 {results.length}개
        </h2>
        <button type="button" className="mapSearchResultsSheetCloseBtn" aria-label="닫기" onClick={onClose}>
          ×
        </button>
      </div>

      <ul className="mapSearchResultsSheetList">
        {results.map((place) => {
          const lat = parseFloat(String(place.y ?? ""));
          const lng = parseFloat(String(place.x ?? ""));
          let distanceLabel: string | null = null;
          if (userLocation && Number.isFinite(lat) && Number.isFinite(lng)) {
            distanceLabel = formatDistanceMeters(distanceMeters(userLocation.lat, userLocation.lng, lat, lng));
          }
          const categoryPath = formatCategoryPath(place.category_name);
          const address = place.road_address_name || place.address_name || "주소 없음";

          return (
            <li key={place.id || `${place.place_name}-${place.y}-${place.x}`}>
              <button type="button" className="mapSearchResultsSheetItem" onClick={() => onSelect(place)}>
                <div className="mapSearchResultsSheetItemMain">
                  <p className="mapSearchResultsSheetItemName">{place.place_name}</p>
                  <p className="mapSearchResultsSheetItemAddress">{address}</p>
                  {categoryPath && <p className="mapSearchResultsSheetItemCategory">{categoryPath}</p>}
                </div>
                {distanceLabel && <span className="mapSearchResultsSheetItemDistance">{distanceLabel}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
