"use client";

import { extractRegion } from "@/lib/extractRegion";

type PostGridCellProps = {
  imageUrl?: string;
  titleLine: string;
  placeName: string;
  address?: string;
  likeCount: number;
  onClick: () => void;
  variant?: "default" | "home";
  username?: string;
  showUsername?: boolean;
  imageCount?: number;
  showMultiIcon?: boolean;
  onProfileClick?: () => void;
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
  likeCount,
  onClick,
  variant = "default",
  username,
  showUsername = false,
  imageCount = 1,
  showMultiIcon = false,
  onProfileClick,
}: PostGridCellProps) {
  const isHome = variant === "home";
  const thumb = imageUrl?.trim();
  const region = extractRegion(address);
  const primaryLabel = (titleLine.trim() || placeName.trim() || "").trim() || "—";
  const multi = showMultiIcon && imageCount > 1;

  return (
    <button
      type="button"
      onClick={onClick}
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onProfileClick?.();
            }}
            style={{
              display: "block",
              width: "100%",
              margin: "0 0 4px",
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
              cursor: onProfileClick ? "pointer" : "default",
              fontFamily: "inherit",
            }}
          >
            {username}
          </button>
        ) : null}
        {isHome ? (
          <p className="postGridCellHomeTitle">{primaryLabel}</p>
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
