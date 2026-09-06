"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
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
  /** savedPlaces 기준 메모 — 낙관적 갱신 반영 */
  memoByPlaceId?: Record<string, string | null | undefined>;
  onClose: () => void;
  /** 행 탭 — 장소 상세 시트 (목록 유지) */
  onOpenPlace: (place: PlaceListPlace) => void;
  /** ⋯ → 지도에서 보기 — 지도 탭 이동 */
  onViewOnMap: (place: PlaceListPlace) => void;
  onOpenMemo: (place: PlaceListPlace) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

export function MyListsScreen({
  open,
  userId,
  categoryColors,
  categoryPin,
  memoByPlaceId,
  onClose,
  onOpenPlace,
  onViewOnMap,
  onOpenMemo,
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
  const [deletingList, setDeletingList] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [removingPlaceId, setRemovingPlaceId] = useState<string | null>(null);
  const [detailSearchQuery, setDetailSearchQuery] = useState("");
  const [menuPlaceId, setMenuPlaceId] = useState<string | null>(null);
  const [menuClosing, setMenuClosing] = useState(false);

  const placesRef = useRef(places);
  placesRef.current = places;
  const listIdRef = useRef<string | null>(null);
  listIdRef.current = detailList?.id ?? null;
  const hasListsRef = useRef(false);
  const listsFetchedAtRef = useRef(0);
  const detailBodyRef = useRef<HTMLDivElement | null>(null);
  /** 지도에서 보기 등으로 잠시 닫힐 때 스크롤·상세 복원용 */
  const detailScrollTopRef = useRef(0);
  const preserveDetailOnHideRef = useRef(false);

  const LISTS_TTL_MS = 30_000;

  const resolveMemo = useCallback(
    (place: PlaceListPlace): string | null => {
      if (memoByPlaceId && Object.prototype.hasOwnProperty.call(memoByPlaceId, place.id)) {
        const v = memoByPlaceId[place.id];
        if (typeof v === "string" && v.trim()) return v.trim();
        return null;
      }
      if (typeof place.memo === "string" && place.memo.trim()) return place.memo.trim();
      return null;
    },
    [memoByPlaceId],
  );

  const loadLists = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      const force = opts?.force === true;
      const now = Date.now();
      if (
        !force &&
        hasListsRef.current &&
        listsFetchedAtRef.current > 0 &&
        now - listsFetchedAtRef.current < LISTS_TTL_MS
      ) {
        return;
      }
      const silent = opts?.silent === true && hasListsRef.current;
      if (!silent) setLoading(true);
      const { data, error } = await fetchMyLists(userId);
      if (!silent) setLoading(false);
      if (error) {
        showToast(error, "error");
        if (!silent) {
          setLists([]);
          hasListsRef.current = false;
          listsFetchedAtRef.current = 0;
        }
        return;
      }
      setLists(data);
      hasListsRef.current = true;
      listsFetchedAtRef.current = Date.now();
    },
    [userId, showToast],
  );

  const openDetail = useCallback(
    async (list: PlaceListSummary) => {
      setDetailList(list);
      setTitleDraft(list.title);
      setEditingTitle(false);
      setConfirmDelete(false);
      setDetailSearchQuery("");
      setMenuPlaceId(null);
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
      if (!preserveDetailOnHideRef.current) {
        setDetailList(null);
        setPlaces([]);
        setEditingTitle(false);
        setConfirmDelete(false);
        setDeletingList(false);
        setRemovingPlaceId(null);
        setDetailSearchQuery("");
        detailScrollTopRef.current = 0;
      }
      preserveDetailOnHideRef.current = false;
      setMenuPlaceId(null);
      setMenuClosing(false);
      return;
    }
    void loadLists({ silent: hasListsRef.current });
    const scrollTop = detailScrollTopRef.current;
    if (scrollTop > 0) {
      requestAnimationFrame(() => {
        if (detailBodyRef.current) {
          detailBodyRef.current.scrollTop = scrollTop;
        }
      });
    }
  }, [open, loadLists]);

  const handleClose = useCallback(() => {
    preserveDetailOnHideRef.current = false;
    detailScrollTopRef.current = 0;
    setDetailList(null);
    setPlaces([]);
    setEditingTitle(false);
    setConfirmDelete(false);
    setDeletingList(false);
    setRemovingPlaceId(null);
    setDetailSearchQuery("");
    setMenuPlaceId(null);
    setMenuClosing(false);
    onClose();
  }, [onClose]);

  const handleViewOnMap = useCallback(
    (place: PlaceListPlace) => {
      detailScrollTopRef.current = detailBodyRef.current?.scrollTop ?? 0;
      preserveDetailOnHideRef.current = true;
      setMenuPlaceId(null);
      setMenuClosing(false);
      onViewOnMap(place);
    },
    [onViewOnMap],
  );

  useEffect(() => {
    if (!menuPlaceId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuClosing(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuPlaceId]);

  useEffect(() => {
    if (!menuClosing) return;
    const t = window.setTimeout(() => {
      setMenuPlaceId(null);
      setMenuClosing(false);
    }, 200);
    return () => window.clearTimeout(t);
  }, [menuClosing]);

  const searchActive = detailSearchQuery.trim().length > 0;

  const filteredPlaces = useMemo(() => {
    const q = detailSearchQuery.trim().toLowerCase();
    if (!q) return places;
    return places.filter((place) => {
      const memo = resolveMemo(place) ?? "";
      return (
        place.name.toLowerCase().includes(q) ||
        place.address.toLowerCase().includes(q) ||
        memo.toLowerCase().includes(q)
      );
    });
  }, [places, detailSearchQuery, resolveMemo]);

  if (!open) return null;

  const closeMenu = () => {
    if (menuPlaceId) setMenuClosing(true);
  };

  const commitReorder = async (next: PlaceListPlace[]) => {
    const listId = listIdRef.current;
    if (!listId) return;
    const prev = placesRef.current;
    setPlaces(next);
    setReordering(true);
    const { error } = await reorderListPlaces(
      listId,
      next.map((p) => p.id),
    );
    setReordering(false);
    if (error) {
      showToast(error, "error");
      setPlaces(prev);
      return;
    }
    setDetailList((d) =>
      d ? { ...d, place_count: next.length, updated_at: new Date().toISOString() } : d,
    );
    setLists((prevLists) =>
      prevLists.map((l) =>
        l.id === listId
          ? { ...l, place_count: next.length, updated_at: new Date().toISOString() }
          : l,
      ),
    );
  };

  const onDragHandlePointerDown = (index: number, e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (reordering || searchActive) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const initial = placesRef.current.slice();
    const startY = e.clientY;
    let currentIndex = index;
    let working = initial.slice();

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const rowHeight = 72;
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
    if (!trimmed) {
      showToast("이름을 입력해주세요", "error");
      setTitleDraft(detailList.title);
      setEditingTitle(false);
      return;
    }

    const listId = detailList.id;
    const prevTitle = detailList.title;
    setDetailList((d) => (d ? { ...d, title: trimmed } : d));
    setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, title: trimmed } : l)));
    setEditingTitle(false);
    setSavingTitle(true);

    const { data, error } = await renameList(listId, trimmed);
    setSavingTitle(false);
    if (error || !data) {
      showToast(error || "이름을 바꾸지 못했어요.", "error");
      setDetailList((d) => (d ? { ...d, title: prevTitle } : d));
      setTitleDraft(prevTitle);
      setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, title: prevTitle } : l)));
      return;
    }
    setDetailList(data);
    setTitleDraft(data.title);
    setLists((prev) => prev.map((l) => (l.id === data.id ? { ...l, title: data.title } : l)));
    listsFetchedAtRef.current = 0;
    void loadLists({ force: true, silent: true });
  };

  const handleDeleteList = async () => {
    if (!detailList || deletingList) return;
    const deleted = detailList;
    setDeletingList(true);
    setConfirmDelete(false);
    setDetailList(null);
    setPlaces([]);
    setLists((prev) => prev.filter((l) => l.id !== deleted.id));

    const { error } = await deleteList(deleted.id);
    setDeletingList(false);
    if (error) {
      showToast(error, "error");
      setLists((prev) => {
        if (prev.some((l) => l.id === deleted.id)) return prev;
        return [deleted, ...prev];
      });
      return;
    }
    listsFetchedAtRef.current = 0;
    void loadLists({ force: true, silent: true });
    showToast("목록을 삭제했어요", "success");
  };

  const handleRemovePlace = async (placeId: string) => {
    if (!detailList || removingPlaceId) return;
    const listId = detailList.id;
    const prevPlaces = places;
    const prevCount = detailList.place_count;

    setRemovingPlaceId(placeId);
    setMenuPlaceId(null);
    setMenuClosing(false);
    setPlaces((p) => p.filter((x) => x.id !== placeId));
    setDetailList((d) =>
      d ? { ...d, place_count: Math.max(0, d.place_count - 1) } : d,
    );
    setLists((prevLists) =>
      prevLists.map((l) =>
        l.id === listId
          ? { ...l, place_count: Math.max(0, l.place_count - 1) }
          : l,
      ),
    );

    const { error } = await removePlaceFromList(listId, placeId);
    setRemovingPlaceId(null);
    if (error) {
      showToast(error, "error");
      setPlaces(prevPlaces);
      setDetailList((d) => (d ? { ...d, place_count: prevCount } : d));
      setLists((prevLists) =>
        prevLists.map((l) => (l.id === listId ? { ...l, place_count: prevCount } : l)),
      );
    }
  };

  const showListLoading = loading && lists.length === 0;
  const menuPlace = menuPlaceId ? places.find((p) => p.id === menuPlaceId) ?? null : null;
  const menuMemo = menuPlace ? resolveMemo(menuPlace) : null;

  const actionSheet =
    menuPlace && typeof document !== "undefined"
      ? createPortal(
          <div
            className={`savedPlaceActionSheetRoot listDetailActionSheet${menuClosing ? " isClosing" : ""}`}
            role="presentation"
            onClick={closeMenu}
          >
            <div
              className="savedPlaceActionSheetStack"
              role="dialog"
              aria-label={`${menuPlace.name} 메뉴`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="savedPlaceActionSheetCard">
                <p className="savedPlaceActionSheetTitle">{menuPlace.name}</p>
                <button
                  type="button"
                  className="savedPlaceActionSheetItem"
                  onClick={() => {
                    closeMenu();
                    onOpenMemo(menuPlace);
                  }}
                >
                  {menuMemo ? "메모 수정" : "메모"}
                </button>
                <button
                  type="button"
                  className="savedPlaceActionSheetItem"
                  onClick={() => {
                    handleViewOnMap(menuPlace);
                  }}
                >
                  지도에서 보기
                </button>
                <button
                  type="button"
                  className="savedPlaceActionSheetItem savedPlaceActionSheetItemDanger"
                  disabled={!!removingPlaceId || reordering}
                  onClick={() => void handleRemovePlace(menuPlace.id)}
                >
                  {removingPlaceId === menuPlace.id ? "빼는 중…" : "목록에서 빼기"}
                </button>
              </div>
              <button
                type="button"
                className="savedPlaceActionSheetCancel"
                onClick={closeMenu}
              >
                취소
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

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
                setDetailSearchQuery("");
                setMenuPlaceId(null);
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
                disabled={savingTitle}
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
                {savingTitle ? " …" : ""}
              </button>
            )}
            <button
              type="button"
              className="myListsHeaderBtn myListsHeaderDanger"
              onClick={() => setConfirmDelete(true)}
              disabled={deletingList}
              aria-label="목록 삭제"
            >
              {deletingList ? "…" : "삭제"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="myListsHeaderBtn" onClick={handleClose} aria-label="닫기">
              ←
            </button>
            <p className="myListsHeaderTitle">내 목록</p>
            <span className="myListsHeaderSpacer" />
          </>
        )}
      </header>

      <div className="myListsBody" ref={detailBodyRef}>
        {!detailList ? (
          showListLoading ? (
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
          <>
            <div className="myListsDetailSearchWrap">
              <input
                type="search"
                className="myListsDetailSearch"
                data-testid="list-detail-search"
                value={detailSearchQuery}
                onChange={(e) => setDetailSearchQuery(e.target.value)}
                placeholder="장소·주소·메모 검색"
                enterKeyHint="search"
                autoCapitalize="none"
                autoCorrect="off"
              />
              {detailSearchQuery.trim() ? (
                <button
                  type="button"
                  className="myListsDetailSearchClear"
                  aria-label="검색 지우기"
                  onClick={() => setDetailSearchQuery("")}
                >
                  ×
                </button>
              ) : null}
            </div>
            {filteredPlaces.length === 0 ? (
              <p className="myListsEmptyHint">검색 결과가 없어요</p>
            ) : (
              <ul
                className={`myListsDetailList${reordering ? " myListsDetailListBusy" : ""}${
                  searchActive ? " myListsDetailListFiltered" : ""
                }`}
              >
                {filteredPlaces.map((place) => {
                  const fullIndex = places.findIndex((p) => p.id === place.id);
                  const cat = place.category as Category;
                  const color = categoryColors[cat] ?? "#1a2a7a";
                  const removing = removingPlaceId === place.id;
                  const memo = resolveMemo(place);
                  return (
                    <li
                      key={place.id}
                      className={`myListsDetailItem${removing ? " myListsDetailItemBusy" : ""}`}
                    >
                      <button
                        type="button"
                        className="myListsDragHandle"
                        aria-label="순서 변경"
                        disabled={reordering || !!removingPlaceId || searchActive || fullIndex < 0}
                        onPointerDown={(e) => {
                          if (searchActive || fullIndex < 0) return;
                          onDragHandlePointerDown(fullIndex, e);
                        }}
                      >
                        ⠿
                      </button>
                      <span
                        className="myListsDetailColorBar"
                        style={{ background: color }}
                        aria-hidden
                      />
                      <button
                        type="button"
                        className="myListsDetailMain"
                        onClick={() => onOpenPlace(place)}
                        disabled={removing}
                      >
                        <span
                          className="myListsDetailDot"
                          style={{ background: color }}
                          aria-hidden
                        />
                        <span className="myListsDetailText">
                          <span className="savedName">{place.name}</span>
                          {memo ? (
                            <span className="savedMemo" data-testid="list-item-memo">
                              ✎ {memo}
                            </span>
                          ) : null}
                          <span className="savedMeta">
                            {place.category} · {place.address}
                          </span>
                        </span>
                      </button>
                      <div
                        className="savedItemActions"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="savedItemMoreBtn"
                          data-testid="list-item-menu"
                          aria-label="더보기"
                          aria-expanded={menuPlaceId === place.id}
                          disabled={removing}
                          onClick={() => {
                            if (menuPlaceId === place.id) {
                              closeMenu();
                              return;
                            }
                            setMenuClosing(false);
                            setMenuPlaceId(place.id);
                          }}
                        >
                          ⋯
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
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
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={deletingList}>
                취소
              </button>
              <button
                type="button"
                className="myListsConfirmDelete"
                disabled={deletingList}
                onClick={() => void handleDeleteList()}
              >
                {deletingList ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
      {actionSheet}
    </div>
  );
}
