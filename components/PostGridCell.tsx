"use client";

import { memo, useEffect, useState } from "react";
import { extractRegion } from "@/lib/extractRegion";
import { derivePostImageThumbUrl } from "@/lib/postImageThumb";

type PostGridCellProps = {
  imageUrl?: string;
  titleLine: string;
  placeName: string;
  address?: string;
  likeCount: number;
  /** 안정된 부모 핸들러 — 셀이 자기 postId(+원본 이미지 인덱스)로 호출 */
  postId?: string;
  onSelect?: (postId: string, originalImageIndex?: number) => void;
  /** 상세 진입용 원본 images 인덱스 (기본 0) */
  originalImageIndex?: number;
  /** 안정된 프로필 핸들러 — username으로 호출 */
  onSelectProfile?: (username: string) => void;
  /** 레거시: postId/onSelect 없을 때 (매 렌더 새 함수면 memo 무효) */
  onClick?: () => void;
  variant?: "default" | "home";
  username?: string;
  showUsername?: boolean;
  imageCount?: number;
  showMultiIcon?: boolean;
  onProfileClick?: () => void;
  /** 홈 카테고리 필터 활성 시 표시할 단일 카테고리 라벨 (예: "☕ 카페") */
  categoryBadge?: string | null;
  /** 필터로 가려진 다른 장소 안내 (탭 = 카드와 동일하게 상세) */
  otherPlacesHint?: string | null;
};

function MultiImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M9 5V3.5A1.5 1.5 0 0 1 10.5 2h11A1.5 1.5 0 0 1 23 3.5v11a1.5 1.5 0 0 1-1.5 1.5H20" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function PostGridCellComponent({
  imageUrl,
  titleLine,
  placeName,
  address,
  likeCount,
  postId,
  onSelect,
  originalImageIndex = 0,
  onSelectProfile,
  onClick,
  variant = "default",
  username,
  showUsername = false,
  imageCount = 1,
  showMultiIcon = false,
  onProfileClick,
  categoryBadge = null,
  otherPlacesHint = null,
}: PostGridCellProps) {
  const isHome = variant === "home";
  const fullUrl = imageUrl?.trim() || "";
  const thumbUrl = fullUrl ? derivePostImageThumbUrl(fullUrl) : "";
  /** Thumb request failed for *this* fullUrl → show original. Reset when imageUrl changes. */
  const [thumbFailed, setThumbFailed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setThumbFailed(false);
    setImgFailed(false);
  }, [fullUrl]);
  // Prefer thumb; never keep a sticky displaySrc that stale onError can overwrite after chip change.
  const displaySrc = imgFailed ? "" : thumbFailed || !thumbUrl ? fullUrl : thumbUrl;
  const thumb = displaySrc;
  const region = extractRegion(address);
  const trimmedPlaceName = placeName.trim();
  const primaryLabel = (titleLine.trim() || trimmedPlaceName || "").trim() || "—";
  const multi = showMultiIcon && imageCount > 1;

  const homePlaceLine = (() => {
    if (!isHome) return null;
    const titleMatchesPlace =
      primaryLabel !== "—" && !!trimmedPlaceName && primaryLabel === trimmedPlaceName;
    if (titleMatchesPlace) {
      return region || null;
    }
    if (region && trimmedPlaceName) {
      return `${region} · ${trimmedPlaceName}`;
    }
    return region || trimmedPlaceName || null;
  })();

  const homeMetaLineStyle = {
    margin: "0 0 2px",
    fontSize: 11,
    color: "#9a9fad",
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
    lineHeight: 1.3,
  };

  const handleClick = () => {
    if (postId && onSelect) onSelect(postId, originalImageIndex);
    else onClick?.();
  };

  const handleProfileActivate = () => {
    if (username && onSelectProfile) onSelectProfile(username);
    else onProfileClick?.();
  };

  const profileInteractive = !!(onSelectProfile || onProfileClick);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={isHome ? "postGridCell postGridCellHome" : "postGridCell"}
      style={{
        display: "flex",
        flexDirection: "column",
        padding: 0,
        border: "none",
        cursor: "pointer",
        overflow: "hidden",
        background: "#fff",
        fontFamily: "inherit",
        textAlign: "left",
        width: "100%",
        minWidth: 0,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1",
          background: thumb ? "#eee" : "#e8eaf0",
          overflow: "hidden",
          borderRadius: isHome ? 10 : 0,
        }}
      >
        {thumb ? (
          <img
            key={fullUrl}
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => {
              // No HEAD: thumb miss → original once. key={fullUrl} drops stale errors from prior chip.
              if (!thumbFailed && thumbUrl && thumbUrl !== fullUrl) {
                setThumbFailed(true);
                return;
              }
              setImgFailed(true);
            }}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              padding: 8,
              fontSize: 11,
              color: "#666",
              textAlign: "center",
              lineHeight: 1.35,
              overflow: "hidden",
            }}
          >
            {primaryLabel}
          </span>
        )}
        {multi && (
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "rgba(0, 0, 0, 0.45)",
              color: "#fff",
            }}
          >
            <MultiImageIcon />
          </span>
        )}
        {categoryBadge ? (
          <span
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              maxWidth: "70%",
              padding: "3px 8px",
              borderRadius: 999,
              background: "rgba(26, 42, 122, 0.88)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 600,
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {categoryBadge}
          </span>
        ) : null}
        {likeCount > 0 && (
          <span
            style={{
              position: "absolute",
              right: 6,
              bottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 3,
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              textShadow: "0 1px 3px rgba(0, 0, 0, 0.6)",
            }}
          >
            ♥ {likeCount}
          </span>
        )}
      </div>
      <div
        style={{
          padding: isHome ? "8px 2px 10px" : "6px 4px 8px",
          minWidth: 0,
          background: "#fff",
        }}
      >
        {isHome && showUsername && username ? (
          <span
            role="button"
            tabIndex={0}
            data-testid="feed-post-author"
            onClick={(e) => {
              e.stopPropagation();
              handleProfileActivate();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              handleProfileActivate();
            }}
            style={{
              display: "block",
              width: "100%",
              margin: homePlaceLine ? "0 0 2px" : "0 0 4px",
              padding: 0,
              border: "none",
              background: "transparent",
              fontSize: 11,
              color: "#8b90a3",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.3,
              textAlign: "left",
              cursor: profileInteractive ? "pointer" : "default",
              fontFamily: "inherit",
            }}
          >
            {username}
          </span>
        ) : null}
        {isHome ? (
          <>
            {homePlaceLine ? <p style={homeMetaLineStyle}>{homePlaceLine}</p> : null}
            <p className="postGridCellHomeTitle">{primaryLabel}</p>
            {otherPlacesHint ? (
              <p
                className="postGridCellOtherPlacesHint"
                style={{
                  margin: "4px 0 0",
                  fontSize: 10,
                  color: "#6b7288",
                  lineHeight: 1.35,
                }}
              >
                {otherPlacesHint}
              </p>
            ) : null}
          </>
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "#1c1c1e",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.3,
            }}
          >
            {primaryLabel}
          </p>
        )}
        {!isHome && region ? (
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 11,
              color: "#8b90a3",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.3,
            }}
          >
            {region}
          </p>
        ) : null}
      </div>
    </button>
  );
}

export const PostGridCell = memo(PostGridCellComponent);
PostGridCell.displayName = "PostGridCell";
