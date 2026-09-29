"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createList,
  fetchListsPlacePreviews,
  fetchMyLists,
  type ListPlacePreview,
  type PlaceListSummary,
} from "@/lib/placeLists";
import {
  DEFAULT_LIST_COLOR_PRESET,
  ListColorDot,
  ListColorSwatches,
} from "@/components/ListColorSwatches";
import type { ListColorPresetId } from "@/lib/listColors";
import { LIST_COLOR_PRESETS, resolveListColor } from "@/lib/listColors";
import { track } from "@/lib/track";

type Props = {
  userId: string;
  categoryColors: Record<string, string>;
  onOpenList: (list: PlaceListSummary) => void;
  onListsChanged?: () => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  /** Bump to refetch after MyListsScreen mutations */
  refreshKey?: number;
};

export function SavedListsPanel({
  userId,
  categoryColors,
  onOpenList,
  onListsChanged,
  showToast,
  refreshKey = 0,
}: Props) {
  const [lists, setLists] = useState<PlaceListSummary[]>([]);
  const [previews, setPreviews] = useState<Record<string, ListPlacePreview[]>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newColor, setNewColor] = useState<ListColorPresetId>(DEFAULT_LIST_COLOR_PRESET);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchMyLists(userId);
    if (error) {
      showToast(error, "error");
      setLists([]);
      setPreviews({});
      setLoading(false);
      return;
    }
    setLists(data);
    const ids = data.map((l) => l.id);
    const prev = await fetchListsPlacePreviews(ids);
    setPreviews(prev.data);
    setLoading(false);
  }, [userId, showToast]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const startCreate = () => {
    track("list_create_start");
    setCreating(true);
    setNewTitle("");
    setNewColor(DEFAULT_LIST_COLOR_PRESET);
  };

  const cancelCreate = () => {
    if (createBusy) return;
    setCreating(false);
    setNewTitle("");
  };

  const submitCreate = async () => {
    const trimmed = newTitle.trim();
    if (!trimmed || createBusy) return;
    setCreateBusy(true);
    const { data, error } = await createList(userId, trimmed, newColor);
    setCreateBusy(false);
    if (error || !data) {
      showToast(error || "목록을 만들지 못했어요.", "error");
      return;
    }
    track("list_create_done", { list_id: data.id, place_count: 0 });
    setCreating(false);
    setNewTitle("");
    setLists((prev) => [data, ...prev.filter((l) => l.id !== data.id)]);
    setPreviews((prev) => ({ ...prev, [data.id]: [] }));
    onListsChanged?.();
    showToast("목록을 만들었어요", "success");
    onOpenList(data);
  };

  return (
    <div className="savedListsPanel" data-testid="saved-lists-panel">
      {creating ? (
        <div className="savedListsCreateBlock" data-testid="saved-lists-create">
          <input
            className="savedListsCreateInput"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="목록 이름"
            maxLength={60}
            autoFocus
            disabled={createBusy}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCreate();
              if (e.key === "Escape") cancelCreate();
            }}
          />
          <ListColorSwatches
            value={newColor}
            onChange={setNewColor}
            disabled={createBusy}
            size="sm"
            aria-label="새 목록 색"
          />
          <div className="savedListsCreateActions">
            <button
              type="button"
              className="savedListsCreateCancel"
              disabled={createBusy}
              onClick={cancelCreate}
            >
              취소
            </button>
            <button
              type="button"
              className="savedListsCreateConfirm"
              data-testid="saved-lists-create-confirm"
              disabled={createBusy || !newTitle.trim()}
              onClick={() => void submitCreate()}
            >
              {createBusy ? "…" : "만들기"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="savedListsNewRow"
          data-testid="saved-lists-new"
          onClick={startCreate}
        >
          + 새 목록
        </button>
      )}

      {loading ? (
        <p className="savedListsHint">불러오는 중…</p>
      ) : lists.length === 0 ? (
        <div className="savedListsEmpty" data-testid="saved-lists-empty">
          <p className="savedListsEmptyTitle">장소를 목록으로 묶어보세요</p>
          <p className="savedListsEmptyDesc">여행·데이트·동네 맛집처럼 나눠 두면 찾기 쉬워요</p>
          {!creating ? (
            <button
              type="button"
              className="savedListsEmptyCta"
              data-testid="saved-lists-empty-cta"
              onClick={startCreate}
            >
              목록 만들기
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="savedListsUl">
          {lists.map((list) => {
            const listHex =
              resolveListColor(list.color) ||
              LIST_COLOR_PRESETS[DEFAULT_LIST_COLOR_PRESET];
            const tiles = previews[list.id] ?? [];
            return (
              <li key={list.id}>
                <button
                  type="button"
                  className="savedListRow"
                  data-testid="saved-list-row"
                  data-list-id={list.id}
                  onClick={() => onOpenList(list)}
                >
                  <span className="savedListRowMain">
                    <ListColorDot color={list.color} size={12} />
                    <span className="savedListRowText">
                      <span className="savedListRowName">{list.title}</span>
                      <span className="savedListRowMeta">{list.place_count}곳</span>
                    </span>
                  </span>
                  <span className="savedListThumbs" aria-hidden>
                    {[0, 1, 2].map((i) => {
                      const tile = tiles[i];
                      const bg = tile
                        ? categoryColors[tile.category] ?? listHex
                        : listHex;
                      const empty = !tile;
                      return (
                        <span
                          key={i}
                          className={`savedListThumb${empty ? " savedListThumbEmpty" : ""}`}
                          style={{ background: bg, opacity: empty ? 0.35 : 1 }}
                        />
                      );
                    })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
