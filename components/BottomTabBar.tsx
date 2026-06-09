"use client";

import type { JSX, SVGProps } from "react";

export type BottomTabId = "home" | "messages" | "map" | "saved" | "mypage";

type TabDef = {
  id: BottomTabId;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => JSX.Element;
};

function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMessage(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H10l-4.5 3.5V16H7.5A2.5 2.5 0 0 1 5 13.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMapPin(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="2.25" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function IconBookmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5v16.2a.5.5 0 0 1-.78.4L12 17.5l-5.22 3.6a.5.5 0 0 1-.78-.4V4.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconUser(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M5.5 19.5c1.4-2.8 3.6-4.25 6.5-4.25s5.1 1.45 6.5 4.25"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

const TABS: TabDef[] = [
  { id: "home", label: "HOME", Icon: IconHome },
  { id: "messages", label: "MESSAGE", Icon: IconMessage },
  { id: "map", label: "MAP", Icon: IconMapPin },
  { id: "saved", label: "SAVED", Icon: IconBookmark },
  { id: "mypage", label: "MY", Icon: IconUser },
];

type Props = {
  activeTab: BottomTabId;
  onTabChange: (tab: BottomTabId) => void;
  /** 채팅방 등 — 즉시 숨김 (display:none) */
  hidden?: boolean;
  /** 키보드 표시 중 — 슬라이드 아웃 (V-2b) */
  keyboardHidden?: boolean;
  messageUnreadCount?: number;
};

export function BottomTabBar({
  activeTab,
  onTabChange,
  hidden = false,
  keyboardHidden = false,
  messageUnreadCount = 0,
}: Props) {
  const showMessageBadge = messageUnreadCount > 0;

  return (
    <nav
      className={`tabBar${hidden ? " tabBarHidden" : ""}${keyboardHidden && !hidden ? " tabBarKeyboardHidden" : ""}`}
      aria-hidden={hidden || keyboardHidden ? true : undefined}
    >
      <div className="tabBarPill" role="tablist" aria-label="Main navigation">
        {TABS.map((tab) => {
          const selected = activeTab === tab.id;
          const showBadge = tab.id === "messages" && showMessageBadge;
          const { Icon } = tab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? "tabItem tabItemActive" : "tabItem"}
              onClick={() => onTabChange(tab.id)}
            >
              <span className="tabIconWrap">
                <Icon className="tabIconSvg" aria-hidden />
                {showBadge && (
                  <span
                    className="tabBadgeDot"
                    aria-label={`${messageUnreadCount} unread messages`}
                  />
                )}
              </span>
              <span className="tabLabel">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
