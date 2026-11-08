"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Props = {
  visible: boolean;
  onResearch: () => void;
  /** Sits this many px under the bottom of the matching element (same positioned parent). */
  belowSelector?: string;
};

const GAP_BELOW_PX = 8;

export function MapResearchAreaButton({ visible, onResearch, belowSelector }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!visible || !belowSelector) return;
    const btn = ref.current;
    const parent = btn?.offsetParent as HTMLElement | null;
    const anchor = parent?.querySelector<HTMLElement>(belowSelector);
    if (!btn || !parent || !anchor) return;
    const place = () => {
      const bottom = anchor.getBoundingClientRect().bottom - parent.getBoundingClientRect().top;
      setTop(Math.round(bottom + GAP_BELOW_PX));
    };
    place();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(anchor);
    return () => ro?.disconnect();
  }, [visible, belowSelector]);

  if (!visible) return null;

  return (
    <button
      ref={ref}
      type="button"
      className="mapResearchAreaBtn"
      onClick={onResearch}
      aria-label="이 지역에서 재검색"
      style={belowSelector && top != null ? { top } : undefined}
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path
          d="M11.2 4.2V2H9M2.8 9.8V12H5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2.5 7a4.5 4.5 0 0 1 7.6-3.2L11.2 4.2M11.5 7a4.5 4.5 0 0 1-7.6 3.2L2.8 9.8"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>이 지역에서 재검색</span>
    </button>
  );
}
