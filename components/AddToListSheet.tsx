"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addPlaceToList,
  createList,
  fetchListsForPlace,
  fetchMyLists,
  removePlaceFromList,
  type PlaceListSummary,
} from "@/lib/placeLists";

type Props = {
  open: boolean;
  /** 한 개 이상 — 단일이면 체크/해제로 담기·빼기, 복수면 체크 시 전부 담기 */
  placeIds: string[];
  userId: string;
  placeName?: string;
  keyboardHeight?: number;
  onClose: () => void;
  onChanged?: () => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

function isTempListId(id: string): boolean {
  return id.startsWith("temp-");
}

export function AddToListSheet({
  open,
  placeIds,
  userId,
  placeName,
  keyboardHeight = 0,
  onClose,
  onChanged,
  showToast,
}: Props) {
  const bulk = placeIds.length > 1;
  const singlePlaceId = placeIds.length === 1 ? placeIds[0]! : null;

  const [lists, setLists] = useState<PlaceListSummary[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const createRowRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true && hasLoadedRef.current;
    if (!silent) setLoading(true);
    try {
      const listsRes = await fetchMyLists(userId);
      if (listsRes.error) {
        showToast(listsRes.error, "error");
        if (!silent) setLists([]);
      } else {
        setLists(listsRes.data);
        hasLoadedRef.current = true;
      }

      if (singlePlaceId) {
        const forPlaceRes = await fetchListsForPlace(singlePlaceId);
        if (forPlaceRes.error) {
          showToast(forPlaceRes.error, "error");
          if (!silent) setCheckedIds(new Set());
        } else {
          setCheckedIds(new Set(forPlaceRes.data));
        }
      } else {
        setCheckedIds(new Set());
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [singlePlaceId, userId, showToast]);

  useEffect(() => {
    if (!open) {
      hasLoadedRef.current = false;
      return;
    }
    setCreating(false);
    setNewTitle("");
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open || !creating || keyboardHeight <= 0) return;
    const id = window.setTimeout(() => {
      createRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 50);
    return () => window.clearTimeout(id);
  }, [open, creating, keyboardHeight]);

  if (!open || placeIds.length === 0) return null;

  const addAllToList = async (listId: string): Promise<string | null> => {
    for (const placeId of placeIds) {
      const { error } = await addPlaceToList(listId, placeId);
      if (error) return error;
    }
    return null;
  };

  const removeAllFromList = async (listId: string): Promise<string | null> => {
    for (const placeId of placeIds) {
      const { error } = await removePlaceFromList(listId, placeId);
      if (error) return error;
    }
    return null;
  };

  const toggleList = async (listId: string) => {
    if (busyId || createBusy || isTempListId(listId)) return;
    const wasChecked = checkedIds.has(listId);
    const delta = wasChecked ? -placeIds.length : placeIds.length;
    const prevChecked = checkedIds;
    const prevLists = lists;

    setBusyId(listId);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (wasChecked) next.delete(listId);
      else next.add(listId);
      return next;
    });
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId
          ? { ...l, place_count: Math.max(0, l.place_count + delta) }
          : l,
      ),
    );

    const error = wasChecked
      ? await removeAllFromList(listId)
      : await addAllToList(listId);

    setBusyId(null);
    if (error) {
      showToast(error, "error");
      setCheckedIds(prevChecked);
      setLists(prevLists);
      return;
    }
    if (bulk && !wasChecked) {
      showToast(`${placeIds.length}곳을 목록에 담았어요`, "success");
    }
    onChanged?.();
  };

  const handleCreate = async () => {
    const trimmed = newTitle.trim();
    if (!trimmed || createBusy) return;

    const tempId = `temp-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const optimistic: PlaceListSummary = {
      id: tempId,
      user_id: userId,
      title: trimmed,
      place_count: placeIds.length,
      created_at: now,
      updated_at: now,
    };

    // 즉시 UI 반영 — 서버는 뒤에서
    setLists((prev) => [optimistic, ...prev]);
    setCheckedIds((prev) => new Set(prev).add(tempId));
    setNewTitle("");
    setCreating(false);
    setCreateBusy(true);

    const { data, error } = await createList(userId, trimmed);
    if (error || !data) {
      setLists((prev) => prev.filter((l) => l.id !== tempId));
      setCheckedIds((prev) => {
        const next = new Set(prev);
        next.delete(tempId);
        return next;
      });
      setCreateBusy(false);
      showToast(error || "목록을 만들지 못했어요.", "error");
      return;
    }

    // temp → 서버 id 교체 (전체 재조회 없음)
    setLists((prev) =>
      prev.map((l) =>
        l.id === tempId ? { ...data, place_count: placeIds.length } : l,
      ),
    );
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.delete(tempId);
      next.add(data.id);
      return next;
    });

    const addError = await addAllToList(data.id);
    setCreateBusy(false);
    if (addError) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        next.delete(data.id);
        return next;
      });
      setLists((prev) =>
        prev.map((l) => (l.id === data.id ? { ...l, place_count: 0 } : l)),
      );
      showToast(addError, "error");
      return;
    }

    showToast(
      bulk ? `새 목록에 ${placeIds.length}곳을 담았어요` : "새 목록에 담았어요",
      "success",
    );
    onChanged?.();
  };

  const subtitle = bulk
    ? `${placeIds.length}곳 선택됨`
    : placeName || undefined;

  const sheetBottom = keyboardHeight > 0 ? keyboardHeight : 0;
  const showInitialLoading = loading && lists.length === 0;

  return (
    <div className="placeListSheetOverlay" role="presentation" onClick={onClose}>
      <div
        className="placeListSheet"
        role="dialog"
        aria-label="목록에 추가"
        style={{
          bottom: sheetBottom,
          transition: "bottom 0.25s ease, padding-bottom 0.25s ease",
          paddingBottom:
            keyboardHeight > 0
              ? 16
              : "calc(16px + env(safe-area-inset-bottom, 0px))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="placeListSheetHandle" aria-hidden />
        <header className="placeListSheetHeader">
          <div>
            <p className="placeListSheetTitle">목록에 추가</p>
            {subtitle ? <p className="placeListSheetSubtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="placeListSheetClose" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>

        <div className="placeListSheetBody">
          {!creating ? (
            <button
              type="button"
              className="placeListSheetCreateBtn"
              disabled={createBusy}
              onClick={() => setCreating(true)}
            >
              {createBusy ? "목록 저장 중…" : "+ 새 목록 만들기"}
            </button>
          ) : (
            <div className="placeListSheetCreateRow" ref={createRowRef}>
              <input
                className="placeListSheetCreateInput"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="목록 이름 (예: 데이트용)"
                maxLength={60}
                autoFocus
                disabled={createBusy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
              />
              <button
                type="button"
                className="placeListSheetCreateConfirm"
                disabled={!newTitle.trim() || createBusy}
                onClick={() => void handleCreate()}
              >
                {createBusy ? "…" : "만들기"}
              </button>
            </div>
          )}

          {showInitialLoading ? (
            <p className="placeListSheetHint">불러오는 중…</p>
          ) : lists.length === 0 ? (
            <p className="placeListSheetHint">아직 목록이 없어요. 위에서 새 목록을 만들어보세요.</p>
          ) : (
            <ul className="placeListSheetCheckList">
              {lists.map((list) => {
                const checked = checkedIds.has(list.id);
                const rowBusy =
                  busyId === list.id || isTempListId(list.id) || (createBusy && isTempListId(list.id));
                const pendingCreate = isTempListId(list.id);
                return (
                  <li key={list.id}>
                    <label
                      className={`placeListSheetCheckItem${rowBusy ? " placeListSheetCheckItemBusy" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!!busyId || pendingCreate || createBusy}
                        onChange={() => void toggleList(list.id)}
                      />
                      <span className="placeListSheetCheckText">
                        <span className="placeListSheetCheckName">
                          {list.title}
                          {pendingCreate ? (
                            <span className="placeListSheetPending"> 저장 중…</span>
                          ) : null}
                        </span>
                        <span className="placeListSheetCheckMeta">{list.place_count}곳</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
