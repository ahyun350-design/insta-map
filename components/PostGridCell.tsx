"use client";

type PostGridCellProps = {
  imageUrl?: string;
  titleLine: string;
  likeCount: number;
  onClick: () => void;
};

export function PostGridCell({ imageUrl, titleLine, likeCount, onClick }: PostGridCellProps) {
  const thumb = imageUrl?.trim();

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        aspectRatio: "1",
        padding: 0,
        border: "none",
        cursor: "pointer",
        overflow: "hidden",
        background: thumb ? "#eee" : "#e8eaf0",
        fontFamily: "inherit",
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
            left: 6,
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
    </button>
  );
}
