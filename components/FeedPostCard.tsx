"use client";

import { useCallback, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { companionTagDisplayLabel, isCompanionTag, type CompanionTag } from "@/lib/companionTag";
import type { PhotoPlaceTag } from "@/lib/feedPost";
import { FeedPostLinkedCourse } from "@/components/FeedPostLinkedCourse";
import { getDisplayPlaceForPhoto, type PlaceRefForPhotoTagMatch } from "@/lib/photoPlaceTag";
import type { SavedCourse } from "@/lib/courses";

type Category = "맛집" | "카페" | "쇼핑" | "숙소" | "놀거리" | "여행지";

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
  comment: string;
  photoPlaceTags?: PhotoPlaceTag[] | null;
  images: string[];
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
};

const CAPTION_PREVIEW_LEN = 100;

function formatLikeCount(n: number): string {
  return n.toLocaleString("ko-KR");
}

const SWIPE_MOVE_PX = 10;
const SWIPE_SCROLL_PX = 2;

function FeedPostMedia({
  images,
  placeSource,
  onMediaClick,
  onPlaceOverlayClick,
}: {
  images: string[];
  placeSource: Pick<
    FeedPostCardData,
    "placeName" | "address" | "category" | "lat" | "lng" | "photoPlaceTags"
  >;
  onMediaClick: () => void;
  onPlaceOverlayClick?: (placeRef: PlaceRefForPhotoTagMatch) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const multi = images.length > 1;
  const pointerStartRef = useRef<{ x: number; y: number; scrollLeft: number } | null>(null);
  const suppressTapRef = useRef(false);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    setActiveIndex(Math.round(el.scrollLeft / el.clientWidth));
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
      if (suppressTapRef.current) {
        suppressTapRef.current = false;
        return;
      }
      e.stopPropagation();
      onMediaClick();
    },
    [onMediaClick],
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
      <div className="feedPostMediaPlaceholder" aria-hidden>
        <span className="feedPostMediaPlaceholderIcon">📷</span>
        <span className="feedPostMediaPlaceholderText">사진 없음</span>
      </div>
    );
  }

  return (
    <div className="feedPostMedia">
      <div
        ref={scrollRef}
        className="feedPostMediaTrack"
        role="button"
        tabIndex={0}
        aria-label="게시물 상세 보기"
        onScroll={onScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onClick={handleMediaClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onMediaClick();
          }
        }}
      >
        {images.map((src, i) => (
          <div key={`${src}-${i}`} className="feedPostMediaSlide">
            <img src={src} alt="" className="feedPostMediaImg" draggable={false} />
          </div>
        ))}
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

export function FeedPostCard({
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
}: Props) {
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [likePop, setLikePop] = useState(false);
  const isOwn = post.user === myUsername;
  const showFollow = !isOwn && !!post.userId;
  const titleText = post.title?.trim();
  const commentText = post.comment?.trim() ?? "";
  const needsCaptionExpand = commentText.length > CAPTION_PREVIEW_LEN;
  const captionVisible =
    captionExpanded || !needsCaptionExpand
      ? commentText
      : `${commentText.slice(0, CAPTION_PREVIEW_LEN).trimEnd()}…`;
  const categoryLabel = `${categoryPin[post.category].emoji} ${post.category}`;
  const companionLabel =
    post.companionTag && isCompanionTag(post.companionTag)
      ? companionTagDisplayLabel(post.companionTag)
      : null;

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLikePop(true);
    window.setTimeout(() => setLikePop(false), 320);
    onToggleLike();
  };

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
        images={post.images}
        placeSource={post}
        onMediaClick={onCardClick}
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

        {post.courseId && ensureCourseLoaded && onOpenLinkedCourse && (
          <FeedPostLinkedCourse
            courseId={post.courseId}
            currentUserId={currentUserId}
            ensureCourseLoaded={ensureCourseLoaded}
            onOpenCourse={onOpenLinkedCourse}
            onCourseUnavailable={onLinkedCourseUnavailable}
          />
        )}

        {(categoryLabel || companionLabel) && (
          <p className="feedPostTags" aria-label="카테고리 및 동행 태그">
            {categoryLabel}
            {companionLabel && (
              <>
                <span className="feedPostTagsSep" aria-hidden> · </span>
                {companionLabel}
              </>
            )}
          </p>
        )}
      </div>
    </article>
  );
}
