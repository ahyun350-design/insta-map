"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const DRAG_TOGGLE_PX = 56;
const DRAG_START_PX = 8;

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
  const expandedStepsHeightRef = useRef(0);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartCollapsedRef = useRef(false);
  const didDragRef = useRef(false);
  const showSteps = Boolean(showTurnByTurn && activeSegment && activeSegment.steps.length > 0);

  const expandedStepsMaxPx =
    typeof window !== "undefined"
      ? Math.round(window.innerHeight * 0.4 - 56)
      : 220;

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
    setDragOffsetY(0);
    setDragging(false);
  }, [selectedSegmentIndex]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onPanelMetrics) return;
    const report = () => {
      onPanelMetrics({
        heightPx: el.offsetHeight,
        collapsed: panelCollapsed && !dragging,
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    onPanelMetrics,
    panelCollapsed,
    dragging,
    dragOffsetY,
    showSteps,
    segmentFocusMode,
    selectedSegmentIndex,
    activeSegment?.index,
  ]);

  useEffect(() => {
    if (!panelCollapsed && stepsListRef.current) {
      const h = stepsListRef.current.scrollHeight;
      if (h > 40) expandedStepsHeightRef.current = Math.min(h, expandedStepsMaxPx);
    }
  }, [panelCollapsed, activeSegment?.index, activeSegment?.steps.length, expandedStepsMaxPx]);

  const stepsVisibleHeight = (() => {
    const base = expandedStepsHeightRef.current || expandedStepsMaxPx;
    if (panelCollapsed) {
      // 접힌 상태에서 위로 드래그하면 목록이 따라 열림
      const openBy = dragging ? Math.max(0, -dragOffsetY) : 0;
      return Math.min(base, openBy);
    }
    // 펼친 상태에서 아래로 드래그하면 목록이 줄어듦
    const shrink = dragging ? Math.max(0, dragOffsetY) : 0;
    return Math.max(0, base - shrink);
  })();

  const finishPanelDrag = useCallback(() => {
    if (!dragging) return;
    const dy = dragOffsetY;
    const startedCollapsed = dragStartCollapsedRef.current;
    setDragging(false);
    setDragOffsetY(0);
    if (!didDragRef.current) {
      setPanelCollapsed((v) => !v);
      return;
    }
    if (!startedCollapsed && dy > DRAG_TOGGLE_PX) {
      setPanelCollapsed(true);
      return;
    }
    if (startedCollapsed && dy < -DRAG_TOGGLE_PX) {
      setPanelCollapsed(false);
    }
  }, [dragging, dragOffsetY]);

  const onPanelPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    dragStartYRef.current = e.clientY;
    dragStartCollapsedRef.current = panelCollapsed;
    didDragRef.current = false;
    setDragging(true);
    setDragOffsetY(0);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPanelPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragging) return;
    const dy = e.clientY - dragStartYRef.current;
    if (Math.abs(dy) > DRAG_START_PX) didDragRef.current = true;
    setDragOffsetY(dy);
  };

  const onPanelPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    finishPanelDrag();
  };

  const onPanelPointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    setDragOffsetY(0);
  };

  return (
    <div
      ref={rootRef}
      className={rootClass}
      role="region"
      aria-label="코스 내비게이션"
      data-panel-collapsed={panelCollapsed ? "true" : "false"}
      data-panel-dragging={dragging ? "true" : "false"}
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
          <div
            className="courseNavPanelDragZone"
            onPointerDown={onPanelPointerDown}
            onPointerMove={onPanelPointerMove}
            onPointerUp={onPanelPointerUp}
            onPointerCancel={onPanelPointerCancel}
            role="button"
            tabIndex={0}
            aria-expanded={!panelCollapsed}
            aria-label={panelCollapsed ? "안내 패널 펼치기" : "안내 패널 접기"}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setPanelCollapsed((v) => !v);
              }
            }}
          >
            <span className="courseNavPanelHandleBar" aria-hidden />
            <div className="courseNavSegmentSummary">{formatSegmentWalkSummary(activeSegment)}</div>
          </div>
          {(stepsVisibleHeight > 2 || (!panelCollapsed && !dragging)) && (
            <div
              ref={stepsListRef}
              className="courseNavStepsList"
              role="list"
              aria-label="구간 턴바이턴 안내"
              style={{
                maxHeight: dragging || panelCollapsed ? stepsVisibleHeight : undefined,
                height: dragging || panelCollapsed ? stepsVisibleHeight : undefined,
                overflow: stepsVisibleHeight < 8 ? "hidden" : "auto",
                opacity: stepsVisibleHeight < 12 ? Math.max(0, stepsVisibleHeight / 12) : 1,
                transition: dragging ? "none" : "max-height 0.22s ease, height 0.22s ease, opacity 0.18s ease",
              }}
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
