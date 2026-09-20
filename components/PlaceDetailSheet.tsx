"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import {
  getFirstMatchingPhotoIndex,
  getRelatedPostImageEntriesForPlace,
} from "@/lib/photoPlaceTag";
import { placeRefFromPlaceSheet, type PlaceSheetData, type PlaceSheetFeedPost } from "@/lib/placeSheet";
import {
  FEED_POST_CATEGORIES,
  type FeedPostCategory,
} from "@/lib/feedPost";
import {
  EDGE_SWIPE_PRIORITY,
  useEdgeSwipeBack,
} from "@/lib/useEdgeSwipeBack";

type DirectionsMode = "car" | "walk";

type Props = {
  place: PlaceSheetData;
  isSaved: boolean;
  layout: "overlay" | "embedded";
  showDirections?: boolean;
  directionsMode?: DirectionsMode;
  directionsLoading?: boolean;
  directionsInfo?: { duration: number; distance: number; approx?: boolean } | null;
  onClose: () => void;
  onToggleSave: () => void;
  /** 저장한 장소를 내 목록에 담기 */
  onAddToList?: () => void;
  /** 저장한 장소 개인 메모 편집 */
  onEditMemo?: () => void;
  /** 저장된 메모 표시용 */
  memo?: string | null;
  /** 저장된 장소 카테고리 즉시 변경 (낙관적 업데이트는 호출측) */
  onCategoryChange?: (category: FeedPostCategory) => void;
  /** 카테고리 칩 배경 — 핀 색과 동일 계열 */
  categoryPin?: Record<string, { color: string; emoji: string }>;
  onCurationClick: (
    postId: string,
    photoIndex?: number,
    opts?: { forceDetail?: boolean },
  ) => void;
  /** 다른 화면(피드 등) 확대용 — 시트 큐레이션 이미지는 사용하지 않음 */
  onImageLightbox: (url: string) => void;
  timeAgoLabel: (createdAt: string) => string;
  /** 컴팩트 맵 위 시트에서 전체화면 지도로 확대 (좌표 우선) */
  onExpandMap?: () => void;
  onDirectionsModeChange?: (mode: DirectionsMode) => void;
  onOpenTransit?: () => void;
  onClearRoute?: () => void;
};

const LIGHT_PIN_CATEGORIES = new Set(["카페", "쇼핑", "숙소", "놀거리", "여행지"]);

function PlaceDetailCurationImages({
  entries,
  onImageSelect,
}: {
  entries: { src: string; photoIndex: number }[];
  onImageSelect: (photoIndex: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const multi = entries.length > 1;

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    setActiveIndex(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  if (entries.length === 0) return null;

  if (!multi) {
    return (
      <div className="placeDetailSheetCurationImages" onClick={(e) => e.stopPropagation()}>
        <img
          src={entries[0].src}
          alt=""
          loading="lazy"
          decoding="async"
          onClick={(ev) => {
            ev.stopPropagation();
            onImageSelect(entries[0].photoIndex);
          }}
        />
      </div>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div ref={scrollRef} className="placeDetailSheetCurationCarousel" onScroll={onScroll}>
        {entries.map((entry) => (
          <img
            key={`${entry.src}-${entry.photoIndex}`}
            src={entry.src}
            alt=""
            className="placeDetailSheetCurationCarouselImg"
            decoding="async"
            onClick={(ev) => {
              ev.stopPropagation();
              onImageSelect(entry.photoIndex);
            }}
          />
        ))}
      </div>
      <p className="placeDetailSheetCurationPage" aria-hidden>
        {activeIndex + 1}/{entries.length}
      </p>
    </div>
  );
}

export function PlaceDetailSheet({
  place,
  isSaved,
  layout,
  showDirections = false,
  directionsMode = "car",
  directionsLoading = false,
  directionsInfo = null,
  onClose,
  onToggleSave,
  onAddToList,
  onEditMemo,
  memo,
  onCategoryChange,
  categoryPin,
  onCurationClick,
  onImageLightbox: _onImageLightbox,
  timeAgoLabel,
  onExpandMap,
  onDirectionsModeChange,
  onOpenTransit,
  onClearRoute,
}: Props) {
  const relatedPosts: PlaceSheetFeedPost[] = place._feedPosts ?? [];
  const placeRef = placeRefFromPlaceSheet(place);
  void _onImageLightbox;
  const heartFill = isSaved ? "#e53935" : "none";
  const heartStroke = isSaved ? "#e53935" : "#1a2a7a";
  const lat = parseFloat(String(place.y ?? ""));
  const lng = parseFloat(String(place.x ?? ""));
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  const savedPlaceId =
    typeof place._savedPlaceId === "string" ? place._savedPlaceId.trim() : "";
  // 저장됨(하트) + 본인 places id + 핸들러 있을 때만 칩. id만 있고 미저장이면 텍스트.
  const canEditCategory = Boolean(isSaved && savedPlaceId && onCategoryChange);
  const currentCategory = place.category_name?.trim() || "";
  const pinStyle = categoryPin?.[currentCategory];
  const chipBg = pinStyle?.color ?? "#888";
  const chipFg = LIGHT_PIN_CATEGORIES.has(currentCategory) ? "#333" : "#fff";

  // 장소가 바뀌면 펼침 상태 초기화 (이전 시트 잔존 방지)
  useEffect(() => {
    setCategoryPickerOpen(false);
  }, [savedPlaceId, place.place_name, place.road_address_name, place.y, place.x]);

  useEffect(() => {
    if (!canEditCategory && categoryPickerOpen) setCategoryPickerOpen(false);
  }, [canEditCategory, categoryPickerOpen]);

  useEdgeSwipeBack({
    id: "category-picker",
    enabled: categoryPickerOpen,
    priority: EDGE_SWIPE_PRIORITY.CATEGORY_PICKER,
    onClose: () => setCategoryPickerOpen(false),
  });

  const selectCategory = (cat: FeedPostCategory) => {
    setCategoryPickerOpen(false);
    if (!canEditCategory || !onCategoryChange) return;
    if (cat === currentCategory) return;
    onCategoryChange(cat);
  };

  return (
    <div
      className={layout === "overlay" ? "placeDetailSheet placeDetailSheetOverlay" : "placeDetailSheet placeDetailSheetEmbedded"}
      role="dialog"
      aria-label="장소 정보"
      onClick={(e) => {
        e.stopPropagation();
        if (categoryPickerOpen) setCategoryPickerOpen(false);
      }}
    >
      <div className="placeDetailSheetHeader">
        <div className="placeDetailSheetHeaderText">
          <p className="placeDetailSheetName">{place.place_name}</p>
          {canEditCategory && currentCategory ? (
            <div className="placeDetailSheetCategoryBlock">
              <button
                type="button"
                className="placeDetailSheetCategoryChip"
                style={{ background: chipBg, color: chipFg, borderColor: chipBg }}
                aria-expanded={categoryPickerOpen}
                aria-label={`카테고리 ${currentCategory} — 변경`}
                onClick={(e) => {
                  e.stopPropagation();
                  setCategoryPickerOpen((open) => !open);
                }}
              >
                <span>
                  {pinStyle?.emoji ? `${pinStyle.emoji} ` : ""}
                  {currentCategory}
                </span>
                <span
                  className={
                    categoryPickerOpen
                      ? "placeDetailSheetCategoryChipCaret isOpen"
                      : "placeDetailSheetCategoryChipCaret"
                  }
                  aria-hidden
                >
                  ⌄
                </span>
              </button>
              {categoryPickerOpen ? (
                <ul
                  className="placeDetailSheetCategoryInlineList"
                  role="listbox"
                  aria-label="카테고리 선택"
                  onClick={(e) => e.stopPropagation()}
                >
                  {FEED_POST_CATEGORIES.map((cat) => {
                    const style = categoryPin?.[cat];
                    const selected = cat === currentCategory;
                    return (
                      <li key={cat} role="option" aria-selected={selected}>
                        <button
                          type="button"
                          className={
                            selected
                              ? "placeDetailSheetCategoryInlineItem isSelected"
                              : "placeDetailSheetCategoryInlineItem"
                          }
                          onClick={() => selectCategory(cat)}
                        >
                          <span
                            className="placeDetailSheetCategoryInlineDot"
                            style={{ background: style?.color ?? "#ccc" }}
                            aria-hidden
                          />
                          <span>
                            {style?.emoji ? `${style.emoji} ` : ""}
                            {cat}
                          </span>
                          {selected ? (
                            <span className="placeDetailSheetCategoryInlineCheck">✓</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : currentCategory ? (
            <p className="placeDetailSheetCategory">{currentCategory}</p>
          ) : null}
        </div>
        <div className="placeDetailSheetHeaderActions">
          <button type="button" className="placeDetailSheetHeartBtn" onClick={onToggleSave} aria-label={isSaved ? "저장 취소" : "장소 저장"}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill={heartFill} aria-hidden>
              <path
                d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z"
                stroke={heartStroke}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button type="button" className="placeDetailSheetCloseBtn" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
      </div>

      <div className="placeDetailSheetBody">
        {memo?.trim() ? (
          <p className="placeDetailSheetMemo">✎ {memo.trim()}</p>
        ) : null}
        {place.road_address_name && (
          <div className="placeDetailSheetRow">
            <span className="placeDetailSheetLabel">주소</span>
            <span className="placeDetailSheetValue">{place.road_address_name}</span>
          </div>
        )}
        {place.phone && (
          <div className="placeDetailSheetRow placeDetailSheetRowCenter">
            <span className="placeDetailSheetLabel">전화</span>
            <a className="placeDetailSheetLink" href={`tel:${place.phone}`}>
              {place.phone}
            </a>
          </div>
        )}
        {place.place_url && (
          <a className="placeDetailSheetKakaoBtn" href={place.place_url} target="_blank" rel="noreferrer">
            카카오맵에서 영업시간 보기
          </a>
        )}

        {onExpandMap && (
          <button
            type="button"
            className="placeDetailSheetExpandMapBtn"
            disabled={!hasCoordinates}
            onClick={onExpandMap}
          >
            지도 크게 보기
          </button>
        )}

        {(onAddToList || onEditMemo) && (
          <div className="placeDetailSheetActionRow">
            {onAddToList && (
              <button
                type="button"
                className="placeDetailSheetAddToListBtn"
                onClick={onAddToList}
              >
                목록에 추가
              </button>
            )}
            {onEditMemo && (
              <button
                type="button"
                className="placeDetailSheetMemoBtn"
                onClick={onEditMemo}
              >
                {memo?.trim() ? "메모 수정" : "메모 추가"}
              </button>
            )}
          </div>
        )}

        {showDirections && (
          <div className="placeDetailSheetDirections">
            {!hasCoordinates && (
              <p className="placeDetailSheetDirectionsHint">
                이 장소는 위치 정보가 없어 길찾기를 할 수 없어요
              </p>
            )}
            <div className="placeDetailSheetDirectionsModes">
              {(
                [
                  { id: "car" as const, label: "🚗 자동차" },
                  { id: "walk" as const, label: "🚶 도보" },
                  { id: "transit" as const, label: "🚌 대중교통" },
                ] as const
              ).map((m) => {
                const isActive =
                  m.id !== "transit" && directionsMode === m.id && !!directionsInfo;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={directionsLoading || !hasCoordinates}
                    className={isActive ? "placeDetailSheetModeBtn placeDetailSheetModeBtnActive" : "placeDetailSheetModeBtn"}
                    onClick={() => {
                      if (!hasCoordinates) return;
                      if (m.id === "transit") {
                        onOpenTransit?.();
                      } else {
                        onDirectionsModeChange?.(m.id);
                      }
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            {directionsLoading && <p className="placeDetailSheetDirectionsHint">경로 계산 중...</p>}
            {directionsInfo && !directionsLoading && (
              <div className="placeDetailSheetDirectionsResult">
                <span>🕐 {directionsInfo.approx ? `약 ${directionsInfo.duration}분` : `${directionsInfo.duration}분`}</span>
                <span>📍 {directionsInfo.distance}km</span>
                {onClearRoute && (
                  <button type="button" className="placeDetailSheetClearRoute" onClick={onClearRoute}>
                    경로 지우기
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {relatedPosts.length > 0 ? (
        <div className="placeDetailSheetCurations">
          <p className="placeDetailSheetCurationsTitle">큐레이션 {relatedPosts.length}</p>
          {relatedPosts.map((post) => {
            const entries = getRelatedPostImageEntriesForPlace(post, placeRef);
            return (
              <button
                key={post.id}
                type="button"
                className="placeDetailSheetCurationItem"
                onClick={() => onCurationClick(post.id, getFirstMatchingPhotoIndex(post, placeRef))}
              >
                <div className="placeDetailSheetCurationTop">
                  <ProfileAvatar avatarUrl={post.userAvatarUrl} username={post.user} size={26} fontSize={11} />
                  <span className="placeDetailSheetCurationUser">{post.user}</span>
                  <span className="placeDetailSheetCurationTime">{timeAgoLabel(post.createdAt)}</span>
                </div>
                <p className="placeDetailSheetCurationTitle">{post.title || post.placeName}</p>
                <PlaceDetailCurationImages
                  entries={entries}
                  onImageSelect={(photoIndex) =>
                    onCurationClick(post.id, photoIndex, { forceDetail: true })
                  }
                />
                <p className="placeDetailSheetCurationComment">{post.comment}</p>
                <div className="placeDetailSheetCurationStats">
                  <span style={{ color: post.liked_by_me ? "#e05555" : "#ccc" }}>♥ {post.likes_count}</span>
                  <span>💬 {post.comments.length}</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="placeDetailSheetCurationsEmpty">
          <p>아직 큐레이션이 없어요</p>
        </div>
      )}

    </div>
  );
}
