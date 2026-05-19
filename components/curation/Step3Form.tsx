"use client";

import { COMPANION_TAG_OPTIONS, type CompanionTag } from "@/lib/companionTag";
import type { CurationCategory } from "@/components/curation/types";

type Props = {
  title: string;
  onTitleChange: (value: string) => void;
  category: CurationCategory;
  onCategoryChange: (category: CurationCategory) => void;
  categoryMainOrder: CurationCategory[];
  categoryPin: Record<CurationCategory, { color: string; emoji: string }>;
  categoryColors: Record<CurationCategory, string>;
  companionTag: CompanionTag | null;
  onCompanionTagChange: (tag: CompanionTag) => void;
  comment: string;
  onCommentChange: (value: string) => void;
  validationHint: string | null;
  onFieldFocus: (el: HTMLElement | null) => void;
};

export function Step3Form({
  title,
  onTitleChange,
  category,
  onCategoryChange,
  categoryMainOrder,
  categoryPin,
  categoryColors,
  companionTag,
  onCompanionTagChange,
  comment,
  onCommentChange,
  validationHint,
  onFieldFocus,
}: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={{ fontSize: "11px", color: "#1a2a7a", letterSpacing: "1px", marginBottom: 6, marginTop: 0 }}>제목</p>
        <input
          className="mapInput"
          placeholder="한 줄로 표현해보세요"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onFocus={(e) => onFieldFocus(e.currentTarget)}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
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
          onFocus={(e) => onFieldFocus(e.currentTarget)}
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
  );
}
