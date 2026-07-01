"use client";

import { extractRegion } from "@/lib/extractRegion";

type PostGridCellProps = {
  imageUrl?: string;
  titleLine: string;
  placeName: string;
  address?: string;
  category?: string;
  likeCount: number;
  onClick: () => void;
  variant?: "default" | "home";
  /** 홈 메인 피드 dooo0t craft 스타일 (검색 오버레이 등은 false) */
  craftStyled?: boolean;
  username?: string;
  showUsername?: boolean;
  imageCount?: number;
  showMultiIcon?: boolean;
  onProfileClick?: () => void;
};

const CATEGORY_EMOJI: Record<string, string> = {
  맛집: "🍽️",
  카페: "☕",
  쇼핑: "🛍️",
  숙소: "🏠",
  놀거리: "🎮",
  여행지: "🗺️",
};

const CRAFT_CAT_BG: Record<string, string> = {
  카페: "var(--craft-cat-cafe)",
  맛집: "var(--craft-cat-food)",
  쇼핑: "var(--craft-cat-shopping)",
  숙소: "var(--craft-cat-stay)",
  놀거리: "var(--craft-cat-play)",
  여행지: "var(--craft-cat-travel)",
};

function MultiImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M9 5V3.5A1.5 1.5 0 0 1 10.5 2h11A1.5 1.5 0 0 1 23 3.5v11a1.5 1.5 0 0 1-1.5 1.5H20" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export function PostGridCell({
  imageUrl,
  titleLine,
  placeName,
  address,
  category,
  likeCount,
  onClick,
  variant = "default",
  craftStyled = false,
  username,
  showUsername = false,
  imageCount = 1,
  showMultiIcon = false,
  onProfileClick,
}: PostGridCellProps) {
  const isHome = variant === "home";
  const isCraft = isHome && craftStyled;
  const thumb = imageUrl?.trim();
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

  const homePlaceChipText = (() => {
    if (!homePlaceLine) return null;
    const emoji = (category && CATEGORY_EMOJI[category]) || "📍";
    return `${emoji} ${homePlaceLine}`;
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

  const craftChipBg =
    (category && CRAFT_CAT_BG[category]) || "var(--craft-sky)";

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        isCraft
          ? "postGridCell postGridCellHome postGridCellHomeCraft"
          : isHome
            ? "postGridCell postGridCellHome"
            : "postGridCell"
      }
      style={{
        display: "flex",
        flexDirection: "column",
        padding: 0,
        border: "none",
        cursor: "pointer",
        overflow: "hidden",
        background: isCraft ? "transparent" : "#fff",
        fontFamily: "inherit",
        textAlign: "left",
        width: "100%",
        minWidth: 0,
      }}
    >
      <div
        className={isCraft ? "postGridCellHomeThumb" : undefined}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1",
          background: thumb ? (isCraft ? "var(--craft-cream)" : "#eee") : isCraft ? "var(--craft-cream)" : "#e8eaf0",
          overflow: "hidden",
          borderRadius: isCraft ? 15 : isHome ? 10 : 0,
        }}
      >
        {thumb ? (
          <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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
              color: isCraft ? "var(--craft-ink)" : "#666",
              textAlign: "center",
              lineHeight: 1.35,
              overflow: "hidden",
            }}
          >
            {primaryLabel}
          </span>
        )}
        {isCraft && homePlaceChipText ? (
          <span
            className="postGridCellHomePlaceChip"
            style={{ background: craftChipBg }}
          >
            {homePlaceChipText}
          </span>
        ) : null}
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
        className={isCraft ? "postGridCellHomeBody" : undefined}
        style={{
          padding: isHome ? "8px 2px 10px" : "6px 4px 8px",
          minWidth: 0,
          background: isCraft ? "transparent" : "#fff",
        }}
      >
        {isHome && showUsername && username ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onProfileClick?.();
            }}
            className={isCraft ? "postGridCellHomeUsername" : undefined}
            style={{
              display: "block",
              width: "100%",
              margin: !isCraft && homePlaceLine ? "0 0 2px" : isCraft ? "0 0 3px" : "0 0 4px",
              padding: 0,
              border: "none",
              background: "transparent",
              fontSize: 11,
              color: isCraft ? "#8b90a3" : "#8b90a3",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.3,
              textAlign: "left",
              cursor: onProfileClick ? "pointer" : "default",
              fontFamily: "inherit",
            }}
          >
            {username}
          </button>
        ) : null}
        {isHome ? (
          <>
            {!isCraft && homePlaceLine ? <p style={homeMetaLineStyle}>{homePlaceLine}</p> : null}
            <p className={isCraft ? "postGridCellHomeTitle postGridCellHomeTitleCraft" : "postGridCellHomeTitle"}>
              {primaryLabel}
            </p>
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
