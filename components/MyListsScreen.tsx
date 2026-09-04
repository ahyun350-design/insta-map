"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  deleteList,
  fetchListPlaces,
  fetchMyLists,
  removePlaceFromList,
  renameList,
  reorderListPlaces,
  type PlaceListPlace,
  type PlaceListSummary,
} from "@/lib/placeLists";

type Category = "맛집" | "카페" | "쇼핑" | "숙소" | "놀거리" | "여행지";

type Props = {
  open: boolean;
  userId: string;
  categoryColors: Record<Category, string>;
  categoryPin: Record<Category, { emoji: string }>;
  onClose: () => void;
  onOpenPlace: (place: PlaceListPlace) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

export function MyListsScreen({
  open,
  userId,
  categoryColors,
  categoryPin,
  onClose,
  onOpenPlace,
  showToast,
}: Props) {
  const [lists, setLists] = useState<PlaceListSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailList, setDetailList] = useState<PlaceListSummary | null>(null);
  const [places, setPlaces] = useState<PlaceListPlace[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reordering, setReordering] = useState(false);

  const placesRef = useRef(places);
  placesRef.current = places;
  const listIdRef = useRef<string | null>(null);
  listIdRef.current = detailList?.id ?? null;

  const loadLists = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchMyLists(userId);
    setLoading(false);
    if (error) {
      showToast(error, "error");
      setLists([]);
      return;
    }
    setLists(data);
  }, [userId, showToast]);

  const openDetail = useCallback(
    async (list: PlaceListSummary) => {
      setDetailList(list);
      setTitleDraft(list.title);
      setEditingTitle(false);
      setConfirmDelete(false);
      setDetailLoading(true);
      const { data, error } = await fetchListPlaces(list.id);
      setDetailLoading(false);
      if (error) {
        showToast(error, "error");
        setPlaces([]);
        return;
      }
      setPlaces(data);
    },
    [showToast],
  );

  useEffect(() => {
    if (!open) {
      setDetailList(null);
      setPlaces([]);
      setEditingTitle(false);
      setConfirmDelete(false);
      return;
    }
    void loadLists();
  }, [open, loadLists]);

  if (!open) return null;

  const commitReorder = async (next: PlaceListPlace[]) => {
    const listId = listIdRef.current;
    if (!listId) return;
    setPlaces(next);
    setReordering(true);
    const { error } = await reorderListPlaces(
      listId,
      next.map((p) => p.id),
    );
    setReordering(false);
    if (error) {
      showToast(error, "error");
      const refreshed = await fetchListPlaces(listId);
      if (!refreshed.error) setPlaces(refreshed.data);
    } else {
      setDetailList((prev) =>
        prev ? { ...prev, place_count: next.length, updated_at: new Date().toISOString() } : prev,
      );
    }
  };

  const onDragHandlePointerDown = (index: number, e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const initial = placesRef.current.slice();
    const startY = e.clientY;
    let currentIndex = index;
    let working = initial.slice();

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const rowHeight = 64;
      const delta = Math.round(dy / rowHeight);
      const target = Math.max(0, Math.min(working.length - 1, index + delta));
      if (target === currentIndex) return;
      const next = working.slice();
      const [item] = next.splice(currentIndex, 1);
      if (!item) return;
      next.splice(target, 0, item);
      working = next;
      currentIndex = target;
      setPlaces(next);
    };

    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      const changed =
        working.map((p) => p.id).join(",") !== initial.map((p) => p.id).join(",");
      if (changed) void commitReorder(working);
      else setPlaces(initial);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const handleRename = async () => {
    if (!detailList || savingTitle) return;
    const trimmed = titleDraft.trim();
    if (trimmed === detailList.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    const { data, error } = await renameList(detailList.id, trimmed);
    setSavingTitle(false);
    if (error || !data) {
      showToast(error || "이름을 바꾸지 못했어요.", "error");
      return;
    }
    setDetailList(data);
    setTitleDraft(data.title);
    setEditingTitle(false);
    setLists((prev) => prev.map((l) => (l.id === data.id ? { ...l, title: data.title } : l)));
  };

  const handleDeleteList = async () => {
    if (!detailList) return;
    const { error } = await deleteList(detailList.id);
    if (error) {
      showToast(error, "error");
      return;
    }
    showToast("목록을 삭제했어요", "success");
    setDetailList(null);
    setPlaces([]);
    setConfirmDelete(false);
    void loadLists();
  };

  const handleRemovePlace = async (placeId: string) => {
    if (!detailList) return;
    const prev = places;
    setPlaces((p) => p.filter((x) => x.id !== placeId));
    const { error } = await removePlaceFromList(detailList.id, placeId);
    if (error) {
      showToast(error, "error");
      setPlaces(prev);
      return;
    }
    setDetailList((d) =>
      d ? { ...d, place_count: Math.max(0, d.place_count - 1) } : d,
    );
    setLists((prevLists) =>
      prevLists.map((l) =>
        l.id === detailList.id
          ? { ...l, place_count: Math.max(0, l.place_count - 1) }
          : l,
      ),
    );
  };

  return (
    <div className="myListsScreen" role="dialog" aria-label="내 목록">
      <header className="myListsHeader">
        {detailList ? (
          <>
            <button
              type="button"
              className="myListsHeaderBtn"
              onClick={() => {
                setDetailList(null);
                setPlaces([]);
                setConfirmDelete(false);
                setEditingTitle(false);
                void loadLists();
              }}
            >
              ←
            </button>
            {editingTitle ? (
              <input
                className="myListsTitleInput"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                maxLength={60}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRename();
                  if (e.key === "Escape") {
                    setTitleDraft(detailList.title);
                    setEditingTitle(false);
                  }
                }}
                onBlur={() => void handleRename()}
              />
            ) : (
              <button
                type="button"
                className="myListsTitleBtn"
                onClick={() => {
                  setTitleDraft(detailList.title);
                  setEditingTitle(true);
                }}
              >
                {detailList.title}
              </button>
            )}
            <button
              type="button"
              className="myListsHeaderBtn myListsHeaderDanger"
              onClick={() => setConfirmDelete(true)}
              aria-label="목록 삭제"
            >
              삭제
            </button>
          </>
        ) : (
          <>
            <button type="button" className="myListsHeaderBtn" onClick={onClose} aria-label="닫기">
              ←
            </button>
            <p className="myListsHeaderTitle">내 목록</p>
            <span className="myListsHeaderSpacer" />
          </>
        )}
      </header>

      <div className="myListsBody">
        {!detailList ? (
          loading ? (
            <p className="myListsEmptyHint">불러오는 중…</p>
          ) : lists.length === 0 ? (
            <div className="myListsEmpty">
              <p className="myListsEmptyTitle">아직 목록이 없어요</p>
              <p className="myListsEmptyDesc">저장한 장소를 묶어보세요</p>
            </div>
          ) : (
            <ul className="myListsList">
              {lists.map((list) => (
                <li key={list.id}>
                  <button
                    type="button"
                    className="myListsListItem"
                    onClick={() => void openDetail(list)}
                  >
                    <span className="myListsListName">{list.title}</span>
                    <span className="myListsListMeta">{list.place_count}곳</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : detailLoading ? (
          <p className="myListsEmptyHint">불러오는 중…</p>
        ) : places.length === 0 ? (
          <div className="myListsEmpty">
            <p className="myListsEmptyTitle">담긴 장소가 없어요</p>
            <p className="myListsEmptyDesc">저장한 장소에서 「목록에 추가」로 담아보세요</p>
          </div>
        ) : (
          <ul className={`myListsDetailList${reordering ? " myListsDetailListBusy" : ""}`}>
            {places.map((place, index) => {
              const cat = place.category as Category;
              const color = categoryColors[cat] ?? "#1a2a7a";
              const emoji = categoryPin[cat]?.emoji ?? "📍";
              return (
                <li key={place.id} className="myListsDetailItem">
                  <button
                    type="button"
                    className="myListsDragHandle"
                    aria-label="순서 변경"
                    onPointerDown={(e) => onDragHandlePointerDown(index, e)}
                  >
                    ⠿
                  </button>
                  <button
                    type="button"
                    className="myListsDetailMain"
                    onClick={() => onOpenPlace(place)}
                  >
                    <span
                      className="myListsDetailDot"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <span className="myListsDetailText">
                      <span className="myListsDetailName">{place.name}</span>
                      <span className="myListsDetailMeta">
                        {emoji} {place.category} · {place.address}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="myListsRemoveBtn"
                    onClick={() => void handleRemovePlace(place.id)}
                  >
                    빼기
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {confirmDelete && detailList && (
        <div className="myListsConfirmOverlay" role="presentation" onClick={() => setConfirmDelete(false)}>
          <div
            className="myListsConfirmDialog"
            role="alertdialog"
            aria-labelledby="my-lists-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="my-lists-delete-title" className="myListsConfirmTitle">
              「{detailList.title}」 목록을 삭제할까요?
            </p>
            <p className="myListsConfirmDesc">목록만 삭제되며, 저장한 장소는 그대로 남아요.</p>
            <div className="myListsConfirmActions">
              <button type="button" onClick={() => setConfirmDelete(false)}>
                취소
              </button>
              <button type="button" className="myListsConfirmDelete" onClick={() => void handleDeleteList()}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
