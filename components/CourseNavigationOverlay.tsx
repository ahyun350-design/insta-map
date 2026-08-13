"use client";

import { useEffect, useRef, useState } from "react";
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

export type CourseNavPanelMetrics = {
  heightPx: number;
  collapsed: boolean;
};

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
  /** 하단 패널 높이·접힘 (지도 setBounds bottom padding용) */
  onPanelMetrics?: (metrics: CourseNavPanelMetrics) => void;
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
  onPanelMetrics,
}: Props) {
  const activeSegment =
    selectedSegmentIndex != null
      ? navigation.segments[selectedSegmentIndex] ?? null
      : null;
  const segmentCount = navigation.segments.length;
  const rootClass = darkTone ? "courseNavOverlay courseNavOverlayDark" : "courseNavOverlay";
  const stepsListRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const showSteps = Boolean(showTurnByTurn && activeSegment && activeSegment.steps.length > 0);

  useEffect(() => {
    if (!showSteps || activeStepIndex == null || panelCollapsed) return;
    const root = stepsListRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-step-index="${activeStepIndex}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showSteps, activeStepIndex, activeSegment?.index, panelCollapsed]);

  useEffect(() => {
    // 구간이 바뀌면 패널을 다시 펼침
    setPanelCollapsed(false);
  }, [selectedSegmentIndex]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onPanelMetrics) return;
    const report = () => {
      onPanelMetrics({
        heightPx: el.offsetHeight,
        collapsed: panelCollapsed,
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    onPanelMetrics,
    panelCollapsed,
    showSteps,
    segmentFocusMode,
    selectedSegmentIndex,
    activeSegment?.index,
  ]);

  return (
    <div
      ref={rootRef}
      className={rootClass}
      role="region"
      aria-label="코스 내비게이션"
      data-panel-collapsed={panelCollapsed ? "true" : "false"}
    >
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
        <div
          className={
            panelCollapsed
              ? "courseNavTurnPanel courseNavTurnPanelCollapsed"
              : "courseNavTurnPanel"
          }
        >
          <button
            type="button"
            className="courseNavPanelHandle"
            aria-expanded={!panelCollapsed}
            aria-label={panelCollapsed ? "안내 패널 펼치기" : "안내 패널 접기"}
            onClick={() => setPanelCollapsed((v) => !v)}
          >
            <span className="courseNavPanelHandleBar" aria-hidden />
          </button>
          <div className="courseNavSegmentSummary">{formatSegmentWalkSummary(activeSegment)}</div>
          {!panelCollapsed && (
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
          )}
        </div>
      )}
    </div>
  );
}

export type { CourseWalkNavigation, CourseWalkSegment, CourseWalkStep, WalkTurnKind };
