"use client";

import { useRef, type ChangeEvent } from "react";
import type { PostImageItem } from "@/components/curation/types";

type Props = {
  images: PostImageItem[];
  onImagesChange: (updater: (prev: PostImageItem[]) => PostImageItem[]) => void;
  onImageUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onRetryImage: (item: PostImageItem) => void;
};

export function Step1Photos({ images, onImagesChange, onImageUpload, onRetryImage }: Props) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div>
      <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: 8, marginTop: 0 }}>
        사진 추가 (최대 6장)
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {images.map((img) => {
          const thumbSrc = img.status === "uploaded" && img.publicUrl ? img.publicUrl : img.previewUrl;
          return (
            <div key={img.id} style={{ position: "relative", width: 72, height: 72 }}>
              <img
                src={thumbSrc}
                alt=""
                style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, opacity: img.status === "uploading" ? 0.65 : 1 }}
              />
              {img.status === "uploading" && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.35)",
                  }}
                >
                  <span style={{ fontSize: 18 }} aria-hidden>
                    ⏳
                  </span>
                </div>
              )}
              {img.status === "failed" && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 6,
                    background: "rgba(224,112,112,0.35)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    padding: 4,
                  }}
                >
                  <span style={{ fontSize: 13, color: "#a03030", fontWeight: 700 }} aria-hidden>
                    ✕
                  </span>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onRetryImage(img);
                    }}
                    style={{
                      fontSize: 9,
                      padding: "3px 6px",
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
              )}
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onImagesChange((prev) => {
                    const removed = prev.find((x) => x.id === img.id);
                    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
                    return prev.filter((x) => x.id !== img.id);
                  });
                }}
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "#333",
                  border: "none",
                  color: "#fff",
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        {images.length < 6 && (
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            style={{
              width: 72,
              height: 72,
              border: "1px dashed #ccc",
              borderRadius: 6,
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              color: "#bbb",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="#bbb" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 10 }}>사진 추가</span>
          </button>
        )}
      </div>
      <input ref={imageInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onImageUpload} />
    </div>
  );
}
