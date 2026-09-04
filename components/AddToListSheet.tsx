"use client";

import { useCallback, useEffect, useState } from "react";
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
  placeId: string;
  userId: string;
  placeName?: string;
  onClose: () => void;
  onChanged?: () => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

export function AddToListSheet({
  open,
  placeId,
  userId,
  placeName,
  onClose,
  onChanged,
  showToast,
}: Props) {
  const [lists, setLists] = useState<PlaceListSummary[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listsRes, forPlaceRes] = await Promise.all([
        fetchMyLists(userId),
        fetchListsForPlace(placeId),
      ]);
      if (listsRes.error) {
        showToast(listsRes.error, "error");
        setLists([]);
      } else {
        setLists(listsRes.data);
      }
      if (forPlaceRes.error) {
        showToast(forPlaceRes.error, "error");
        setCheckedIds(new Set());
      } else {
        setCheckedIds(new Set(forPlaceRes.data));
      }
    } finally {
      setLoading(false);
    }
  }, [placeId, userId, showToast]);

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setNewTitle("");
    void load();
  }, [open, load]);

  if (!open) return null;

  const toggleList = async (listId: string) => {
    if (busyId) return;
    const wasChecked = checkedIds.has(listId);
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
          ? {
              ...l,
              place_count: Math.max(0, l.place_count + (wasChecked ? -1 : 1)),
            }
          : l,
      ),
    );

    const result = wasChecked
      ? await removePlaceFromList(listId, placeId)
      : await addPlaceToList(listId, placeId);

    setBusyId(null);
    if (result.error) {
      showToast(result.error, "error");
      void load();
      return;
    }
    onChanged?.();
  };

  const handleCreate = async () => {
    const trimmed = newTitle.trim();
    if (!trimmed || createBusy) return;
    setCreateBusy(true);
    const { data, error } = await createList(userId, trimmed);
    if (error || !data) {
      setCreateBusy(false);
      showToast(error || "목록을 만들지 못했어요.", "error");
      return;
    }
    const addRes = await addPlaceToList(data.id, placeId);
    setCreateBusy(false);
    if (addRes.error) {
      showToast(addRes.error, "error");
      void load();
      return;
    }
    setNewTitle("");
    setCreating(false);
    showToast("새 목록에 담았어요", "success");
    onChanged?.();
    void load();
  };

  return (
    <div className="placeListSheetOverlay" role="presentation" onClick={onClose}>
      <div
        className="placeListSheet"
        role="dialog"
        aria-label="목록에 추가"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="placeListSheetHandle" aria-hidden />
        <header className="placeListSheetHeader">
          <div>
            <p className="placeListSheetTitle">목록에 추가</p>
            {placeName ? <p className="placeListSheetSubtitle">{placeName}</p> : null}
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
              onClick={() => setCreating(true)}
            >
              + 새 목록 만들기
            </button>
          ) : (
            <div className="placeListSheetCreateRow">
              <input
                className="placeListSheetCreateInput"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="목록 이름 (예: 데이트용)"
                maxLength={60}
                autoFocus
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

          {loading ? (
            <p className="placeListSheetHint">불러오는 중…</p>
          ) : lists.length === 0 ? (
            <p className="placeListSheetHint">아직 목록이 없어요. 위에서 새 목록을 만들어보세요.</p>
          ) : (
            <ul className="placeListSheetCheckList">
              {lists.map((list) => {
                const checked = checkedIds.has(list.id);
                return (
                  <li key={list.id}>
                    <label className="placeListSheetCheckItem">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busyId === list.id}
                        onChange={() => void toggleList(list.id)}
                      />
                      <span className="placeListSheetCheckText">
                        <span className="placeListSheetCheckName">{list.title}</span>
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
