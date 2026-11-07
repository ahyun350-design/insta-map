"use client";

import { useMemo } from "react";
import { CATEGORY_CHIPS, type CategoryChipId } from "@/lib/adminMapCategory";
import { poiCategoryIconSvg } from "@/lib/mapSurface/poiCategoryIcons";

type Props = {
  active: CategoryChipId | null;
  loading: CategoryChipId | null;
  onPick: (id: CategoryChipId) => void;
};

/** Admin expanded MapLibre: horizontally scrolling category chips under the search pill. */
export function AdminMapCategoryChips({ active, loading, onPick }: Props) {
  const icons = useMemo(
    () =>
      Object.fromEntries(
        CATEGORY_CHIPS.map((c) => [c.id, `data:image/svg+xml;utf8,${encodeURIComponent(poiCategoryIconSvg(c.icon))}`]),
      ) as Record<CategoryChipId, string>,
    [],
  );
  return (
    <div className="adminMapCategoryChips" data-testid="admin-map-category-chips" role="toolbar" aria-label="카테고리">
      {CATEGORY_CHIPS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`adminMapCategoryChip${active === c.id ? " is-on" : ""}`}
          data-testid="admin-map-category-chip"
          data-chip={c.id}
          aria-pressed={active === c.id}
          aria-busy={loading === c.id}
          onClick={() => onPick(c.id)}
        >
          <img src={icons[c.id]} alt="" width={18} height={18} aria-hidden />
          {c.label}
        </button>
      ))}
    </div>
  );
}
