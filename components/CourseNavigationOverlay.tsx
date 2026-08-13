"use client";

import { useEffect, useRef } from "react";
import {
  formatSegmentWalkSummary,
  formatWalkDistance,
  formatWalkDuration,
  resolveWalkTurnKind,
  walkTurnKindLabel,
  type CourseWalkNavigation,
  type CourseWalkSegment,
  type CourseWalkStep,
  type WalkTurnKind,
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
  /** 관리자 코스 딤 지도용 — 반투명 검정 + 흰 글씨 */
  darkTone?: boolean;
  /** 관리자 전용 턴바이턴 패널 */
  showTurnByTurn?: boolean;
  /** 현재 강조 안내 인덱스 (GPS 단계에서 자동 갱신 예정) */
  activeStepIndex?: number | null;
  onSelectStep?: (stepIndex: number) => void;
};

function TurnKindIcon({ kind }: { kind: WalkTurnKind }) {
  const label = walkTurnKindLabel(kind);
  let glyph = "·";
  switch (kind) {
    case "start":
      glyph = "▶";
      break;
    case "straight":
      glyph = "↑";
      break;
    case "left":
      glyph = "↰";
      break;
    case "right":
      glyph = "↱";
      break;
    case "crosswalk":
      glyph = "▥";
      break;
    case "arrive":
      glyph = "●";
      break;
    default:
      glyph = "·";
  }
  return (
    <span className="courseNavStepIcon" data-kind={kind} aria-label={label} title={label}>
      {glyph}
    </span>
  );
}

function StepRow({
  step,
  index,
  active,
  onSelect,
}: {
  step: CourseWalkStep;
  index: number;
  active: boolean;
  onSelect?: (index: number) => void;
}) {
  const kind = resolveWalkTurnKind(step);
  return (
    <button
      type="button"
      className={active ? "courseNavStepRow courseNavStepRowActive" : "courseNavStepRow"}
      data-step-index={index}
      data-active={active ? "true" : "false"}
      onClick={() => onSelect?.(index)}
    >
      <TurnKindIcon kind={kind} />
      <span className="courseNavStepText">{step.description}</span>
    </button>
  );
}

export function CourseNavigationOverlay({
  navigation,
  selectedSegmentIndex,
  segmentFocusMode,
  onSelectSegment,
  onPrevSegment,
  onNextSegment,
  onToggleFocusMode,
  onShowFullRoute,
  darkTone = false,
  showTurnByTurn = false,
  activeStepIndex = null,
  onSelectStep,
}: Props) {
  const activeSegment =
    selectedSegmentIndex != null
      ? navigation.segments[selectedSegmentIndex] ?? null
      : null;
  const segmentCount = navigation.segments.length;
  const rootClass = darkTone ? "courseNavOverlay courseNavOverlayDark" : "courseNavOverlay";
  const stepsListRef = useRef<HTMLDivElement>(null);
  const showSteps = Boolean(showTurnByTurn && activeSegment && activeSegment.steps.length > 0);

  useEffect(() => {
    if (!showSteps || activeStepIndex == null) return;
    const root = stepsListRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-step-index="${activeStepIndex}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showSteps, activeStepIndex, activeSegment?.index]);

  return (
    <div className={rootClass} role="region" aria-label="코스 내비게이션">
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

      {showSteps && activeSegment && (
        <div className="courseNavTurnPanel" data-gps-ready="true">
          <div className="courseNavSegmentSummary">{formatSegmentWalkSummary(activeSegment)}</div>
          <div
            ref={stepsListRef}
            className="courseNavStepsList"
            role="list"
            aria-label="구간 턴바이턴 안내"
          >
            {activeSegment.steps.map((step, i) => (
              <StepRow
                key={`${activeSegment.index}-${i}-${step.lat}-${step.lng}`}
                step={step}
                index={i}
                active={activeStepIndex === i}
                onSelect={onSelectStep}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export type { CourseWalkNavigation, CourseWalkSegment, CourseWalkStep, WalkTurnKind };
