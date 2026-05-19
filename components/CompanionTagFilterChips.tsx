"use client";

import { COMPANION_FILTER_CHIPS, type CompanionTagFilter } from "@/lib/companionTag";

type Props = {
  value: CompanionTagFilter;
  onChange: (value: CompanionTagFilter) => void;
};

export function CompanionTagFilterChips({ value, onChange }: Props) {
  return (
    <div className="companionFilterTabs" role="tablist" aria-label="동행 태그 필터">
      {COMPANION_FILTER_CHIPS.map((chip) => {
        const selected = value === chip.value;
        return (
          <button
            key={chip.value}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? "companionFilterTab companionFilterTabSelected" : "companionFilterTab"}
            onClick={() => onChange(chip.value)}
          >
            {chip.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
