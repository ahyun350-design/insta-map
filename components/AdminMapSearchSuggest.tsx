"use client";

/**
 * Admin expanded MapLibre search: autocomplete (our data, 200ms debounce, top 8)
 * and this device's recent queries while the field is empty.
 * Items keep input focus on pointerdown so the first tap selects (iOS keyboard).
 */
import { useEffect, useRef, useState } from "react";
import {
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_LIMIT,
  hitSubtitle,
  placeDisplayName,
  type OurHit,
} from "@/lib/adminMapSearch";

type Props = {
  query: string;
  active: boolean;
  recent: string[];
  fetchHits: (q: string, limit: number, signal: AbortSignal) => Promise<OurHit[] | null>;
  onPickHit: (hit: OurHit, query: string) => void;
  onPickRecent: (q: string) => void;
  onClearRecent: () => void;
};

export function AdminMapSearchSuggest({
  query,
  active,
  recent,
  fetchHits,
  onPickHit,
  onPickRecent,
  onClearRecent,
}: Props) {
  const [hits, setHits] = useState<OurHit[]>([]);
  const [hitsFor, setHitsFor] = useState("");
  const fetchRef = useRef(fetchHits);
  fetchRef.current = fetchHits;
  const q = query.trim();

  useEffect(() => {
    if (!active || q.length < 2) {
      setHits([]);
      setHitsFor("");
      return;
    }
    const ctrl = new AbortController();
    const tid = window.setTimeout(() => {
      void fetchRef.current(q, SUGGEST_LIMIT, ctrl.signal).then((next) => {
        if (ctrl.signal.aborted || next == null) return;
        setHits(next.slice(0, SUGGEST_LIMIT));
        setHitsFor(q);
      });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      window.clearTimeout(tid);
    };
  }, [active, q]);

  if (!active) return null;
  const keepFocus = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

  if (q.length < 2) {
    if (!recent.length) return null;
    return (
      <div className="adminMapSuggest" data-testid="admin-map-recent" onPointerDown={keepFocus} onMouseDown={keepFocus}>
        <div className="adminMapSuggestHeader">
          <span>최근 검색</span>
          <button type="button" className="adminMapSuggestClear" onClick={onClearRecent}>
            지우기
          </button>
        </div>
        <ul className="adminMapSuggestList">
          {recent.map((r) => (
            <li key={r}>
              <button type="button" className="adminMapSuggestItem" onClick={() => onPickRecent(r)}>
                <span className="adminMapSuggestName">{r}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (hitsFor !== q || !hits.length) return null;
  return (
    <div className="adminMapSuggest" data-testid="admin-map-suggest" onPointerDown={keepFocus} onMouseDown={keepFocus}>
      <ul className="adminMapSuggestList">
        {hits.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              className="adminMapSuggestItem"
              data-testid="admin-map-suggest-item"
              onClick={() => onPickHit(h, q)}
            >
              <span className="adminMapSuggestName">{h.kind === "address" ? h.roadAddr : placeDisplayName(h)}</span>
              <span className="adminMapSuggestSub">{hitSubtitle(h)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
