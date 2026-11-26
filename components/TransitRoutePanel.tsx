"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  TRANSIT_NO_RESULTS_MESSAGE,
  buildTransitDetailRows,
  formatClockFromOffset,
  formatTransitBadgeName,
  formatTransitMinutes,
  transitDepartureArrivalLabel,
  transitRideSummaryParts,
  transitTimelineSegments,
  type TransitRoute,
} from "@/lib/mapTransit";

type Mode = "transit" | "car" | "walk";

type Props = {
  loading: boolean;
  error: string | null;
  routes: TransitRoute[];
  selectedIndex: number | null;
  originLabel?: string;
  destLabel?: string;
  modeTimes?: {
    transit: number | null;
    car: number | null;
    walk: number | null;
    walkFailed?: boolean;
  };
  onSelect: (index: number) => void;
  onBackToList: () => void;
  onClose: () => void;
  onWalkFallback: () => void;
  onModeChange?: (mode: Mode) => void;
  /** Measured panel height (px) for camera fit above the panel. */
  onPanelHeight?: (heightPx: number) => void;
};

function LineBadge({ name, colour }: { name: string; colour: string }) {
  const label = formatTransitBadgeName(name) || name;
  return (
    <span className="transitRouteBadge" style={{ background: colour }} title={name}>
      {label}
    </span>
  );
}

export default function TransitRoutePanel({
  loading,
  error,
  routes,
  selectedIndex,
  originLabel = "내 위치",
  destLabel = "도착",
  modeTimes,
  onSelect,
  onBackToList,
  onClose,
  onWalkFallback,
  onModeChange,
  onPanelHeight,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [openStopIds, setOpenStopIds] = useState<Record<string, boolean>>({});
  const dragRef = useRef<{ y: number; expanded: boolean } | null>(null);

  const empty =
    !loading &&
    (error === "no_results" ||
      error === "too_close" ||
      error === "NO_RESULTS" ||
      error === "EQUAL_POINTS" ||
      (routes.length === 0 && !error));

  const selected = selectedIndex != null ? routes[selectedIndex] : null;
  const inDetail = selected != null;
  const transitMin =
    modeTimes?.transit ??
    (routes[0] ? formatTransitMinutes(routes[0].totalTimeSec) : null);
  const walkFailed = Boolean(modeTimes?.walkFailed);
  const walkMin = modeTimes?.walk ?? null;

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onPanelHeight) return;
    const report = () => {
      const h = el.getBoundingClientRect().height;
      if (Number.isFinite(h) && h > 0) onPanelHeight(h);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onPanelHeight, selectedIndex, loading, empty, routes.length, sheetExpanded, openStopIds]);

  useEffect(() => {
    setOpenStopIds({});
    // Detail opens at ~60% height (not fully collapsed).
    setSheetExpanded(false);
  }, [selectedIndex]);

  const onHandlePointerDown = (e: ReactPointerEvent) => {
    dragRef.current = { y: e.clientY, expanded: sheetExpanded };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onHandlePointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (dy > 36) setSheetExpanded(true);
    if (dy < -36) setSheetExpanded(false);
  };
  const onHandlePointerUp = () => {
    dragRef.current = null;
  };

  const detailRows = selected
    ? buildTransitDetailRows(selected, { originLabel, destLabel })
    : [];

  const panelClass = [
    "transitRoutePanel",
    inDetail ? "is-detail" : "",
    sheetExpanded ? "is-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rootRef}
      className={panelClass}
      data-testid="transit-route-panel"
      data-expanded={sheetExpanded ? "1" : "0"}
      data-detail={inDetail ? "1" : "0"}
    >
      <div
        className="transitRoutePanelHandle"
        data-testid="transit-panel-handle"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        role="presentation"
      >
        <span className="transitRoutePanelHandleBar" />
      </div>

      <div className="transitRouteTopChrome" data-testid="transit-top-chrome">
        <div className="transitRouteOdRow">
          <span className="transitRouteOdFrom">{originLabel}</span>
          <span className="transitRouteOdArrow" aria-hidden>
            →
          </span>
          <span className="transitRouteOdTo" data-testid="transit-dest-label">
            {destLabel}
          </span>
          <button type="button" className="transitRoutePanelClose" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="transitRouteModeTabs" role="tablist" aria-label="이동수단">
          {(
            [
              { id: "transit" as const, label: "대중교통", min: transitMin, disabled: false },
              { id: "car" as const, label: "자동차", min: modeTimes?.car ?? null, disabled: false },
              {
                id: "walk" as const,
                label: "도보",
                min: walkMin,
                disabled: walkFailed,
              },
            ] as const
          ).map((m) => {
            const walkEmpty = m.id === "walk" && walkFailed;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={m.id === "transit"}
                disabled={m.disabled}
                className={
                  m.id === "transit"
                    ? "transitRouteModeTab is-active"
                    : m.disabled
                      ? "transitRouteModeTab is-disabled"
                      : "transitRouteModeTab"
                }
                data-testid={`transit-mode-${m.id}`}
                onClick={() => {
                  if (m.disabled) return;
                  onModeChange?.(m.id);
                }}
              >
                <span>{m.label}</span>
                <strong>
                  {walkEmpty
                    ? "도보 정보 없음"
                    : m.min != null
                      ? `${m.min}분`
                      : "—"}
                </strong>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <p className="transitRoutePanelHint" data-testid="transit-loading">
          경로 검색 중...
        </p>
      ) : null}

      {empty ? (
        <div className="transitRouteEmpty" data-testid="transit-no-results">
          <p>{TRANSIT_NO_RESULTS_MESSAGE}</p>
          <button type="button" className="transitRouteWalkBtn" onClick={onWalkFallback}>
            도보
          </button>
        </div>
      ) : null}

      {!loading && !empty && error ? (
        <p className="transitRoutePanelHint" data-testid="transit-error">
          경로를 불러오지 못했어요
        </p>
      ) : null}

      {!loading && !empty && routes.length > 0 && selectedIndex == null ? (
        <ul className="transitRouteList" data-testid="transit-route-list">
          {routes.map((r, i) => {
            const times = transitDepartureArrivalLabel(r.totalTimeSec);
            const bar = transitTimelineSegments(r);
            const summary = transitRideSummaryParts(r);
            return (
              <li key={i}>
                <button
                  type="button"
                  className="transitRouteItem"
                  data-testid="transit-route-item"
                  onClick={() => onSelect(i)}
                >
                  <div className="transitRouteItemTop">
                    <strong className="transitRouteItemTime">
                      {formatTransitMinutes(r.totalTimeSec)}분
                    </strong>
                    <span className="transitRouteItemClock">
                      {times.depart}–{times.arrive}
                    </span>
                    {r.fareWon != null ? (
                      <span>{r.fareWon.toLocaleString("ko-KR")}원</span>
                    ) : null}
                    <span>환승 {r.transfers}회</span>
                  </div>
                  <div className="transitRouteTimeline" aria-hidden>
                    {bar.map((seg, si) => (
                      <span
                        key={si}
                        className={`transitRouteTimelineSeg is-${seg.kind}`}
                        style={{
                          flexGrow: Math.max(seg.ratio, 0.08),
                          background: seg.colour,
                        }}
                        title={`${seg.minutes}분`}
                      >
                        <em>{seg.minutes}</em>
                      </span>
                    ))}
                  </div>
                  <div className="transitRouteRideLine" data-testid="transit-ride-line">
                    {summary.map((p, pi) =>
                      p.kind === "alight" ? (
                        <span key={pi} className="transitRouteRideAlight">
                          {pi > 0 ? <span className="transitRouteRideSep"> → </span> : null}
                          하차 {p.stop}
                        </span>
                      ) : (
                        <span key={pi} className="transitRouteRidePart">
                          {pi > 0 ? <span className="transitRouteRideSep"> → </span> : null}
                          <LineBadge
                            name={p.typeLabel && p.alts ? p.typeLabel : p.badge}
                            colour={p.colour}
                          />
                          {p.board ? (
                            <span className="transitRouteRideBoard"> {p.board}</span>
                          ) : null}
                          {p.alts ? (
                            <span className="transitRouteRideAlts"> {p.alts}</span>
                          ) : null}
                        </span>
                      ),
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {selected ? (
        <div className="transitRouteDetail" data-testid="transit-route-detail">
          <button
            type="button"
            className="transitRouteBack"
            onClick={onBackToList}
            aria-label="경로 목록"
          >
            ← 목록
          </button>
          <p className="transitRouteDetailMeta">
            <strong>{formatTransitMinutes(selected.totalTimeSec)}분</strong>
            <span>
              {transitDepartureArrivalLabel(selected.totalTimeSec).depart}–
              {transitDepartureArrivalLabel(selected.totalTimeSec).arrive}
            </span>
            <span>환승 {selected.transfers}회</span>
            {selected.fareWon != null ? (
              <span>{selected.fareWon.toLocaleString("ko-KR")}원</span>
            ) : null}
          </p>
          <ol className="transitRouteSteps" data-testid="transit-detail-steps">
            {detailRows.map((row, idx) => {
              const clock = formatClockFromOffset(row.atSec);
              const next = detailRows[idx + 1];
              const railKind =
                row.kind === "walk"
                  ? "walk"
                  : row.kind === "place"
                    ? next?.kind === "walk"
                      ? "walk"
                      : "ride"
                    : "rail" in row
                      ? row.rail
                      : "ride";
              const railColour =
                row.kind === "board" || row.kind === "ride" || row.kind === "alight"
                  ? row.colour
                  : undefined;

              return (
                <li
                  key={row.id}
                  className={`transitRouteStep is-${row.kind}${row.emphasis ? " is-emphasis" : " is-muted"}`}
                >
                  {row.emphasis ? (
                    <span className="transitRouteStepClock" data-testid="transit-step-clock">
                      {clock}
                    </span>
                  ) : (
                    <span className="transitRouteStepClock is-empty" aria-hidden />
                  )}
                  <div className="transitRouteStepRailCol" aria-hidden>
                    {row.kind === "place" ? (
                      <span
                        className="transitRoutePlaceDot"
                        data-role={row.role}
                      />
                    ) : row.kind === "board" || row.kind === "alight" ? (
                      <span
                        className="transitRouteNodeDot"
                        style={{ borderColor: row.colour }}
                      />
                    ) : row.kind === "walk" ? (
                      <span className="transitRouteWalkDot" />
                    ) : (
                      <span className="transitRouteRideRailPad" />
                    )}
                    {idx < detailRows.length - 1 ? (
                      <span
                        className={`transitRouteVertRail is-${railKind}`}
                        style={
                          railKind === "ride" && railColour
                            ? { background: railColour }
                            : undefined
                        }
                      />
                    ) : null}
                  </div>
                  <div className="transitRouteStepBody">
                    {row.kind === "place" ? (
                      <p className="transitRouteStepPrimary">{row.label}</p>
                    ) : null}
                    {row.kind === "walk" ? (
                      <p className="transitRouteStepSecondary" data-testid="transit-walk-step">
                        {row.fromOrigin ? "내 위치 → " : ""}
                        {row.toLabel
                          ? row.exit
                            ? `${row.toLabel} ${row.exit}까지 도보 `
                            : `${row.toLabel}까지 도보 `
                          : row.exit
                            ? `${row.exit}까지 도보 `
                            : "도보 "}
                        {row.distanceM > 0 ? `${row.distanceM}m·` : ""}
                        {row.minutes}분
                      </p>
                    ) : null}
                    {row.kind === "board" ? (
                      <>
                        <p className="transitRouteStepPrimary">
                          <LineBadge name={row.line} colour={row.colour} />
                          <span>{row.stopLabel}</span>
                        </p>
                        {row.bound ? (
                          <p className="transitRouteStepSecondary">{row.bound}</p>
                        ) : null}
                      </>
                    ) : null}
                    {row.kind === "ride" ? (
                      <div className="transitRouteRideBody">
                        <button
                          type="button"
                          className="transitRouteRideToggle"
                          data-testid="transit-stops-toggle"
                          aria-expanded={!!openStopIds[row.id]}
                          onClick={() =>
                            setOpenStopIds((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
                          }
                        >
                          {row.hopLabel} 이동·{row.minutes}분{" "}
                          {openStopIds[row.id] ? "▾" : "▸"}
                        </button>
                        {openStopIds[row.id] ? (
                          <ul className="transitRouteStopList" data-testid="transit-stop-list">
                            {row.middleStops.map((n, si) => (
                              <li key={`${row.id}-${si}`}>{n}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                    {row.kind === "alight" ? (
                      <p className="transitRouteStepPrimary">{row.stopLabel}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
