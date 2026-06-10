"use client";

import { useEffect, useState } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import type { InAppNotificationType } from "@/lib/inAppNotification";

const AUTO_DISMISS_MS = 3500;
const EXIT_MS = 280;

const TYPE_ICONS: Record<InAppNotificationType, string> = {
  message: "💬",
  like: "❤️",
  comment: "💭",
  follow: "👤",
};

type Props = {
  type: InAppNotificationType;
  actorName: string;
  actorAvatarUrl?: string;
  text: string;
  onClick: () => void;
  onDismiss: () => void;
};

export function InAppNotificationToast({
  type,
  actorName,
  actorAvatarUrl,
  text,
  onClick,
  onDismiss,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const enterRaf = window.requestAnimationFrame(() => setVisible(true));
    const dismissTimer = window.setTimeout(() => setExiting(true), AUTO_DISMISS_MS);
    return () => {
      window.cancelAnimationFrame(enterRaf);
      window.clearTimeout(dismissTimer);
    };
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const exitTimer = window.setTimeout(() => onDismiss(), EXIT_MS);
    return () => window.clearTimeout(exitTimer);
  }, [exiting, onDismiss]);

  const handleActivate = () => {
    if (exiting) return;
    setExiting(true);
    onClick();
    window.setTimeout(() => onDismiss(), EXIT_MS);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate();
        }
      }}
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 8px)",
        left: "max(12px, env(safe-area-inset-left, 0px))",
        right: "max(12px, env(safe-area-inset-right, 0px))",
        zIndex: 999998,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 12px",
        borderRadius: "12px",
        background: "#fff",
        boxShadow: "0 4px 24px rgba(0, 0, 0, 0.14)",
        border: "0.5px solid rgba(0, 0, 0, 0.06)",
        cursor: "pointer",
        pointerEvents: "auto",
        transform: visible && !exiting ? "translateY(0)" : "translateY(-120%)",
        opacity: visible && !exiting ? 1 : 0,
        transition: "transform 0.28s ease, opacity 0.28s ease",
        fontFamily: "inherit",
      }}
    >
      <ProfileAvatar avatarUrl={actorAvatarUrl} username={actorName} size={32} fontSize={13} />
      <span style={{ fontSize: "16px", lineHeight: 1, flexShrink: 0 }} aria-hidden>
        {TYPE_ICONS[type]}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "13px",
          lineHeight: 1.4,
          color: "#1a1a2e",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </div>
  );
}
