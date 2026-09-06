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

type ListSort = "custom" | "region" | "near" | "category";

const LIST_SORT_OPTIONS: { id: ListSort; label: string }[] = [
  { id: "custom", label: "내 순서" },
  { id: "region", label: "지역순" },
  { id: "near", label: "가까운 순" },
  { id: "category", label: "카테고리순" },
];

const LIST_CATEGORY_ORDER: Category[] = ["맛집", "카페", "쇼핑", "숙소", "놀거리", "여행지"];

function extractListRegion(address: string): string {
  if (!address) return "기타";
  const parts = address.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return parts[0] || "기타";
}

function listDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatListDistanceM(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

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
  const [detailSort, setDetailSort] = useState<ListSort>("custom");
  const [detailSortMenuOpen, setDetailSortMenuOpen] = useState(false);
  const [detailCategoryFilter, setDetailCategoryFilter] = useState<"all" | Category>("all");
  const [nearOrigin, setNearOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [nearLocating, setNearLocating] = useState(false);
  const [nearDenied, setNearDenied] = useState(false);
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
      setDetailSort("custom");
      setDetailSortMenuOpen(false);
      setDetailCategoryFilter("all");
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
        setDetailSort("custom");
        setDetailSortMenuOpen(false);
        setDetailCategoryFilter("all");
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
    setDetailSort("custom");
    setDetailSortMenuOpen(false);
    setDetailCategoryFilter("all");
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
  const dragEnabled = detailSort === "custom" && !searchActive;

  const requestNearOrigin = useCallback(() => {
    if (!navigator.geolocation) {
      setNearDenied(true);
      setNearLocating(false);
      return;
    }
    setNearLocating(true);
    setNearDenied(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNearOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setNearLocating(false);
        setNearDenied(false);
      },
      () => {
        setNearLocating(false);
        setNearDenied(true);
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  }, []);

  const handleListSortChange = useCallback(
    (next: ListSort) => {
      setDetailSort(next);
      setDetailSortMenuOpen(false);
      if (next === "near" && !nearOrigin) {
        requestNearOrigin();
      }
    },
    [nearOrigin, requestNearOrigin],
  );

  const categoryChipItems = useMemo(() => {
    const counts = new Map<Category, number>();
    for (const place of places) {
      const cat = place.category as Category;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
      .map(([cat, count]) => ({ cat, count }));
  }, [places]);

  const listPlacesModel = useMemo(() => {
    const q = detailSearchQuery.trim().toLowerCase();
    const searchFiltered = q
      ? places.filter((place) => {
          const memo = resolveMemo(place) ?? "";
          return (
            place.name.toLowerCase().includes(q) ||
            place.address.toLowerCase().includes(q) ||
            memo.toLowerCase().includes(q)
          );
        })
      : places;
    if (searchFiltered.length === 0) {
      return { kind: "empty_search" as const };
    }

    const applyCategory = detailSort === "near" && detailCategoryFilter !== "all";
    const filtered = applyCategory
      ? searchFiltered.filter((p) => p.category === detailCategoryFilter)
      : searchFiltered;
    if (filtered.length === 0) {
      return { kind: "empty_category" as const };
    }

    if (detailSort === "custom") {
      return { kind: "custom" as const, places: filtered };
    }

    if (detailSort === "region") {
      const regions = new Map<string, PlaceListPlace[]>();
      filtered.forEach((p) => {
        const region = extractListRegion(p.address);
        if (!regions.has(region)) regions.set(region, []);
        regions.get(region)!.push(p);
      });
      const sorted = Array.from(regions.entries()).sort((a, b) =>
        a[0].localeCompare(b[0], "ko"),
      );
      return {
        kind: "region" as const,
        regions: sorted.map(([region, regionPlaces]) => ({
          region,
          regionPlaces,
          categories: LIST_CATEGORY_ORDER.map((cat) => ({
            cat,
            places: regionPlaces.filter((p) => p.category === cat),
          })).filter((g) => g.places.length > 0),
        })),
      };
    }

    if (detailSort === "category") {
      return {
        kind: "category" as const,
        groups: LIST_CATEGORY_ORDER.map((cat) => ({
          cat,
          places: filtered.filter((p) => p.category === cat),
        })).filter((g) => g.places.length > 0),
      };
    }

    // near
    if (!nearOrigin) {
      return {
        kind: "near_need_location" as const,
        locating: nearLocating,
        denied: nearDenied,
      };
    }
    const withDist = filtered.map((place) => {
      const hasCoords =
        typeof place.lat === "number" &&
        Number.isFinite(place.lat) &&
        typeof place.lng === "number" &&
        Number.isFinite(place.lng);
      const meters = hasCoords
        ? listDistanceMeters(nearOrigin.lat, nearOrigin.lng, place.lat!, place.lng!)
        : Number.POSITIVE_INFINITY;
      return { place, meters, hasCoords };
    });
    withDist.sort((a, b) => {
      if (a.hasCoords !== b.hasCoords) return a.hasCoords ? -1 : 1;
      if (a.meters !== b.meters) return a.meters - b.meters;
      return a.place.name.localeCompare(b.place.name, "ko");
    });
    return { kind: "near" as const, items: withDist };
  }, [
    places,
    detailSearchQuery,
    detailSort,
    detailCategoryFilter,
    nearOrigin,
    nearLocating,
    nearDenied,
    resolveMemo,
  ]);

  const handleCategoryFilterChange = useCallback((next: "all" | Category) => {
    setDetailCategoryFilter((prev) => (prev === next && next !== "all" ? "all" : next));
  }, []);

  useEffect(() => {
    if (!detailSortMenuOpen) return;
    const onDoc = () => setDetailSortMenuOpen(false);
    window.setTimeout(() => {
      window.addEventListener("click", onDoc);
    }, 0);
    return () => window.removeEventListener("click", onDoc);
  }, [detailSortMenuOpen]);

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
    if (reordering || !dragEnabled) return;
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
                setDetailSort("custom");
                setDetailSortMenuOpen(false);
                setDetailCategoryFilter("all");
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
            <div className="savedSortRow myListsDetailSortRow">
              <div className="savedSortWrap">
                <button
                  type="button"
                  className="savedSortTrigger"
                  data-testid="list-sort-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={detailSortMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetailSortMenuOpen((o) => !o);
                  }}
                >
                  {LIST_SORT_OPTIONS.find((o) => o.id === detailSort)?.label ?? "내 순서"}
                  <span aria-hidden>▾</span>
                </button>
                {detailSortMenuOpen && (
                  <ul
                    className="savedSortMenu"
                    data-testid="list-sort-menu"
                    role="listbox"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {LIST_SORT_OPTIONS.map((opt) => {
                      const selected = detailSort === opt.id;
                      return (
                        <li key={opt.id} role="presentation">
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`savedSortOption${selected ? " savedSortOptionActive" : ""}`}
                            onClick={() => handleListSortChange(opt.id)}
                          >
                            <span>{opt.label}</span>
                            {selected && (
                              <span className="savedSortOptionCheck" aria-hidden>
                                ✓
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            {detailSort === "near" && places.length > 0 && (
              <div
                className="savedCategoryChips"
                data-testid="list-category-chips"
                role="tablist"
                aria-label="카테고리 필터"
              >
                <button
                  type="button"
                  role="tab"
                  data-testid="list-category-chip"
                  aria-selected={detailCategoryFilter === "all"}
                  className={`savedCategoryChip${detailCategoryFilter === "all" ? " savedCategoryChipSelected" : ""}`}
                  onClick={() => handleCategoryFilterChange("all")}
                >
                  전체
                </button>
                {categoryChipItems.map(({ cat, count }) => {
                  const selected = detailCategoryFilter === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      data-testid="list-category-chip"
                      aria-selected={selected}
                      className={`savedCategoryChip${selected ? " savedCategoryChipSelected" : ""}`}
                      onClick={() => handleCategoryFilterChange(selected ? "all" : cat)}
                    >
                      {categoryPin[cat]?.emoji ?? "📍"} {cat} {count}
                    </button>
                  );
                })}
              </div>
            )}
            {(() => {
              const model = listPlacesModel;
              const renderRow = (
                place: PlaceListPlace,
                metaExtra?: string,
              ) => {
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
                      disabled={reordering || !!removingPlaceId || !dragEnabled || fullIndex < 0}
                      onPointerDown={(e) => {
                        if (!dragEnabled || fullIndex < 0) return;
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
                          {metaExtra ? ` · ${metaExtra}` : ""}
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
              };

              if (model.kind === "empty_search") {
                return <p className="myListsEmptyHint">검색 결과가 없어요</p>;
              }
              if (model.kind === "empty_category") {
                return (
                  <p className="myListsEmptyHint">이 카테고리에 담은 장소가 없어요</p>
                );
              }
              if (model.kind === "near_need_location") {
                return (
                  <p className="myListsEmptyHint">
                    {model.locating
                      ? "현재 위치를 확인하는 중이에요…"
                      : model.denied
                        ? "위치 권한이 꺼져 있어요. 설정에서 허용한 뒤 다시 시도해주세요."
                        : "가까운 순으로 보려면 위치 권한이 필요해요."}
                    {!model.locating && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="savedSortRetryBtn"
                          onClick={() => requestNearOrigin()}
                        >
                          다시 시도
                        </button>
                      </>
                    )}
                  </p>
                );
              }

              const listClass = `myListsDetailList${reordering ? " myListsDetailListBusy" : ""}${
                !dragEnabled ? " myListsDetailListFiltered" : ""
              }`;

              if (model.kind === "custom") {
                return (
                  <ul className={listClass}>{model.places.map((p) => renderRow(p))}</ul>
                );
              }

              if (model.kind === "region") {
                return (
                  <div>
                    {model.regions.map(({ region, regionPlaces, categories }) => (
                      <div key={region} style={{ marginBottom: 28 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 14,
                            padding: "0 4px",
                            borderBottom: "1px solid #eee",
                            paddingBottom: 10,
                          }}
                        >
                          <span style={{ fontSize: 16 }}>📍</span>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: "#1a2a7a",
                              letterSpacing: "0.5px",
                            }}
                          >
                            {region}
                          </span>
                          <span style={{ fontSize: 11, color: "#bbb", marginLeft: 4 }}>
                            {regionPlaces.length}
                          </span>
                        </div>
                        {categories.map(({ cat, places: catPlaces }) => (
                          <div key={cat} style={{ marginBottom: 16, paddingLeft: 8 }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                marginBottom: 8,
                              }}
                            >
                              <span style={{ fontSize: 13 }}>
                                {categoryPin[cat]?.emoji ?? "📍"}
                              </span>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: categoryColors[cat],
                                  letterSpacing: "0.5px",
                                }}
                              >
                                {cat}
                              </span>
                              <span style={{ fontSize: 10, color: "#bbb" }}>
                                {catPlaces.length}
                              </span>
                            </div>
                            <ul className={listClass}>
                              {catPlaces.map((p) => renderRow(p))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              }

              if (model.kind === "category") {
                return (
                  <div>
                    {model.groups.map(({ cat, places: catPlaces }) => (
                      <div key={cat} style={{ marginBottom: 28 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 14,
                            padding: "0 4px",
                            borderBottom: "1px solid #eee",
                            paddingBottom: 10,
                          }}
                        >
                          <span style={{ fontSize: 16 }}>
                            {categoryPin[cat]?.emoji ?? "📍"}
                          </span>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: categoryColors[cat],
                              letterSpacing: "0.5px",
                            }}
                          >
                            {cat}
                          </span>
                          <span style={{ fontSize: 11, color: "#bbb", marginLeft: 4 }}>
                            {catPlaces.length}
                          </span>
                        </div>
                        <ul className={listClass}>
                          {catPlaces.map((p) => renderRow(p))}
                        </ul>
                      </div>
                    ))}
                  </div>
                );
              }

              // near
              return (
                <ul className={listClass}>
                  {model.items.map(({ place, meters, hasCoords }) =>
                    renderRow(
                      place,
                      hasCoords ? formatListDistanceM(meters) : "거리 정보 없음",
                    ),
                  )}
                </ul>
              );
            })()}
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
