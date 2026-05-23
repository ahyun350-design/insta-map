"use client";

type Props = {
  visible: boolean;
  onResearch: () => void;
};

export function MapResearchAreaButton({ visible, onResearch }: Props) {
  if (!visible) return null;

  return (
    <button type="button" className="mapResearchAreaBtn" onClick={onResearch} aria-label="이 지역 재검색">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path
          d="M11.2 4.2V2H9M2.8 9.8V12H5"
          stroke="#1a2a7a"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2.5 7a4.5 4.5 0 0 1 7.6-3.2L11.2 4.2M11.5 7a4.5 4.5 0 0 1-7.6 3.2L2.8 9.8"
          stroke="#1a2a7a"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>이 지역 재검색</span>
    </button>
  );
}
