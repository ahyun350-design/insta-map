"use client";

import type { CSSProperties, ReactNode } from "react";

type PostGridProps = {
  children: ReactNode;
  empty?: boolean;
  emptyMessage?: string;
  style?: CSSProperties;
};

export function PostGrid({ children, empty, emptyMessage = "아직 게시물이 없어요", style }: PostGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 2,
        alignContent: "start",
        background: "#fafafa",
        ...style,
      }}
    >
      {empty && (
        <p
          style={{
            gridColumn: "1 / -1",
            margin: 0,
            padding: "48px 24px",
            textAlign: "center",
            fontSize: 13,
            color: "#aaa",
          }}
        >
          {emptyMessage}
        </p>
      )}
      {children}
    </div>
  );
}
