"use client";

import { extractRegion } from "@/lib/extractRegion";

type PostGridCellProps = {
  imageUrl?: string;
  titleLine: string;
  placeName: string;
  address?: string;
  likeCount: number;
  onClick: () => void;
};

export function PostGridCell({
  imageUrl,
  titleLine,
  placeName,
  address,
  likeCount,
  onClick,
}: PostGridCellProps) {
  const thumb = imageUrl?.trim();
  const region = extractRegion(address);
  const displayPlace = (placeName || titleLine || "").trim() || "—";

  return (
    <button
      type="button"
      onClick={onClick}
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
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1",
          background: thumb ? "#eee" : "#e8eaf0",
          overflow: "hidden",
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
            {titleLine || "—"}
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
              textShadow: "0 1px 3px rgba(0,0,0,0.6)",
            }}
          >
            ♥ {likeCount}
          </span>
        )}
      </div>
      <div style={{ padding: "6px 4px 8px", minWidth: 0, background: "#fff" }}>
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
          {displayPlace}
        </p>
        {region ? (
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
