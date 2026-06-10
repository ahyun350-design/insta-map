"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNativeKeyboard } from "@/lib/useNativeKeyboard";

type Props = {
  isOpen: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  debouncedQuery: string;
  onClose: () => void;
  resultCount: number;
  children: React.ReactNode;
};

export function HomeSearchScreen({
  isOpen,
  query,
  onQueryChange,
  debouncedQuery,
  onClose,
  resultCount,
  children,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { height: keyboardHeight } = useNativeKeyboard();
  const trimmedDebounced = debouncedQuery.trim();
  const hasQuery = trimmedDebounced.length > 0;

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="큐레이션 검색"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          flexShrink: 0,
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingLeft: "max(8px, env(safe-area-inset-left, 0px))",
          paddingRight: "max(8px, env(safe-area-inset-right, 0px))",
          borderBottom: "0.5px solid var(--border, #efefef)",
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 8px 10px",
            minHeight: 48,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="뒤로"
            style={{
              flexShrink: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              padding: 0,
              color: "#1a2a7a",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M13 4L7 10L13 16"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <label
            className="homeFeedSearchField"
            style={{ flex: 1, minWidth: 0, margin: 0 }}
          >
            <svg className="homeFeedSearchIcon" width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.75" />
              <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              className="homeFeedSearchInput"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="장소·키워드 검색"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {query.length > 0 && (
              <button
                type="button"
                className="homeFeedSearchClear"
                onClick={() => onQueryChange("")}
                aria-label="검색어 지우기"
              >
                ×
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              border: "none",
              background: "transparent",
              color: "#1a2a7a",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
              padding: "8px 4px",
              fontFamily: "inherit",
            }}
          >
            취소
          </button>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          paddingBottom:
            keyboardHeight > 0
              ? `${keyboardHeight + 16}px`
              : "max(16px, env(safe-area-inset-bottom, 0px))",
          transition: "padding-bottom 0.25s ease",
        }}
      >
        {!hasQuery ? (
          <p
            style={{
              margin: 0,
              padding: "48px 24px",
              textAlign: "center",
              fontSize: "14px",
              color: "#9aa1bc",
              lineHeight: 1.6,
            }}
          >
            장소·키워드로 큐레이션 찾기
          </p>
        ) : (
          <>
            <p
              style={{
                margin: 0,
                padding: "14px 16px 10px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#56607a",
                borderBottom: "0.5px solid #f0f2f6",
                background: "#fbfcff",
              }}
            >
              &apos;{trimmedDebounced}&apos; 검색 결과 {resultCount}건
            </p>
            {children}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
