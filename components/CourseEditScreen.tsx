"use client";

import type { CSSProperties } from "react";
import type { SavedCourseItem } from "@/lib/courses";

type Category = "맛집" | "카페" | "쇼핑" | "숙소" | "놀거리" | "여행지";

type Place = {
  id: string;
  name: string;
  address: string;
  category: Category;
};

export type CourseEditDraft = {
  id: string;
  title: string;
  items: SavedCourseItem[];
};

type Props = {
  draft: CourseEditDraft;
  saving: boolean;
  keyboardHeight?: number;
  showAddPlace: boolean;
  addablePlaces: Place[];
  categoryPin: Record<Category, { emoji: string }>;
  categoryColors: Record<Category, string>;
  onCloseRequest: () => void;
  onSave: () => void;
  onTitleChange: (title: string) => void;
  onOpenAddPlace: () => void;
  onCloseAddPlace: () => void;
  onMoveItem: (idx: number, direction: "up" | "down") => void;
  onRemoveItem: (idx: number) => void;
  onAddPlace: (place: Place) => void;
};

const rootStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100000,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  paddingTop: "env(safe-area-inset-top, 0px)",
  paddingBottom: "env(safe-area-inset-bottom, 0px)",
  boxSizing: "border-box",
};

export function CourseEditScreen({
  draft,
  saving,
  keyboardHeight = 0,
  showAddPlace,
  addablePlaces,
  categoryPin,
  categoryColors,
  onCloseRequest,
  onSave,
  onTitleChange,
  onOpenAddPlace,
  onCloseAddPlace,
  onMoveItem,
  onRemoveItem,
  onAddPlace,
}: Props) {
  return (
    <section style={rootStyle}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "12px 16px",
          borderBottom: "0.5px solid #efefef",
          background: "#fff",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onCloseRequest}
          disabled={saving}
          style={{
            border: "none",
            background: "transparent",
            cursor: saving ? "wait" : "pointer",
            padding: "4px 8px 4px 0",
            fontSize: 14,
            color: "#1a2a7a",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          ‹ 뒤로
        </button>
        <span style={{ fontSize: 16, fontWeight: 600, color: "#1a1a2e" }}>코스 수정</span>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          style={{
            border: "none",
            background: "transparent",
            cursor: saving ? "wait" : "pointer",
            padding: "4px 0 4px 8px",
            fontSize: 14,
            fontWeight: 600,
            color: saving ? "#999" : "#1a2a7a",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </header>

      <section
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "16px",
          paddingBottom: keyboardHeight > 0 ? 16 + keyboardHeight : 16,
          transition: "padding-bottom 0.25s ease",
        }}
      >
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "#666", fontWeight: 500 }}>제목</p>
        <input
          className="profileEditField"
          value={draft.title}
          maxLength={60}
          onChange={(e) => onTitleChange(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
        <p style={{ margin: "4px 0 20px", fontSize: 11, color: "#999", textAlign: "right" }}>
          {draft.title.length}/60
        </p>

        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: "#666", fontWeight: 500 }}>
            장소 ({draft.items.length}개)
          </p>
          <button
            type="button"
            onClick={onOpenAddPlace}
            style={{
              border: "none",
              background: "transparent",
              color: "#1a2a7a",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              padding: "4px 8px",
            }}
          >
            + 장소 추가
          </button>
        </header>

        {draft.items.length === 0 ? (
          <section style={{ textAlign: "center", padding: "24px 0" }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#888" }}>코스에 장소를 추가해주세요</p>
            <button
              type="button"
              onClick={onOpenAddPlace}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #1a2a7a",
                background: "#fff",
                color: "#1a2a7a",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              + 장소 추가
            </button>
          </section>
        ) : (
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {draft.items.map((item, idx) => (
              <article
                key={`${item.id}-${idx}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  background: "#f7f7f7",
                  borderRadius: 12,
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "#1a2a7a",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {idx + 1}
                </span>
                <section style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#1a1a2e",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.name}
                  </p>
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: 11,
                      color: "#888",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {categoryPin[item.category as Category]?.emoji ?? "📍"} {item.category} · {item.address}
                  </p>
                </section>
                <section style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveItem(idx, "up");
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      background: "#fff",
                      color: idx === 0 ? "#ccc" : "#333",
                      fontSize: 12,
                      cursor: idx === 0 ? "not-allowed" : "pointer",
                      padding: 0,
                    }}
                    aria-label="위로"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={idx === draft.items.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveItem(idx, "down");
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      background: "#fff",
                      color: idx === draft.items.length - 1 ? "#ccc" : "#333",
                      fontSize: 12,
                      cursor: idx === draft.items.length - 1 ? "not-allowed" : "pointer",
                      padding: 0,
                    }}
                    aria-label="아래로"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveItem(idx);
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      background: "#fff",
                      color: "#e53935",
                      fontSize: 12,
                      cursor: "pointer",
                      padding: 0,
                    }}
                    aria-label="삭제"
                  >
                    🗑
                  </button>
                </section>
              </article>
            ))}
          </section>
        )}
        <span style={{ display: "block", height: 24 }} />
      </section>

      {showAddPlace && (
        <section
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100001,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={onCloseAddPlace}
        >
          <section
            style={{
              background: "#fff",
              width: "100%",
              maxHeight: "70vh",
              borderRadius: "20px 20px 0 0",
              padding: "20px 16px calc(24px + env(safe-area-inset-bottom, 0px))",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600, color: "#1a1a2e" }}>장소 추가</span>
              <button
                type="button"
                onClick={onCloseAddPlace}
                style={{ border: "none", background: "transparent", fontSize: 20, color: "#bbb", cursor: "pointer" }}
              >
                ×
              </button>
            </header>
            <section style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {addablePlaces.length === 0 ? (
                <p style={{ margin: 0, textAlign: "center", fontSize: 13, color: "#888", padding: "24px 0" }}>
                  추가할 수 있는 핀이 없어요
                </p>
              ) : (
                addablePlaces.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    onClick={() => onAddPlace(place)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 4px",
                      border: "none",
                      borderBottom: "0.5px solid #f0f0f0",
                      background: "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "inherit",
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        background: categoryColors[place.category],
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        flexShrink: 0,
                      }}
                    >
                      {categoryPin[place.category].emoji}
                    </span>
                    <section style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#1a1a2e" }}>{place.name}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888" }}>
                        {place.category} · {place.address}
                      </p>
                    </section>
                  </button>
                ))
              )}
            </section>
          </section>
        </section>
      )}
    </section>
  );
}
