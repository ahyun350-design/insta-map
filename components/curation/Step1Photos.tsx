"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MAX_CURATION_PHOTOS, type PostImageItem } from "@/components/curation/types";

type Props = {
  images: PostImageItem[];
  onImagesChange: (updater: (prev: PostImageItem[]) => PostImageItem[]) => void;
  onImageUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onRetryImage: (item: PostImageItem) => void;
};

const THUMB = 64;
const THUMB_GAP = 8;
const SLOT = THUMB + THUMB_GAP;
const LONG_PRESS_MS = 380;
const MOVE_CANCEL_PX = 10;

function thumbSrcOf(img: PostImageItem): string {
  return img.status === "uploaded" && img.publicUrl ? img.publicUrl : img.previewUrl;
}

function StatusOverlay({
  img,
  onRetry,
  large,
}: {
  img: PostImageItem;
  onRetry: (item: PostImageItem) => void;
  large?: boolean;
}) {
  if (img.status === "uploading") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          borderRadius: large ? 8 : 6,
          background: "rgba(255,255,255,0.35)",
        }}
      >
        <span style={{ fontSize: large ? 28 : 18 }} aria-hidden>
          ⏳
        </span>
      </div>
    );
  }
  if (img.status !== "failed") return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: large ? 8 : 6,
        background: "rgba(224,112,112,0.35)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: large ? 8 : 4,
        padding: 4,
      }}
    >
      <span style={{ fontSize: large ? 22 : 13, color: "#a03030", fontWeight: 700 }} aria-hidden>
        ✕
      </span>
      <button
        type="button"
        onClick={(ev) => {
          ev.stopPropagation();
          onRetry(img);
        }}
        onPointerDown={(ev) => ev.stopPropagation()}
        style={{
          fontSize: large ? 13 : 9,
          padding: large ? "6px 12px" : "3px 6px",
          borderRadius: 4,
          border: "none",
          background: "#fff",
          cursor: "pointer",
          color: "#1a2a7a",
          fontFamily: "inherit",
        }}
      >
        재시도
      </button>
    </div>
  );
}

export function Step1Photos({ images, onImagesChange, onImageUpload, onRetryImage }: Props) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const prevLenRef = useRef(0);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressRef = useRef<{
    id: string;
    index: number;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    setSelectedIndex((cur) => {
      const grew = images.length > prevLenRef.current;
      prevLenRef.current = images.length;
      if (images.length === 0) return 0;
      if (grew) return images.length - 1;
      if (cur >= images.length) return images.length - 1;
      return cur;
    });
  }, [images.length]);

  useEffect(() => {
    return () => clearLongPressTimer();
  }, []);

  const removeImage = (img: PostImageItem) => {
    const removeIdx = images.findIndex((x) => x.id === img.id);
    onImagesChange((prev) => {
      const removed = prev.find((x) => x.id === img.id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((x) => x.id !== img.id);
    });
    if (removeIdx < 0) return;
    setSelectedIndex((cur) => {
      if (images.length <= 1) return 0;
      if (removeIdx < cur) return cur - 1;
      if (removeIdx === cur) return Math.min(cur, images.length - 2);
      return cur;
    });
  };

  const reorderTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    onImagesChange((prev) => {
      if (from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    dragIndexRef.current = to;
    setSelectedIndex(to);
  };

  const indexFromPointerX = (clientX: number): number => {
    const strip = stripRef.current;
    if (!strip || images.length === 0) return 0;
    const rect = strip.getBoundingClientRect();
    const x = clientX - rect.left + strip.scrollLeft;
    return Math.max(0, Math.min(images.length - 1, Math.floor(x / SLOT)));
  };

  const autoScrollStrip = (clientX: number) => {
    const strip = stripRef.current;
    if (!strip) return;
    const rect = strip.getBoundingClientRect();
    const edge = 40;
    if (clientX < rect.left + edge) {
      strip.scrollLeft = Math.max(0, strip.scrollLeft - 12);
    } else if (clientX > rect.right - edge) {
      strip.scrollLeft = Math.min(strip.scrollWidth, strip.scrollLeft + 12);
    }
  };

  const endPress = (el?: Element | null) => {
    const press = pressRef.current;
    clearLongPressTimer();
    if (press && el && "releasePointerCapture" in el) {
      try {
        (el as HTMLElement).releasePointerCapture(press.pointerId);
      } catch {
        /* already released */
      }
    }
    pressRef.current = null;
    dragIndexRef.current = null;
    setDraggingId(null);
  };

  const handleThumbPointerDown = (e: ReactPointerEvent, img: PostImageItem, index: number) => {
    if (e.button !== 0) return;
    clearLongPressTimer();
    pressRef.current = {
      id: img.id,
      index,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
    };
    const target = e.currentTarget as HTMLElement;
    longPressTimerRef.current = setTimeout(() => {
      const press = pressRef.current;
      if (!press || press.id !== img.id) return;
      press.dragging = true;
      dragIndexRef.current = press.index;
      setDraggingId(img.id);
      setSelectedIndex(press.index);
      target.style.touchAction = "none";
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(10);
        } catch {
          /* ignore */
        }
      }
    }, LONG_PRESS_MS);
  };

  const handleThumbPointerMove = (e: ReactPointerEvent) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;

    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;

    if (!press.dragging) {
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        clearLongPressTimer();
        pressRef.current = null;
      }
      return;
    }

    e.preventDefault();
    autoScrollStrip(e.clientX);
    const from = dragIndexRef.current ?? press.index;
    const to = indexFromPointerX(e.clientX);
    if (to !== from) reorderTo(from, to);
  };

  const handleThumbPointerUp = (e: ReactPointerEvent, img: PostImageItem, index: number) => {
    const press = pressRef.current;
    const wasDragging = !!press?.dragging;
    const samePointer = press?.pointerId === e.pointerId;
    (e.currentTarget as HTMLElement).style.touchAction = "";
    endPress(e.currentTarget);

    if (!samePointer) return;
    if (!wasDragging) {
      setSelectedIndex(index);
    }
  };

  const selected = images[selectedIndex] ?? null;
  const selectedSrc = selected ? thumbSrcOf(selected) : "";

  const deleteBtnStyle: CSSProperties = {
    position: "absolute",
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    minWidth: 32,
    minHeight: 32,
    borderRadius: "50%",
    background: "rgba(0,0,0,0.62)",
    border: "none",
    color: "#fff",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
    fontFamily: "inherit",
    padding: 0,
  };

  const stripDeleteBtnStyle: CSSProperties = {
    position: "absolute",
    top: -6,
    right: -6,
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#333",
    border: "none",
    color: "#fff",
    fontSize: 16,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    touchAction: "manipulation",
    padding: 0,
    fontFamily: "inherit",
  };

  return (
    <div>
      <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: 10, marginTop: 0 }}>
        사진 추가 (최대 {MAX_CURATION_PHOTOS}장)
      </p>

      {/* 메인 미리보기 */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 8,
          overflow: "hidden",
          background: "#f0f0f0",
          marginBottom: 12,
        }}
      >
        {selected ? (
          <>
            <img
              src={selectedSrc}
              alt=""
              draggable={false}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                opacity: selected.status === "uploading" ? 0.65 : 1,
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            />
            <StatusOverlay img={selected} onRetry={onRetryImage} large />
            <button
              type="button"
              aria-label="사진 삭제"
              onClick={() => removeImage(selected)}
              style={deleteBtnStyle}
            >
              ×
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "#bbb",
              fontFamily: "inherit",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="#bbb" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 13 }}>사진 추가</span>
          </button>
        )}
      </div>

      {/* 필름스트립 */}
      <div
        ref={stripRef}
        style={{
          display: "flex",
          gap: THUMB_GAP,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          paddingTop: 8,
          paddingBottom: 4,
          paddingRight: 4,
          touchAction: draggingId ? "none" : "pan-x",
        }}
      >
        {images.map((img, index) => {
          const selectedThumb = index === selectedIndex;
          const isDragging = draggingId === img.id;
          return (
            <div
              key={img.id}
              data-thumb-id={img.id}
              onPointerDown={(e) => handleThumbPointerDown(e, img, index)}
              onPointerMove={handleThumbPointerMove}
              onPointerUp={(e) => handleThumbPointerUp(e, img, index)}
              onPointerCancel={(e) => {
                (e.currentTarget as HTMLElement).style.touchAction = "";
                endPress(e.currentTarget);
              }}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                position: "relative",
                width: THUMB,
                height: THUMB,
                flexShrink: 0,
                borderRadius: 6,
                boxSizing: "border-box",
                border: selectedThumb ? "2.5px solid #1a2a7a" : "2.5px solid transparent",
                transform: isDragging ? "scale(1.12)" : "scale(1)",
                boxShadow: isDragging ? "0 8px 20px rgba(0,0,0,0.28)" : "none",
                zIndex: isDragging ? 5 : 1,
                transition: isDragging ? "none" : "transform 0.15s ease, box-shadow 0.15s ease",
                touchAction: isDragging ? "none" : "pan-x",
                cursor: isDragging ? "grabbing" : "pointer",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            >
              <img
                src={thumbSrcOf(img)}
                alt=""
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  borderRadius: 4,
                  display: "block",
                  opacity: img.status === "uploading" ? 0.65 : 1,
                  pointerEvents: "none",
                }}
              />
              <StatusOverlay img={img} onRetry={onRetryImage} />
              <button
                type="button"
                aria-label="사진 삭제"
                onClick={(ev) => {
                  ev.stopPropagation();
                  removeImage(img);
                }}
                onPointerDown={(ev) => ev.stopPropagation()}
                style={stripDeleteBtnStyle}
              >
                ×
              </button>
            </div>
          );
        })}
        {images.length < MAX_CURATION_PHOTOS && (
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            style={{
              width: THUMB,
              height: THUMB,
              flexShrink: 0,
              border: "1px dashed #ccc",
              borderRadius: 6,
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              color: "#bbb",
              fontFamily: "inherit",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="#bbb" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 9 }}>추가</span>
          </button>
        )}
      </div>

      <input ref={imageInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onImageUpload} />
    </div>
  );
}
