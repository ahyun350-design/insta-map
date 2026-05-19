"use client";

import { COMPANION_FILTER_CHIPS, type CompanionTagFilter } from "@/lib/companionTag";

type Props = {
  value: CompanionTagFilter;
  onChange: (value: CompanionTagFilter) => void;
};

export function CompanionTagFilterChips({ value, onChange }: Props) {
  return (
    <div className="companionFilterChips" role="tablist" aria-label="동행 태그 필터">
      {COMPANION_FILTER_CHIPS.map((chip) => {
        const selected = value === chip.value;
        const label = chip.value === "all" ? chip.label : `${chip.emoji} ${chip.label}`;
        return (
          <button
            key={chip.value}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? "companionFilterChip companionFilterChipSelected" : "companionFilterChip"}
            onClick={() => onChange(chip.value)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
