"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { derivePostImageThumbUrl } from "@/lib/postImageThumb";
import {
  EDGE_SWIPE_PRIORITY,
  useEdgeSwipeBack,
} from "@/lib/useEdgeSwipeBack";

export type PlaceSheetPhotoViewerEntry = {
  src: string;
  photoIndex: number;
};

type Props = {
  entries: PlaceSheetPhotoViewerEntry[];
  /** Index into `entries` (not photoIndex) */
  initialEntryIndex: number;
  onClose: () => void;
  /** photoIndex of the currently visible slide */
  onOpenCuration: (photoIndex: number) => void;
};

function ViewerSlideImage({
  fullSrc,
  isActive,
  nearActive,
}: {
  fullSrc: string;
  isActive: boolean;
  nearActive: boolean;
}) {
  const thumbSrc = derivePostImageThumbUrl(fullSrc);
  const useThumbFirst = isActive && !!thumbSrc && thumbSrc !== fullSrc;
  const [thumbFailed, setThumbFailed] = useState(false);
  const [thumbReady, setThumbReady] = useState(false);
  const [fullReady, setFullReady] = useState(!useThumbFirst);

  useEffect(() => {
    setThumbFailed(false);
    setThumbReady(false);
    setFullReady(!(isActive && !!thumbSrc && thumbSrc !== fullSrc));
  }, [fullSrc, isActive, thumbSrc]);

  if (!isActive && !nearActive) {
    return <div className="placeSheetPhotoViewerSlideInner" aria-hidden />;
  }

  const showThumb = useThumbFirst && !thumbFailed;
  const layerStyle = {
    position: "absolute" as const,
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain" as const,
    display: "block" as const,
  };

  return (
    <div className="placeSheetPhotoViewerSlideInner">
      {showThumb ? (
        <img
          src={thumbSrc}
          alt=""
          style={{ ...layerStyle, opacity: thumbReady && !fullReady ? 1 : 0 }}
          draggable={false}
          decoding="async"
          loading="eager"
          fetchPriority={isActive ? "high" : "auto"}
          onLoad={() => setThumbReady(true)}
          onError={() => setThumbFailed(true)}
        />
      ) : null}
      <img
        src={fullSrc}
        alt=""
        style={{
          ...layerStyle,
          opacity: fullReady || !showThumb ? 1 : 0,
        }}
        draggable={false}
        decoding="async"
        loading={isActive || nearActive ? "eager" : "lazy"}
        fetchPriority={isActive ? "high" : "auto"}
        onLoad={() => setFullReady(true)}
        ref={(el) => {
          if (el && el.complete && el.naturalWidth > 0) {
            setFullReady(true);
          }
        }}
      />
    </div>
  );
}

export function PlaceSheetPhotoViewer({
  entries,
  initialEntryIndex,
  onClose,
  onOpenCuration,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(() => {
    if (entries.length === 0) return 0;
    return Math.min(Math.max(0, initialEntryIndex), entries.length - 1);
  });

  useEdgeSwipeBack({
    id: "place-sheet-photo-viewer",
    enabled: entries.length > 0,
    priority: EDGE_SWIPE_PRIORITY.PHOTO_VIEWER,
    onClose,
  });

  useEffect(() => {
    const el = trackRef.current;
    if (!el || entries.length === 0) return;
    const idx = Math.min(Math.max(0, initialEntryIndex), entries.length - 1);
    setActiveIndex(idx);
    const w = el.clientWidth;
    if (w > 0) {
      el.scrollLeft = idx * w;
    }
  }, [entries, initialEntryIndex]);

  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el || el.clientWidth <= 0) return;
    setActiveIndex(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  if (typeof document === "undefined" || entries.length === 0) return null;

  const current = entries[activeIndex] ?? entries[0]!;
  const multi = entries.length > 1;

  return createPortal(
    <div
      className="placeSheetPhotoViewer"
      role="dialog"
      aria-modal="true"
      aria-label="사진 크게 보기"
      data-testid="place-sheet-photo-viewer"
      onClick={onClose}
    >
      <button
        type="button"
        className="placeSheetPhotoViewerClose"
        aria-label="닫기"
        data-testid="place-sheet-photo-viewer-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>

      <div
        ref={trackRef}
        className="placeSheetPhotoViewerTrack"
        onScroll={onScroll}
        onClick={(e) => e.stopPropagation()}
      >
        {entries.map((entry, i) => (
          <div
            key={`${entry.src}-${entry.photoIndex}`}
            className="placeSheetPhotoViewerSlide"
            data-slide-index={i}
            data-photo-index={entry.photoIndex}
          >
            <ViewerSlideImage
              fullSrc={entry.src}
              isActive={i === activeIndex}
              nearActive={Math.abs(i - activeIndex) <= 1}
            />
          </div>
        ))}
      </div>

      {multi ? (
        <p className="placeSheetPhotoViewerPage" aria-hidden>
          {activeIndex + 1}/{entries.length}
        </p>
      ) : null}

      <div
        className="placeSheetPhotoViewerFooter"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="placeSheetPhotoViewerCurationBtn"
          data-testid="place-sheet-photo-viewer-curation"
          onClick={() => onOpenCuration(current.photoIndex)}
        >
          큐레이션 보기
        </button>
      </div>
    </div>,
    document.body,
  );
}
