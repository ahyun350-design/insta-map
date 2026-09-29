"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchPublicPlaceListPlaces,
  type PublicPlaceListPlace,
  type PublicPlaceListSummary,
} from "@/lib/placeLists";
import { ListColorDot } from "@/components/ListColorSwatches";
import { formatCategoryWithSubcategory } from "@/lib/kakaoSubcategory";
import { LIST_COLOR_PRESETS } from "@/lib/listColors";
import {
  EDGE_SWIPE_PRIORITY,
  useEdgeSwipeBack,
} from "@/lib/useEdgeSwipeBack";
import {
  copyTextToClipboard,
  getListShareUrl,
  getTrackDomain,
  shareViaNavigatorShare,
} from "@/lib/pindmapLinks";
import { trackPublicListEvent } from "@/lib/track";

type Props = {
  open: boolean;
  list: PublicPlaceListSummary | null;
  ownerLabel?: string;
  categoryColors: Record<string, string>;
  onClose: () => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

export function PublicPlaceListScreen({
  open,
  list,
  ownerLabel,
  categoryColors,
  onClose,
  showToast,
}: Props) {
  const [places, setPlaces] = useState<PublicPlaceListPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PublicPlaceListPlace | null>(null);
  const [mapError, setMapError] = useState(false);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<{ setMap?: (v: null) => void }[] | null>(null);
  const kakaoMapRef = useRef<{ relayout?: () => void } | null>(null);

  useEdgeSwipeBack({
    id: "public-place-list",
    enabled: open && !!list && !selected,
    priority: EDGE_SWIPE_PRIORITY.PUBLIC_PLACE_LIST,
    onClose,
  });

  useEdgeSwipeBack({
    id: "public-place-list-place",
    enabled: open && !!selected,
    priority: EDGE_SWIPE_PRIORITY.PLACE_SHEET,
    onClose: () => setSelected(null),
  });

  const load = useCallback(async () => {
    if (!list?.id) return;
    setLoading(true);
    const { data, error } = await fetchPublicPlaceListPlaces(list.id);
    setLoading(false);
    if (error) {
      showToast(error, "error");
      setPlaces([]);
      return;
    }
    setPlaces(data);
  }, [list?.id, showToast]);

  useEffect(() => {
    if (!open || !list) {
      setPlaces([]);
      setSelected(null);
      setMapError(false);
      return;
    }
    void load();
  }, [open, list, load]);

  const handleShare = async () => {
    if (!list) return;
    const url = getListShareUrl(list.id);
    trackPublicListEvent("list_share_click", {
      list_id: list.id,
      domain: getTrackDomain(),
    });
    const result = await shareViaNavigatorShare({
      title: list.title,
      text: `PindMap에서 ${list.title} 목록 보기`,
      url,
    });
    if (result === "shared" || result === "cancelled") return;
    const ok = await copyTextToClipboard(url);
    if (ok) {
      showToast("링크를 복사했어요", "success");
    } else {
      showToast("복사할 수 없어요", "error");
    }
  };

  useEffect(() => {
    if (!open || !list || loading || places.length === 0) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    const markers: { setMap?: (v: null) => void }[] = [];
    let timer = 0;

    const draw = () => {
      const el = mapRef.current;
      if (!el || cancelled) return;
      const kakao = (
        window as unknown as {
          kakao?: {
            maps: {
              LatLng: new (lat: number, lng: number) => unknown;
              Map: new (
                el: HTMLElement,
                opts: { center: unknown; level: number },
              ) => {
                setCenter: (c: unknown) => void;
                setBounds?: (b: unknown) => void;
                relayout?: () => void;
              };
              Marker: new (opts: { position: unknown }) => {
                setMap: (m: unknown) => void;
              };
              LatLngBounds: new () => {
                extend: (ll: unknown) => void;
              };
            };
          };
        }
      ).kakao;
      if (!kakao?.maps) {
        setMapError(true);
        return;
      }
      const withCoords = places.filter(
        (p) => typeof p.lat === "number" && typeof p.lng === "number",
      );
      if (withCoords.length === 0) {
        setMapError(true);
        return;
      }
      setMapError(false);
      const center = new kakao.maps.LatLng(withCoords[0]!.lat!, withCoords[0]!.lng!);
      const map = new kakao.maps.Map(el, { center, level: 5 });
      kakaoMapRef.current = map;
      const bounds = new kakao.maps.LatLngBounds();
      for (const p of withCoords) {
        const pos = new kakao.maps.LatLng(p.lat!, p.lng!);
        bounds.extend(pos);
        const marker = new kakao.maps.Marker({ position: pos });
        marker.setMap(map);
        markers.push(marker);
      }
      if (withCoords.length > 1) {
        try {
          map.setBounds?.(bounds);
        } catch {
          /* older SDK */
        }
      }
      mapInstanceRef.current = markers;
      window.setTimeout(() => {
        try {
          map.relayout?.();
        } catch {
          /* ignore */
        }
      }, 80);
    };

    timer = window.setTimeout(draw, 60);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      for (const m of markers) {
        try {
          m.setMap?.(null);
        } catch {
          /* ignore */
        }
      }
      mapInstanceRef.current = null;
      kakaoMapRef.current = null;
    };
  }, [open, list, loading, places]);

  if (!open || !list || typeof document === "undefined") return null;

  const listColor =
    (list.color && LIST_COLOR_PRESETS[list.color as keyof typeof LIST_COLOR_PRESETS]) ||
    "#1a2a7a";

  return createPortal(
    <div
      className="publicPlaceListScreen"
      role="dialog"
      aria-modal="true"
      aria-label={`${list.title} 공개 목록`}
      data-testid="public-place-list-screen"
    >
      <header className="publicPlaceListHeader">
        <button
          type="button"
          className="publicPlaceListBack"
          aria-label="뒤로가기"
          data-testid="public-place-list-back"
          onClick={onClose}
        >
          ←
        </button>
        <div className="publicPlaceListHeaderText">
          <p className="publicPlaceListTitle">
            <ListColorDot color={list.color} size={12} />
            <span>{list.title}</span>
          </p>
          {ownerLabel ? (
            <p className="publicPlaceListOwner">{ownerLabel}</p>
          ) : null}
        </div>
        <div className="publicPlaceListHeaderActions">
          <button
            type="button"
            className="publicPlaceListShareBtn"
            data-testid="public-place-list-share"
            aria-label="목록 공유"
            onClick={() => void handleShare()}
          >
            공유
          </button>
          <span className="publicPlaceListHeaderMeta">
            {places.length || list.place_count}곳
          </span>
        </div>
      </header>

      <div className="publicPlaceListMapWrap" aria-hidden={mapError}>
        {mapError ? (
          <p className="publicPlaceListMapFallback">지도 미리보기를 불러오지 못했어요</p>
        ) : (
          <div ref={mapRef} className="publicPlaceListMap" data-testid="public-place-list-map" />
        )}
      </div>

      <div className="publicPlaceListBody">
        {loading ? (
          <p className="publicPlaceListHint">불러오는 중…</p>
        ) : places.length === 0 ? (
          <p className="publicPlaceListHint">담긴 장소가 없어요</p>
        ) : (
          <ul className="publicPlaceListItems" data-testid="public-place-list-items">
            {places.map((p) => {
              const color = categoryColors[p.category] ?? listColor;
              const catLabel = formatCategoryWithSubcategory(p.category, p.subcategory);
              return (
                <li key={p.place_id}>
                  <button
                    type="button"
                    className="publicPlaceListItem"
                    data-testid="public-place-list-item"
                    onClick={() => setSelected(p)}
                  >
                    <span
                      className="publicPlaceListItemBar"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <span className="publicPlaceListItemText">
                      <span className="publicPlaceListItemName">{p.name}</span>
                      {catLabel ? (
                        <span className="publicPlaceListItemMeta">{catLabel}</span>
                      ) : null}
                      <span className="publicPlaceListItemAddr">{p.address}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected ? (
        <div
          className="publicPlaceListPlaceSheet"
          role="dialog"
          aria-label="장소 정보"
          data-testid="public-place-readout"
        >
          <div
            className="publicPlaceListPlaceBackdrop"
            onClick={() => setSelected(null)}
            aria-hidden
          />
          <div className="publicPlaceListPlaceCard">
            <div className="publicPlaceListPlaceCardHeader">
              <p className="publicPlaceListPlaceName">{selected.name}</p>
              <button
                type="button"
                className="publicPlaceListPlaceClose"
                aria-label="닫기"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
            <p className="publicPlaceListPlaceCat">
              {formatCategoryWithSubcategory(selected.category, selected.subcategory)}
            </p>
            <p className="publicPlaceListPlaceAddr">{selected.address}</p>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
