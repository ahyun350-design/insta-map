"use client";

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { COMPANION_TAG_OPTIONS, type CompanionTag } from "@/lib/companionTag";

type Category = "맛집" | "카페" | "쇼핑" | "숙소" | "놀거리" | "여행지";

export type PostImageItem = {
  id: string;
  previewUrl: string;
  publicUrl?: string;
  status: "uploading" | "uploaded" | "failed";
  file?: File;
  error?: string;
};

type KakaoPlaceResult = {
  id: string;
  place_name: string;
  road_address_name?: string;
  address_name?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** 슬라이드다운 종료 후 호출 (폼 리셋 등) */
  onExited?: () => void;
  onSubmit: () => void;
  canPost: boolean;
  validationHint: string | null;
  title: string;
  onTitleChange: (value: string) => void;
  placeName: string;
  address: string;
  onClearPlace: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
  searchResults: KakaoPlaceResult[];
  onSelectPlace: (place: KakaoPlaceResult) => void;
  category: Category;
  onCategoryChange: (category: Category) => void;
  categoryMainOrder: Category[];
  categoryPin: Record<Category, { color: string; emoji: string }>;
  categoryColors: Record<Category, string>;
  images: PostImageItem[];
  onImagesChange: (updater: (prev: PostImageItem[]) => PostImageItem[]) => void;
  onImageUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onRetryImage: (item: PostImageItem) => void;
  companionTag: CompanionTag | null;
  onCompanionTagChange: (tag: CompanionTag) => void;
  comment: string;
  onCommentChange: (value: string) => void;
};

const SLIDE_MS = 280;

const rootStyle = (active: boolean): CSSProperties => ({
  position: "fixed",
  inset: 0,
  zIndex: 100000,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  paddingTop: "env(safe-area-inset-top, 0px)",
  paddingBottom: "env(safe-area-inset-bottom, 0px)",
  boxSizing: "border-box",
  transform: active ? "translateY(0)" : "translateY(100%)",
  transition: `transform ${SLIDE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
  willChange: "transform",
});

function scrollFieldIntoView(el: HTMLElement | null) {
  if (!el) return;
  window.setTimeout(() => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 120);
}

export function NewCurationScreen({
  open,
  onClose,
  onExited,
  onSubmit,
  canPost,
  validationHint,
  title,
  onTitleChange,
  placeName,
  address,
  onClearPlace,
  searchQuery,
  onSearchQueryChange,
  onSearch,
  searchResults,
  onSelectPlace,
  category,
  onCategoryChange,
  categoryMainOrder,
  categoryPin,
  categoryColors,
  images,
  onImagesChange,
  onImageUpload,
  onRetryImage,
  companionTag,
  onCompanionTagChange,
  comment,
  onCommentChange,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [slideActive, setSlideActive] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      setMounted(true);
      setSlideActive(false);
      const enterId = requestAnimationFrame(() => {
        requestAnimationFrame(() => setSlideActive(true));
      });
      return () => cancelAnimationFrame(enterId);
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    setSlideActive(false);
    const exitId = window.setTimeout(() => {
      setMounted(false);
      onExited?.();
    }, SLIDE_MS);
    return () => window.clearTimeout(exitId);
  }, [open, onExited]);

  useEffect(() => {
    if (!mounted) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) {
      setKeyboardInset(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setKeyboardInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setKeyboardInset(0);
    };
  }, [mounted]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <section style={rootStyle(slideActive)} aria-modal="true" role="dialog" aria-label="새 큐레이션">
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "0.5px solid #efefef",
          background: "#fff",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          style={{
            width: 40,
            height: 40,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 22,
            color: "#666",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          ×
        </button>
        <span
          style={{
            flex: 1,
            textAlign: "center",
            fontFamily: "'Playfair Display', serif",
            fontSize: 17,
            color: "#1a2a7a",
            fontWeight: 500,
          }}
        >
          새 큐레이션
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canPost}
          style={{
            border: "none",
            background: "transparent",
            cursor: canPost ? "pointer" : "default",
            padding: "8px 4px",
            fontSize: 15,
            fontWeight: 600,
            color: canPost ? "#1a2a7a" : "#bbb",
            fontFamily: "inherit",
            flexShrink: 0,
            minWidth: 40,
          }}
        >
          등록
        </button>
      </header>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: "16px 20px 24px",
          paddingBottom: `calc(24px + ${keyboardInset}px + env(safe-area-inset-bottom, 0px))`,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxSizing: "border-box",
        }}
      >
        <div>
          <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: 6, marginTop: 0 }}>제목</p>
          <input
            className="mapInput"
            placeholder="한 줄로 표현해보세요"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        </div>

        <div>
          <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: 6, marginTop: 0 }}>장소 검색</p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="mapInput"
              placeholder="장소명 검색"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              onFocus={(ev) => scrollFieldIntoView(ev.currentTarget)}
              style={{ flex: 1 }}
            />
            <button className="primaryButton" onClick={onSearch} type="button" style={{ padding: "0 14px", flexShrink: 0 }}>
              검색
            </button>
          </div>
          {searchResults.length > 0 && (
            <div style={{ border: "0.5px solid #eee", borderRadius: 4, marginTop: 6, overflow: "hidden" }}>
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelectPlace(r)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    background: "transparent",
                    border: "none",
                    borderBottom: "0.5px solid #f5f5f5",
                    cursor: "pointer",
                  }}
                >
                  <p style={{ margin: 0, fontSize: 13, color: "#1a1a2e" }}>{r.place_name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#999" }}>{r.road_address_name || r.address_name}</p>
                </button>
              ))}
            </div>
          )}
          {placeName ? (
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                background: "#f0f4ff",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid #d0daff",
              }}
            >
              <span style={{ fontSize: 16 }}>{categoryPin[category].emoji}</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, color: "#1a2a7a", fontWeight: 500 }}>{placeName}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#999" }}>{address}</p>
              </div>
              <button
                type="button"
                onClick={onClearPlace}
                style={{ border: "none", background: "transparent", color: "#bbb", cursor: "pointer", fontSize: 14 }}
              >
                ×
              </button>
            </div>
          ) : (
            <p style={{ fontSize: 11, color: "#bbb", marginTop: 6 }}>장소를 검색하고 선택해주세요</p>
          )}
        </div>

        <div>
          <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: 8, marginTop: 0 }}>카테고리</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {categoryMainOrder.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => onCategoryChange(cat)}
                style={{
                  padding: "8px 6px",
                  borderRadius: 12,
                  border: `1px solid ${category === cat ? categoryColors[cat] : "#eee"}`,
                  background: category === cat ? categoryColors[cat] : "transparent",
                  color: category === cat ? "#fff" : "#888",
                  fontSize: 11,
                  cursor: "pointer",
                  textAlign: "center",
                  fontFamily: "inherit",
                  lineHeight: 1.25,
                }}
              >
                {categoryPin[cat].emoji} {cat}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: 8, marginTop: 0 }}>사진 추가 (최대 6장)</p>
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

        <div>
          <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: 8, marginTop: 0 }}>누구랑 갔어요?</p>
          <div role="radiogroup" aria-label="동행 태그" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {COMPANION_TAG_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${companionTag === opt.value ? "#1a2a7a" : "#eee"}`,
                  background: companionTag === opt.value ? "#f0f4ff" : "#fff",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "#333",
                }}
              >
                <input
                  type="radio"
                  name="postCompanionTag"
                  value={opt.value}
                  checked={companionTag === opt.value}
                  onChange={() => onCompanionTagChange(opt.value)}
                  style={{ accentColor: "#1a2a7a" }}
                />
                <span>
                  {opt.emoji} {opt.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: 6, marginTop: 0 }}>코멘트</p>
          <textarea
            placeholder="이 장소에 대한 느낌을 자유롭게 적어주세요 ✍️"
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
            rows={4}
            style={{
              width: "100%",
              border: "0.5px solid #ddd",
              borderRadius: 4,
              padding: "10px 12px",
              fontSize: 13,
              fontFamily: "inherit",
              resize: "none",
              outline: "none",
              boxSizing: "border-box",
              color: "#333",
            }}
          />
        </div>

        {validationHint && (
          <p style={{ fontSize: 11, color: "#e07070", margin: 0, textAlign: "center" }}>{validationHint}</p>
        )}
      </div>
    </section>,
    document.body,
  );
}
