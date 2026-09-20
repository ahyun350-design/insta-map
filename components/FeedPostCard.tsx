"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { companionTagDisplayLabel, isCompanionTag, type CompanionTag } from "@/lib/companionTag";
import {
  isOwnFeedAuthor,
  type FeedPostCategory,
  type PhotoPlaceTag,
} from "@/lib/feedPost";
import {
  formatDisplayCategoriesForUi,
  projectPostForCategoryFilter,
} from "@/lib/categoryUtil";
import { FeedPostLinkedCourse } from "@/components/FeedPostLinkedCourse";
import {
  getDisplayPlaceForPhoto,
  getRepresentativePlaceForPost,
  type PlaceRefForPhotoTagMatch,
} from "@/lib/photoPlaceTag";
import type { SavedCourse } from "@/lib/courses";
import {
  curationAspectRatioCss,
  DEFAULT_CURATION_ASPECT_RATIO,
  type CurationAspectRatio,
} from "@/lib/curationAspectRatio";
import { perfNow } from "@/lib/debugLog";

type Category = FeedPostCategory;

export type FeedPostCardData = {
  id: string;
  user: string;
  userId: string;
  userAvatarUrl?: string;
  title: string;
  placeName: string;
  address?: string;
  lat?: number;
  lng?: number;
  category: Category;
  categories?: string[] | null;
  comment: string;
  photoPlaceTags?: PhotoPlaceTag[] | null;
  images: string[];
  aspectRatio?: CurationAspectRatio | null;
  createdAt: string;
  companionTag?: CompanionTag | null;
  courseId?: string | null;
  likes_count: number;
  liked_by_me: boolean;
  comments: unknown[];
};

type Props = {
  post: FeedPostCardData;
  myUsername: string;
  isFollowing: boolean;
  menuOpen: boolean;
  timeAgoLabel: string;
  categoryPin: Record<Category, { emoji: string }>;
  onCardClick: () => void;
  onProfileClick: () => void;
  onFollow: () => void;
  onUnfollow: () => void;
  onToggleMenu: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onToggleLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onPlaceOverlayClick?: (placeRef: PlaceRefForPhotoTagMatch) => void;
  currentUserId?: string;
  ensureCourseLoaded?: (courseId: string) => Promise<SavedCourse | null>;
  onOpenLinkedCourse?: (course: SavedCourse, readOnly: boolean) => void;
  onLinkedCourseUnavailable?: () => void;
  /**
   * 홈 카테고리 필터(가). "all"/생략 시 원본과 동일.
   * 필터 시 매칭 사진만 캐러셀·뱃지 표시. 좋아요/댓글은 그대로.
   */
  categoryFilter?: "all" | FeedPostCategory;
};

const CAPTION_PREVIEW_LEN = 100;

function formatLikeCount(n: number): string {
  return n.toLocaleString("ko-KR");
}

const SWIPE_MOVE_PX = 10;
const SWIPE_SCROLL_PX = 2;

type FeedPostMediaVariant = "list" | "detail";

function clampPhotoIndex(raw: number, count: number): number {
  if (!Number.isFinite(raw) || raw < 0 || count <= 0) return 0;
  return Math.min(Math.floor(raw), count - 1);
}

/** list: 0(+1). detail: center ±1 only (no hardcoded 0..2). */
function initialLoadIndices(
  variant: FeedPostMediaVariant,
  count: number,
  center = 0,
): Set<number> {
  const s = new Set<number>();
  if (count <= 0) return s;
  if (variant === "detail") {
    const c = clampPhotoIndex(center, count);
    for (const i of [c - 1, c, c + 1]) {
      if (i >= 0 && i < count) s.add(i);
    }
    return s;
  }
  s.add(0);
  if (count > 1) s.add(1);
  return s;
}

export function FeedPostMedia({
  images,
  placeSource,
  onMediaClick,
  onPlaceOverlayClick,
  mediaAriaLabel = "게시물 상세 보기",
  variant = "list",
  aspectRatio = DEFAULT_CURATION_ASPECT_RATIO,
  initialIndex = 0,
  perfChip,
  perfOpenAt,
}: {
  images: string[];
  placeSource: Pick<
    FeedPostCardData,
    "placeName" | "address" | "category" | "lat" | "lng" | "photoPlaceTags"
  >;
  onMediaClick: (payload: { imageUrl: string; index: number }) => void;
  onPlaceOverlayClick?: (placeRef: PlaceRefForPhotoTagMatch) => void;
  mediaAriaLabel?: string;
  /** list: 홈/카드 lazy / detail: 상세 eager·프리로드 */
  variant?: FeedPostMediaVariant;
  aspectRatio?: CurationAspectRatio | null;
  /** 상세 등에서 특정 사진부터 보이기 (범위 밖이면 0) */
  initialIndex?: number;
  /** detail.firstPixel 로그용 — 홈 카테고리 칩 id */
  perfChip?: string;
  /** performance.now() at tap / open */
  perfOpenAt?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const targetScrollIndexRef = useRef(clampPhotoIndex(initialIndex, images.length));
  const firstPixelLoggedRef = useRef(false);
  const widenedBeyondNeighborRef = useRef(false);

  const clampIndex = useCallback(
    (raw: number) => clampPhotoIndex(raw, images.length),
    [images.length],
  );
  const [activeIndex, setActiveIndex] = useState(() => clampIndex(initialIndex));
  const [loadIndices, setLoadIndices] = useState<Set<number>>(() =>
    initialLoadIndices(variant, images.length, clampPhotoIndex(initialIndex, images.length)),
  );
  const multi = images.length > 1;
  const pointerStartRef = useRef<{ x: number; y: number; scrollLeft: number } | null>(null);
  const suppressTapRef = useRef(false);
  const frameAspect = aspectRatio ?? DEFAULT_CURATION_ASPECT_RATIO;
  const aspectCss = curationAspectRatioCss(frameAspect);
  const mediaInteractive = variant !== "detail";

  const expandLoadIndices = useCallback(
    (center: number, radius = 1) => {
      setLoadIndices((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (let d = -radius; d <= radius; d++) {
          const i = center + d;
          if (i >= 0 && i < images.length && !next.has(i)) {
            next.add(i);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [images.length],
  );

  const applyScrollLeftNow = useCallback((el: HTMLDivElement | null, idx: number) => {
    if (!el) return false;
    const w = el.clientWidth;
    if (w <= 0) return false;
    const left = idx * w;
    if (Math.abs(el.scrollLeft - left) > 0.5) {
      el.scrollLeft = left;
    }
    return true;
  }, []);

  /** Mount-time sync scroll — avoids one frame at index 0 before jumping to n. */
  const setTrackRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      if (el) applyScrollLeftNow(el, targetScrollIndexRef.current);
    },
    [applyScrollLeftNow],
  );

  useLayoutEffect(() => {
    const idx = clampIndex(initialIndex);
    targetScrollIndexRef.current = idx;
    firstPixelLoggedRef.current = false;
    widenedBeyondNeighborRef.current = false;
    setActiveIndex(idx);
    setLoadIndices(initialLoadIndices(variant, images.length, idx));
    applyScrollLeftNow(scrollRef.current, idx);
  }, [variant, images.join("\0"), initialIndex, clampIndex, applyScrollLeftNow]);

  useEffect(() => {
    expandLoadIndices(activeIndex, 1);
  }, [activeIndex, expandLoadIndices]);

  const markFirstPixelAndWiden = useCallback(
    (i: number) => {
      if (variant !== "detail") return;
      if (i !== activeIndex) return;

      if (!firstPixelLoggedRef.current) {
        firstPixelLoggedRef.current = true;
        const ms =
          typeof perfOpenAt === "number" && Number.isFinite(perfOpenAt)
            ? Math.round(perfNow() - perfOpenAt)
            : null;
        // eslint-disable-next-line no-console
        console.log("[PindMap:perf] detail.firstPixel", {
          chip: perfChip ?? "unknown",
          index: i,
          ms,
        });
      }

      if (!widenedBeyondNeighborRef.current) {
        widenedBeyondNeighborRef.current = true;
        // After first paint of the target photo, prefetch ±2
        requestAnimationFrame(() => {
          expandLoadIndices(activeIndex, 2);
        });
      }
    },
    [variant, activeIndex, perfChip, perfOpenAt, expandLoadIndices],
  );

  /** 상세: 가로 스크롤 IO로 여유(400px) 있게 미리 마운트 — native lazy 대신 */
  useEffect(() => {
    if (variant !== "detail") return;
    const root = scrollRef.current;
    if (!root) return;
    const slides = root.querySelectorAll<HTMLElement>("[data-slide-index]");
    if (slides.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const raw = (entry.target as HTMLElement).dataset.slideIndex;
          const i = raw != null ? Number(raw) : NaN;
          if (!Number.isFinite(i)) continue;
          expandLoadIndices(i, 1);
        }
      },
      { root, rootMargin: "0px 400px", threshold: 0 },
    );
    slides.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [variant, images.length, expandLoadIndices]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(next);
    targetScrollIndexRef.current = next;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scrollRef.current?.scrollLeft ?? 0,
    };
    suppressTapRef.current = false;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const start = pointerStartRef.current;
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    const scrollDelta = Math.abs((scrollRef.current?.scrollLeft ?? 0) - start.scrollLeft);
    if (dx > SWIPE_MOVE_PX || dy > SWIPE_MOVE_PX || scrollDelta > SWIPE_SCROLL_PX) {
      suppressTapRef.current = true;
    }
  }, []);

  const handlePointerEnd = useCallback(() => {
    const start = pointerStartRef.current;
    if (start && scrollRef.current) {
      const scrollDelta = Math.abs(scrollRef.current.scrollLeft - start.scrollLeft);
      if (scrollDelta > SWIPE_SCROLL_PX) suppressTapRef.current = true;
    }
    pointerStartRef.current = null;
  }, []);

  const handleMediaClick = useCallback(
    (e: React.MouseEvent) => {
      if (!mediaInteractive) return;
      if (suppressTapRef.current) {
        suppressTapRef.current = false;
        return;
      }
      e.stopPropagation();
      const imageUrl = images[activeIndex] ?? images[0] ?? "";
      onMediaClick({ imageUrl, index: activeIndex });
    },
    [mediaInteractive, onMediaClick, images, activeIndex],
  );

  const displayPlace = getDisplayPlaceForPhoto(
    {
      photoPlaceTags: placeSource.photoPlaceTags,
      placeName: placeSource.placeName,
      address: placeSource.address ?? "",
      category: placeSource.category,
      lat: placeSource.lat,
      lng: placeSource.lng,
    },
    activeIndex,
  );
  const overlayPlaceName = displayPlace?.placeName?.trim() ?? "";

  if (images.length === 0) {
    return (
      <div
        className="feedPostMediaPlaceholder"
        aria-hidden
        style={{ ["--feed-post-aspect" as string]: aspectCss }}
      >
        <span className="feedPostMediaPlaceholderIcon">📷</span>
        <span className="feedPostMediaPlaceholderText">사진 없음</span>
      </div>
    );
  }

  return (
    <div
      className={`feedPostMedia${variant === "detail" ? " feedPostMedia--detail" : ""}`}
      style={{ ["--feed-post-aspect" as string]: aspectCss }}
    >
      <div
        ref={setTrackRef}
        className="feedPostMediaTrack"
        role={mediaInteractive ? "button" : undefined}
        tabIndex={mediaInteractive ? 0 : undefined}
        aria-label={mediaInteractive ? mediaAriaLabel : undefined}
        onScroll={onScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onClick={handleMediaClick}
        onKeyDown={(e) => {
          if (!mediaInteractive) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            const imageUrl = images[activeIndex] ?? images[0] ?? "";
            onMediaClick({ imageUrl, index: activeIndex });
          }
        }}
      >
        {images.map((src, i) => {
          const shouldLoad = loadIndices.has(i);
          const nearActive = Math.abs(i - activeIndex) <= 1;
          const eager = variant === "detail" && nearActive;
          return (
            <div key={`${src}-${i}`} className="feedPostMediaSlide" data-slide-index={i}>
              {shouldLoad ? (
                <img
                  src={src}
                  alt=""
                  className="feedPostMediaImg"
                  draggable={false}
                  decoding="async"
                  {...(variant === "detail"
                    ? {
                        loading: (eager ? "eager" : "lazy") as "eager" | "lazy",
                        fetchPriority: (i === activeIndex ? "high" : "auto") as
                          | "high"
                          | "auto",
                        onLoad: () => markFirstPixelAndWiden(i),
                        ref: (img: HTMLImageElement | null) => {
                          if (img && img.complete && img.naturalWidth > 0) {
                            markFirstPixelAndWiden(i);
                          }
                        },
                      }
                    : { loading: "lazy" as const })}
                />
              ) : (
                <div className="feedPostMediaImg feedPostMediaImgSkeleton" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
      {overlayPlaceName && (
        <button
          type="button"
          className="feedPostMediaOverlayPlace"
          onClick={(e) => {
            e.stopPropagation();
            if (!displayPlace) return;
            onPlaceOverlayClick?.({
              placeId: displayPlace.placeId,
              placeName: displayPlace.placeName,
              address: displayPlace.address,
              lat: displayPlace.lat,
              lng: displayPlace.lng,
            });
          }}
        >
          📍 {overlayPlaceName}
        </button>
      )}
      {multi && (
        <span className="feedPostMediaOverlayPage">
          {activeIndex + 1}/{images.length}
        </span>
      )}
      {multi && (
        <div className="feedPostMediaDots" aria-hidden>
          {images.map((_, i) => (
            <span
              key={i}
              className={i === activeIndex ? "feedPostMediaDot feedPostMediaDotActive" : "feedPostMediaDot"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FeedPostCardComponent({
  post,
  myUsername,
  isFollowing,
  menuOpen,
  timeAgoLabel,
  categoryPin,
  onCardClick,
  onProfileClick,
  onFollow,
  onUnfollow,
  onToggleMenu,
  onEdit,
  onArchive,
  onDelete,
  onToggleLike,
  onComment,
  onShare,
  onPlaceOverlayClick,
  currentUserId = "",
  ensureCourseLoaded,
  onOpenLinkedCourse,
  onLinkedCourseUnavailable,
  categoryFilter = "all",
}: Props) {
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [likePop, setLikePop] = useState(false);
  const isOwn = isOwnFeedAuthor(post.userId, post.user, currentUserId, myUsername);
  const showFollow = !isOwn && !!post.userId;
  const titleText = post.title?.trim();
  const commentText = post.comment?.trim() ?? "";
  const needsCaptionExpand = commentText.length > CAPTION_PREVIEW_LEN;
  const captionVisible =
    captionExpanded || !needsCaptionExpand
      ? commentText
      : `${commentText.slice(0, CAPTION_PREVIEW_LEN).trimEnd()}…`;

  const filterView = useMemo(
    () =>
      projectPostForCategoryFilter(
        {
          category: post.category,
          categories: post.categories,
          images: post.images,
          photoPlaceTags: post.photoPlaceTags,
          placeName: post.placeName,
          address: post.address ?? "",
        },
        categoryFilter,
      ),
    [
      categoryFilter,
      post.category,
      post.categories,
      post.images,
      post.photoPlaceTags,
      post.placeName,
      post.address,
    ],
  );

  const displayImages =
    filterView.images.length > 0 ? filterView.images : post.images.slice(0, 1);
  const repPlaceAll = useMemo(
    () =>
      getRepresentativePlaceForPost({
        photoPlaceTags: post.photoPlaceTags,
        placeName: post.placeName,
        address: post.address ?? "",
        category: post.category,
        lat: post.lat,
        lng: post.lng,
      }),
    [
      post.photoPlaceTags,
      post.placeName,
      post.address,
      post.category,
      post.lat,
      post.lng,
    ],
  );
  const displayPlaceSource = useMemo(
    () => ({
      placeName:
        categoryFilter === "all"
          ? repPlaceAll.placeName
          : filterView.placeName,
      address:
        categoryFilter === "all"
          ? repPlaceAll.address
          : filterView.address,
      category: post.category,
      lat: post.lat,
      lng: post.lng,
      photoPlaceTags: filterView.photoPlaceTags,
    }),
    [
      filterView,
      categoryFilter,
      repPlaceAll.placeName,
      repPlaceAll.address,
      post.category,
      post.lat,
      post.lng,
    ],
  );

  const { visible: visibleCategories, extraCount: extraCategoryCount } =
    formatDisplayCategoriesForUi(filterView.visibleCategories);
  const companionLabel =
    post.companionTag && isCompanionTag(post.companionTag)
      ? companionTagDisplayLabel(post.companionTag)
      : null;
  const otherPlacesHint =
    categoryFilter !== "all" && filterView.narrowed && filterView.otherPlaceCount > 0
      ? `이 큐레이션에 다른 장소 ${filterView.otherPlaceCount}곳이 더 있어요`
      : null;

  const handleLike = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setLikePop(true);
      window.setTimeout(() => setLikePop(false), 320);
      onToggleLike();
    },
    [onToggleLike],
  );

  const handleMediaClick = useCallback(() => {
    onCardClick();
  }, [onCardClick]);

  return (
    <article className="feedPostCard" onClick={onCardClick} role="button" tabIndex={0}>
      <header className="feedPostHeader">
        <button type="button" className="feedPostHeaderProfile" onClick={(e) => { e.stopPropagation(); onProfileClick(); }}>
          <ProfileAvatar avatarUrl={post.userAvatarUrl} username={post.user} size={34} className="avatar" />
          <div className="feedPostHeaderMeta">
            <span className="feedPostUsername">{post.user}</span>
            <span className="feedPostTime">{timeAgoLabel}</span>
          </div>
        </button>
        {showFollow && !isFollowing && (
          <button type="button" className="feedPostFollowBtn" onClick={(e) => { e.stopPropagation(); onFollow(); }}>
            + 팔로우
          </button>
        )}
        {showFollow && isFollowing && (
          <button type="button" className="feedPostFollowingBtn" onClick={(e) => { e.stopPropagation(); onUnfollow(); }}>
            팔로잉
          </button>
        )}
        {isOwn && (
          <div className="feedPostMenuWrap">
            <button type="button" className="feedPostMenuBtn" onClick={(e) => { e.stopPropagation(); onToggleMenu(); }} aria-label="메뉴">
              <span /><span /><span />
            </button>
            {menuOpen && (
              <div className="feedPostMenuDropdown" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={onEdit}>✏️ 수정</button>
                <button type="button" onClick={onArchive}>📦 보관</button>
                <button type="button" className="feedPostMenuDelete" onClick={onDelete}>🗑️ 삭제</button>
              </div>
            )}
          </div>
        )}
      </header>

      <FeedPostMedia
        images={displayImages}
        placeSource={displayPlaceSource}
        aspectRatio={post.aspectRatio}
        initialIndex={filterView.thumbSourceIndex}
        onMediaClick={handleMediaClick}
        onPlaceOverlayClick={onPlaceOverlayClick}
      />

      <div className="feedPostBody" onClick={(e) => e.stopPropagation()}>
        <div className="feedPostActions">
          <div className="feedPostActionsLeft">
            <button
              type="button"
              className={likePop ? "feedPostActionBtn feedPostLikePop" : "feedPostActionBtn"}
              aria-label="좋아요"
              onClick={handleLike}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill={post.liked_by_me ? "#ed4956" : "none"} aria-hidden>
                <path
                  d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z"
                  stroke={post.liked_by_me ? "#ed4956" : "#262626"}
                  strokeWidth="1.8"
                />
              </svg>
            </button>
            <button type="button" className="feedPostActionBtn" aria-label="댓글" onClick={(e) => { e.stopPropagation(); onComment(); }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                  stroke="#262626"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button type="button" className="feedPostActionBtn" aria-label="공유" onClick={(e) => { e.stopPropagation(); onShare(); }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 4v12m0-12l-4 4m4-4l4 4M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"
                  stroke="#262626"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <p className="feedPostLikes">
          {post.likes_count > 0 ? (
            <>좋아요 <strong>{formatLikeCount(post.likes_count)}</strong>개</>
          ) : (
            <button type="button" className="feedPostLikesCta" onClick={handleLike}>
              좋아요 누르기
            </button>
          )}
        </p>

        {titleText && <p className="feedPostTitle">{titleText}</p>}

        {commentText && (
          <p className="feedPostCaption">
            <span className="feedPostCaptionUser">{post.user}</span>{" "}
            <span>{captionVisible}</span>
            {needsCaptionExpand && !captionExpanded && (
              <button
                type="button"
                className="feedPostCaptionMore"
                onClick={(e) => { e.stopPropagation(); setCaptionExpanded(true); }}
              >
                {" "}더 보기
              </button>
            )}
          </p>
        )}

        {otherPlacesHint && (
          <button
            type="button"
            className="feedPostOtherPlacesHint"
            onClick={(e) => {
              e.stopPropagation();
              onCardClick();
            }}
          >
            {otherPlacesHint}
          </button>
        )}

        {post.courseId && ensureCourseLoaded && onOpenLinkedCourse && (
          <FeedPostLinkedCourse
            courseId={post.courseId}
            currentUserId={currentUserId}
            ensureCourseLoaded={ensureCourseLoaded}
            onOpenCourse={onOpenLinkedCourse}
            onCourseUnavailable={onLinkedCourseUnavailable}
          />
        )}

        {(visibleCategories.length > 0 || companionLabel) && (
          <div className="feedPostTags" aria-label="카테고리 및 동행 태그">
            {visibleCategories.length > 0 && (
              <div className="feedPostCategoryBadges">
                {visibleCategories.map((cat) => {
                  const pin = categoryPin[cat as Category];
                  if (!pin) return null;
                  return (
                    <span key={cat} className="feedPostCategoryBadge">
                      {pin.emoji} {cat}
                    </span>
                  );
                })}
                {extraCategoryCount > 0 && (
                  <span className="feedPostCategoryBadge feedPostCategoryBadgeMore">
                    외 {extraCategoryCount}개
                  </span>
                )}
              </div>
            )}
            {companionLabel && (
              <p className="feedPostCompanionTag">{companionLabel}</p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export const FeedPostCard = memo(FeedPostCardComponent);
FeedPostCard.displayName = "FeedPostCard";
