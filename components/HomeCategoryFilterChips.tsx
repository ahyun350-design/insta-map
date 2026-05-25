"use client";

import type { FeedPostCategory } from "@/lib/feedPost";

export type HomeCategoryFilter = "all" | FeedPostCategory;

const CATEGORY_ORDER: FeedPostCategory[] = ["맛집", "카페", "쇼핑", "숙소", "놀거리", "여행지"];

type Props = {
  value: HomeCategoryFilter;
  onChange: (value: HomeCategoryFilter) => void;
};

export function HomeCategoryFilterChips({ value, onChange }: Props) {
  return (
    <div className="categoryFilterTabs" role="tablist" aria-label="카테고리 필터">
      <button
        type="button"
        role="tab"
        aria-selected={value === "all"}
        className={value === "all" ? "categoryFilterTab categoryFilterTabSelected" : "categoryFilterTab"}
        onClick={() => onChange("all")}
      >
        전체
      </button>
      {CATEGORY_ORDER.map((cat) => {
        const selected = value === cat;
        return (
          <button
            key={cat}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? "categoryFilterTab categoryFilterTabSelected" : "categoryFilterTab"}
            onClick={() => onChange(cat)}
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}
