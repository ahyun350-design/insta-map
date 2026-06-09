"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type KakaoPlaceSearchResult = {
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
  onClose: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
  results: KakaoPlaceSearchResult[];
  onSelect: (place: KakaoPlaceSearchResult) => void;
  keyboardHeight?: number;
};

export function PlaceSearchModal({
  open,
  onClose,
  searchQuery,
  onSearchQueryChange,
  onSearch,
  results,
  onSelect,
  keyboardHeight = 0,
}: Props) {
  const modalPaddingBottom =
    keyboardHeight > 0
      ? `calc(12px + ${keyboardHeight}px)`
      : "calc(12px + env(safe-area-inset-bottom, 0px))";
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="배경 닫기"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100001,
          border: "none",
          background: "rgba(0,0,0,0.45)",
          cursor: "pointer",
          padding: 0,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="장소 검색"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 100002,
          background: "#fff",
          borderRadius: "16px 16px 0 0",
          maxHeight: "min(78vh, 520px)",
          display: "flex",
          flexDirection: "column",
          paddingBottom: modalPaddingBottom,
          transition: "padding-bottom 0.25s ease",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.12)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px 10px",
            borderBottom: "0.5px solid #efefef",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: "#1a2a7a" }}>장소 검색</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              color: "#666",
              cursor: "pointer",
              width: 36,
              height: 36,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexShrink: 0 }}>
          <input
            ref={inputRef}
            className="mapInput"
            placeholder="장소명 검색"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            style={{ flex: 1 }}
          />
          <button className="primaryButton" type="button" onClick={onSearch} style={{ padding: "0 14px", flexShrink: 0 }}>
            검색
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "0 8px 8px" }}>
          {results.length === 0 ? (
            <p style={{ margin: "24px 0", textAlign: "center", fontSize: 13, color: "#999" }}>
              검색어를 입력하고 검색해주세요
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 12px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "0.5px solid #f5f5f5",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 14, color: "#1a1a2e", fontWeight: 500 }}>{r.place_name}</p>
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "#999" }}>
                      {r.road_address_name || r.address_name || "주소 없음"}
                    </p>
                    {r.category_name && (
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#bbb" }}>{r.category_name}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
