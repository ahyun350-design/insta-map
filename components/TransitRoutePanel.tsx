"use client";

import {
  TRANSIT_NO_RESULTS_MESSAGE,
  formatTransitMinutes,
  formatTransitStepLabel,
  type TransitRoute,
} from "@/lib/mapTransit";

type Props = {
  loading: boolean;
  error: string | null;
  routes: TransitRoute[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onBackToList: () => void;
  onClose: () => void;
  onWalkFallback: () => void;
};

function LineBadge({ name, colour }: { name: string; colour: string }) {
  const label = name.length > 4 ? name.slice(0, 4) : name;
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
  onSelect,
  onBackToList,
  onClose,
  onWalkFallback,
}: Props) {
  const empty =
    !loading &&
    (error === "no_results" ||
      error === "too_close" ||
      error === "NO_RESULTS" ||
      error === "EQUAL_POINTS" ||
      (routes.length === 0 && !error));

  const selected = selectedIndex != null ? routes[selectedIndex] : null;

  return (
    <div className="transitRoutePanel" data-testid="transit-route-panel">
      <div className="transitRoutePanelHeader">
        <p className="transitRoutePanelTitle">대중교통</p>
        <button type="button" className="transitRoutePanelClose" aria-label="닫기" onClick={onClose}>
          ×
        </button>
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
          {routes.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                className="transitRouteItem"
                data-testid="transit-route-item"
                onClick={() => onSelect(i)}
              >
                <div className="transitRouteItemTop">
                  <strong>{formatTransitMinutes(r.totalTimeSec)}분</strong>
                  <span>환승 {r.transfers}회</span>
                  <span>도보 {formatTransitMinutes(r.walkTimeSec)}분</span>
                  {r.fareWon != null ? <span>{r.fareWon.toLocaleString("ko-KR")}원</span> : null}
                </div>
                <div className="transitRouteItemBadges">
                  {r.vehicles.map((v) => {
                    const step = r.steps.find(
                      (s) => s.type !== "WALKING" && s.vehicles.some((x) => x.name === v.name),
                    );
                    return (
                      <LineBadge
                        key={`${v.type}:${v.name}`}
                        name={v.name}
                        colour={step?.colour ?? "#5A6570"}
                      />
                    );
                  })}
                </div>
              </button>
            </li>
          ))}
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
            <span>환승 {selected.transfers}회</span>
            <span>도보 {formatTransitMinutes(selected.walkTimeSec)}분</span>
            {selected.fareWon != null ? (
              <span>{selected.fareWon.toLocaleString("ko-KR")}원</span>
            ) : null}
          </p>
          <ol className="transitRouteSteps">
            {selected.steps.map((s, i) => (
              <li key={i} className="transitRouteStep">
                {s.type !== "WALKING" ? (
                  <LineBadge
                    name={s.vehicles[0]?.name || (s.type === "BUS" ? "버스" : "지하철")}
                    colour={s.colour}
                  />
                ) : (
                  <span className="transitRouteWalkDot" aria-hidden />
                )}
                <span>{formatTransitStepLabel(s)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
