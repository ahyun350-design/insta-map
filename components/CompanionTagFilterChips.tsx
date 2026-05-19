"use client";

import { COMPANION_FILTER_CHIPS, type CompanionTagFilter } from "@/lib/companionTag";

type Props = {
  value: CompanionTagFilter;
  onChange: (value: CompanionTagFilter) => void;
};

export function CompanionTagFilterChips({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="동행 태그 필터"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        display: "flex",
        gap: 8,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        padding: "2px 0 10px",
        marginBottom: 2,
        background: "var(--white, #fff)",
      }}
    >
      {COMPANION_FILTER_CHIPS.map((chip) => {
        const selected = value === chip.value;
        const label = chip.value === "all" ? chip.label : `${chip.emoji} ${chip.label}`;
        return (
          <button
            key={chip.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(chip.value)}
            style={{
              flexShrink: 0,
              padding: "8px 14px",
              borderRadius: 20,
              border: `1px solid ${selected ? "#1a1a1a" : "#e5e5e5"}`,
              background: selected ? "#1a1a1a" : "#fff",
              color: selected ? "#fff" : "#666",
              fontSize: 12,
              fontWeight: selected ? 600 : 500,
              cursor: "pointer",
              fontFamily: "inherit",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
