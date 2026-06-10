"use client";

import type { CSSProperties, ReactNode } from "react";

type PostGridProps = {
  children: ReactNode;
  columns?: number;
  gap?: number;
  empty?: boolean;
  emptyMessage?: string;
  className?: string;
  style?: CSSProperties;
};

export function PostGrid({
  children,
  columns = 3,
  gap,
  empty,
  emptyMessage = "아직 게시물이 없어요",
  className,
  style,
}: PostGridProps) {
  const resolvedGap = gap ?? (columns === 2 ? 10 : 2);

  return (
    <div
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: resolvedGap,
        alignContent: "start",
        background: "#fff",
        width: "100%",
        boxSizing: "border-box",
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
