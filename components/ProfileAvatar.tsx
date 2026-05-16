"use client";

import { useState } from "react";

type ProfileAvatarProps = {
  avatarUrl?: string | null;
  username: string;
  size: number;
  fontSize?: number;
  className?: string;
  style?: React.CSSProperties;
};

export function ProfileAvatar({
  avatarUrl,
  username,
  size,
  fontSize,
  className,
  style,
}: ProfileAvatarProps) {
  const [broken, setBroken] = useState(false);
  const initial = (username || "?").slice(0, 1).toUpperCase();
  const resolvedSize = fontSize ?? Math.round(size * 0.4);
  const showImage = Boolean(avatarUrl?.trim()) && !broken;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        background: "#1a2a7a",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Playfair Display', serif",
        fontSize: resolvedSize,
        ...style,
      }}
    >
      {showImage ? (
        <img
          src={avatarUrl!}
          alt=""
          onError={() => setBroken(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        initial
      )}
    </div>
  );
}
