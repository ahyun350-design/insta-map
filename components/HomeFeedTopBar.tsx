"use client";

import { HomeFeedSearchBar } from "@/components/HomeFeedSearchBar";

type Props = {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onOpenSearch?: () => void;
  unreadNotificationCount: number;
  onNotificationsClick: () => void;
  onAddClick: () => void;
};

export function HomeFeedTopBar({
  searchQuery,
  onSearchChange,
  onOpenSearch,
  unreadNotificationCount,
  onNotificationsClick,
  onAddClick,
}: Props) {
  return (
    <>
      <p className="homeFeedBrand pixel-font" aria-hidden>
        pin<span className="homeFeedBrandAccent">d</span>map
      </p>
      <div className="homeFeedToolbar">
      <HomeFeedSearchBar
        value={searchQuery}
        onChange={onSearchChange}
        variant="inline"
        triggerOnly
        onOpenSearch={onOpenSearch}
      />
      <button
        type="button"
        className="homeFeedToolbarBtn homeFeedToolbarBtnNotify"
        onClick={onNotificationsClick}
        aria-label="알림"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M13.73 21a2 2 0 0 1-3.46 0"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unreadNotificationCount > 0 && (
          <span className="homeFeedToolbarNotifyDot" aria-hidden>
            {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
          </span>
        )}
      </button>
      <button
        type="button"
        className="homeFeedToolbarBtn homeFeedToolbarBtnAdd"
        onClick={onAddClick}
        aria-label="새 큐레이션"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
    </>
  );
}
