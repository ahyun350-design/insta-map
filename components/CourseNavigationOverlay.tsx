"use client";

import {
  formatWalkDistance,
  formatWalkDuration,
  type CourseWalkNavigation,
  type CourseWalkSegment,
} from "@/lib/courseWalkNavigation";

type Props = {
  navigation: CourseWalkNavigation;
  selectedSegmentIndex: number | null;
  segmentFocusMode: boolean;
  onSelectSegment: (index: number) => void;
  onPrevSegment: () => void;
  onNextSegment: () => void;
  onToggleFocusMode: () => void;
  onShowFullRoute: () => void;
};

export function CourseNavigationOverlay({
  navigation,
  selectedSegmentIndex,
  segmentFocusMode,
  onSelectSegment,
  onPrevSegment,
  onNextSegment,
  onToggleFocusMode,
  onShowFullRoute,
}: Props) {
  const activeSegment =
    selectedSegmentIndex != null
      ? navigation.segments[selectedSegmentIndex] ?? null
      : null;
  const segmentCount = navigation.segments.length;

  return (
    <div className="courseNavOverlay" role="region" aria-label="코스 내비게이션">
      <div className="courseNavSummary">
        전체 도보 {formatWalkDuration(navigation.totalTimeSec)} ·{" "}
        {formatWalkDistance(navigation.totalDistanceM)} · 장소 {navigation.placeCount}곳
      </div>

      <div className="courseNavSegmentRow">
        {navigation.segments.map((segment) => (
          <button
            key={segment.index}
            type="button"
            className={
              selectedSegmentIndex === segment.index
                ? "courseNavSegmentChip courseNavSegmentChipActive"
                : "courseNavSegmentChip"
            }
            onClick={() => onSelectSegment(segment.index)}
          >
            {segment.index + 1}→{segment.index + 2} {segment.toName}
          </button>
        ))}
      </div>

      {segmentFocusMode && activeSegment && (
        <div className="courseNavFocusBar">
          <button type="button" className="courseNavFocusBtn" onClick={onPrevSegment} disabled={selectedSegmentIndex === 0}>
            이전
          </button>
          <span className="courseNavFocusLabel">
            구간 {(selectedSegmentIndex ?? 0) + 1}/{segmentCount}
          </span>
          <button
            type="button"
            className="courseNavFocusBtn"
            onClick={onNextSegment}
            disabled={selectedSegmentIndex == null || selectedSegmentIndex >= segmentCount - 1}
          >
            다음
          </button>
          <button type="button" className="courseNavFocusBtn courseNavFocusBtnPrimary" onClick={onShowFullRoute}>
            전체 보기
          </button>
        </div>
      )}

      {activeSegment && !segmentFocusMode && (
        <div className="courseNavFocusToggle">
          <button type="button" className="courseNavFocusBtn courseNavFocusBtnPrimary" onClick={onToggleFocusMode}>
            구간만 보기
          </button>
        </div>
      )}
    </div>
  );
}

export type { CourseWalkNavigation, CourseWalkSegment };
