"use client";

import type { MouseEvent } from "react";
import type { PhotoPlaceTag } from "@/lib/feedPost";

type Props = {
  tag: PhotoPlaceTag;
  onMarkerClick: (e: MouseEvent) => void;
};

export function PhotoTagMarker({ tag, onMarkerClick }: Props) {
  const labelOnLeft = tag.x > 0.62;

  return (
    <div
      style={{
        position: "absolute",
        left: `${tag.x * 100}%`,
        top: `${tag.y * 100}%`,
        transform: "translate(-50%, -50%)",
        zIndex: 2,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        pointerEvents: "none",
        maxWidth: "92%",
      }}
    >
      {labelOnLeft && (
        <span
          style={{
            pointerEvents: "auto",
            background: "rgba(255,255,255,0.96)",
            color: "#111",
            fontSize: 11,
            fontWeight: 600,
            padding: "4px 8px",
            borderRadius: 6,
            boxShadow: "0 1px 6px rgba(0,0,0,0.18)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 140,
          }}
          onClick={onMarkerClick}
        >
          {tag.placeName}
        </span>
      )}
      <button
        type="button"
        aria-label={`${tag.placeName} 장소 태그`}
        onClick={onMarkerClick}
        style={{
          pointerEvents: "auto",
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: "2px solid #262626",
          background: "#fff",
          padding: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#1a2a7a",
            display: "block",
          }}
        />
      </button>
      {!labelOnLeft && (
        <span
          style={{
            pointerEvents: "auto",
            background: "rgba(255,255,255,0.96)",
            color: "#111",
            fontSize: 11,
            fontWeight: 600,
            padding: "4px 8px",
            borderRadius: 6,
            boxShadow: "0 1px 6px rgba(0,0,0,0.18)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 140,
          }}
          onClick={onMarkerClick}
        >
          {tag.placeName}
        </span>
      )}
    </div>
  );
}
