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
      <section className="curationFormSection">
        <p className="curationFormLabel">제목</p>
        <input
          className="curationFormField"
          placeholder="한 줄로 표현해보세요"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onFocus={(e) => onFieldFocus(e.currentTarget)}
        />
      </section>

      <section className="curationFormSection">
        <p className="curationFormLabel">코멘트</p>
        <textarea
          className="curationFormField curationFormTextarea"
          placeholder="이 장소에 대한 느낌을 자유롭게 적어주세요"
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          onFocus={(e) => onFieldFocus(e.currentTarget)}
          rows={5}
        />
      </section>

      <section className="curationFormSection">
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
      </section>

      <section className="curationFormSection">
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
      </section>

      <section className="curationFormSection curationFormSectionCourse">
        <div className={`curationFormCourseBox${canSaveAsCourse ? "" : " curationFormCourseBoxDisabled"}`}>
          <label className="curationFormCourseCheck">
            <input
              type="checkbox"
              className="curationFormCourseCheckbox"
              checked={saveCourseChecked}
              disabled={!canSaveAsCourse}
              onChange={(e) => onSaveCourseCheckedChange(e.target.checked)}
            />
            <span className="curationFormCourseCheckLabel">이 장소들을 코스로도 저장</span>
          </label>
          {!canSaveAsCourse && (
            <p className="curationFormCourseHint">장소 태그를 1개 이상 추가하면 코스로 저장할 수 있어요</p>
          )}
          <div
            className={
              saveCourseChecked && canSaveAsCourse
                ? "curationFormCourseTitleWrap curationFormCourseTitleWrapOpen"
                : "curationFormCourseTitleWrap"
            }
          >
            <input
              className="curationFormField"
              placeholder="코스 이름을 입력하세요"
              value={courseTitle}
              onChange={(e) => onCourseTitleChange(e.target.value)}
              onFocus={(e) => onFieldFocus(e.currentTarget)}
              disabled={!canSaveAsCourse}
            />
          </div>
        </div>
      </section>

      {validationHint && <p className="curationFormValidationHint">{validationHint}</p>}
    </div>
  );
}
