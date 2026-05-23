"use client";

import { COMPANION_FILTER_CHIPS, type CompanionTag } from "@/lib/companionTag";
import type { CurationCategory } from "@/components/curation/types";

const COMPANION_STEP3_CHIPS = COMPANION_FILTER_CHIPS.filter((chip) => chip.value !== "all");

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
  saveCourseChecked: boolean;
  onSaveCourseCheckedChange: (checked: boolean) => void;
  canSaveAsCourse: boolean;
  courseTitle: string;
  onCourseTitleChange: (value: string) => void;
  validationHint: string | null;
  onFieldFocus: (el: HTMLElement | null) => void;
};

export function Step3Form({
  title,
  onTitleChange,
  category,
  onCategoryChange,
  categoryMainOrder,
  companionTag,
  onCompanionTagChange,
  comment,
  onCommentChange,
  saveCourseChecked,
  onSaveCourseCheckedChange,
  canSaveAsCourse,
  courseTitle,
  onCourseTitleChange,
  validationHint,
  onFieldFocus,
}: Props) {
  return (
    <div className="curationStep3Form">
      <div className="curationFormSection">
        <p className="curationFormLabel">제목</p>
        <input
          className="mapInput"
          placeholder="한 줄로 표현해보세요"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onFocus={(e) => onFieldFocus(e.currentTarget)}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
      </div>

      <div className="curationFormSection">
        <p className="curationFormLabel">카테고리</p>
        <div className="curationFormChips" role="radiogroup" aria-label="카테고리">
          {categoryMainOrder.map((cat) => {
            const selected = category === cat;
            return (
              <button
                key={cat}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? "curationFormChip curationFormChipSelected" : "curationFormChip"}
                onClick={() => onCategoryChange(cat)}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      <div className="curationFormSection">
        <p className="curationFormLabel">누구랑 갔어요?</p>
        <div className="curationFormChips" role="radiogroup" aria-label="동행 태그">
          {COMPANION_STEP3_CHIPS.map((chip) => {
            const selected = companionTag === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? "curationFormChip curationFormChipSelected" : "curationFormChip"}
                onClick={() => onCompanionTagChange(chip.value as CompanionTag)}
              >
                {chip.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      <div className="curationFormSection">
        <p className="curationFormLabel">코멘트</p>
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

      <div className="curationFormSection">
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: canSaveAsCourse ? "pointer" : "not-allowed",
            userSelect: "none",
            opacity: canSaveAsCourse ? 1 : 0.55,
          }}
        >
          <input
            type="checkbox"
            checked={saveCourseChecked}
            disabled={!canSaveAsCourse}
            onChange={(e) => onSaveCourseCheckedChange(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: "#1a2a7a", cursor: canSaveAsCourse ? "pointer" : "not-allowed" }}
          />
          <span style={{ fontSize: 14, color: "#333", fontWeight: 500 }}>이 장소들을 코스로도 저장</span>
        </label>
        {!canSaveAsCourse && (
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#888", lineHeight: 1.45 }}>
            장소 태그를 1개 이상 추가하면 코스로 저장할 수 있어요
          </p>
        )}
        <div
          style={{
            maxHeight: saveCourseChecked ? 72 : 0,
            opacity: saveCourseChecked ? 1 : 0,
            overflow: "hidden",
            transition: "max-height 0.28s ease, opacity 0.22s ease",
            marginTop: saveCourseChecked ? 4 : 0,
          }}
        >
          <input
            className="mapInput"
            placeholder="코스 이름을 입력하세요"
            value={courseTitle}
            onChange={(e) => onCourseTitleChange(e.target.value)}
            onFocus={(e) => onFieldFocus(e.currentTarget)}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        </div>
      </div>

      {validationHint && <p className="curationFormValidationHint">{validationHint}</p>}
    </div>
  );
}
