/**
 * 홈 세션 스냅샷 — 프로필 라우트 왕복 시 피드/스크롤/탭 즉시 복원.
 * sessionStorage only (앱 종료 시 소멸). Preferences/homeBootstrapCache 와 무관.
 */

import type { CompanionTagFilter } from "@/lib/companionTag";
import { isCompanionTag } from "@/lib/companionTag";
import type { HomeCategoryFilter } from "@/components/HomeCategoryFilterChips";
import type { FeedPost } from "@/lib/feedPost";
import { FEED_POST_CATEGORIES } from "@/lib/feedPost";

export type HomeSessionTabId = "home" | "messages" | "map" | "saved" | "mypage";

export type HomeSessionSnapshot = {
  userId: string;
  savedAt: number;
  feedPosts: FeedPost[];
  feedNextOffset: number;
  feedHasMore: boolean;
  feedScrollTop: number;
  selectedCompanionTag: CompanionTagFilter;
  selectedHomeCategory: HomeCategoryFilter;
  activeTab: HomeSessionTabId;
};

const KEY_PREFIX = "pindmap_home_session_";
const ACTIVE_UID_KEY = "pindmap_home_session_active_uid";
const TTL_MS = 10 * 60 * 1000;
const MAX_FEED_POSTS = 100;

const TAB_IDS: ReadonlySet<string> = new Set([
  "home",
  "messages",
  "map",
  "saved",
  "mypage",
]);

export function homeSessionStorageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function isCompanionFilter(v: unknown): v is CompanionTagFilter {
  return v === "all" || isCompanionTag(v);
}

function isHomeCategoryFilter(v: unknown): v is HomeCategoryFilter {
  return v === "all" || (FEED_POST_CATEGORIES as readonly string[]).includes(v as string);
}

function parseSnapshot(raw: unknown, expectUserId?: string): HomeSessionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.userId !== "string" || !o.userId) return null;
  if (expectUserId && o.userId !== expectUserId) return null;
  if (typeof o.savedAt !== "number" || !Number.isFinite(o.savedAt)) return null;
  if (Date.now() - o.savedAt > TTL_MS) return null;
  if (!Array.isArray(o.feedPosts)) return null;
  if (typeof o.feedNextOffset !== "number" || !Number.isFinite(o.feedNextOffset)) return null;
  if (typeof o.feedHasMore !== "boolean") return null;
  if (typeof o.feedScrollTop !== "number" || !Number.isFinite(o.feedScrollTop)) return null;
  if (!isCompanionFilter(o.selectedCompanionTag)) return null;
  if (!isHomeCategoryFilter(o.selectedHomeCategory)) return null;
  if (typeof o.activeTab !== "string" || !TAB_IDS.has(o.activeTab)) return null;

  return {
    userId: o.userId,
    savedAt: o.savedAt,
    feedPosts: o.feedPosts as FeedPost[],
    feedNextOffset: Math.max(0, Math.floor(o.feedNextOffset)),
    feedHasMore: o.feedHasMore,
    feedScrollTop: Math.max(0, o.feedScrollTop),
    selectedCompanionTag: o.selectedCompanionTag,
    selectedHomeCategory: o.selectedHomeCategory,
    activeTab: o.activeTab as HomeSessionTabId,
  };
}

/** 마운트 초기값용 — sessionStorage 의 active uid 키로 읽음 */
export function readHomeSessionSnapshotForBoot(): HomeSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const uid = window.sessionStorage.getItem(ACTIVE_UID_KEY);
    if (!uid) return null;
    return readHomeSessionSnapshot(uid);
  } catch {
    return null;
  }
}

export function readHomeSessionSnapshot(userId: string): HomeSessionSnapshot | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = window.sessionStorage.getItem(homeSessionStorageKey(userId));
    if (!raw) return null;
    const parsed = parseSnapshot(JSON.parse(raw), userId);
    if (!parsed) {
      window.sessionStorage.removeItem(homeSessionStorageKey(userId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export type HomeSessionSnapshotInput = {
  userId: string;
  feedPosts: FeedPost[];
  feedNextOffset: number;
  feedHasMore: boolean;
  feedScrollTop: number;
  selectedCompanionTag: CompanionTagFilter;
  selectedHomeCategory: HomeCategoryFilter;
  activeTab: HomeSessionTabId;
};

export function saveHomeSessionSnapshot(input: HomeSessionSnapshotInput): void {
  if (typeof window === "undefined" || !input.userId) return;
  try {
    const feedPosts =
      input.feedPosts.length > MAX_FEED_POSTS
        ? input.feedPosts.slice(0, MAX_FEED_POSTS)
        : input.feedPosts;
    const payload: HomeSessionSnapshot = {
      userId: input.userId,
      savedAt: Date.now(),
      feedPosts,
      feedNextOffset: Math.max(0, Math.floor(input.feedNextOffset)),
      feedHasMore: input.feedHasMore,
      feedScrollTop: Math.max(0, input.feedScrollTop),
      selectedCompanionTag: input.selectedCompanionTag,
      selectedHomeCategory: input.selectedHomeCategory,
      activeTab: input.activeTab,
    };
    window.sessionStorage.setItem(homeSessionStorageKey(input.userId), JSON.stringify(payload));
    window.sessionStorage.setItem(ACTIVE_UID_KEY, input.userId);
  } catch {
    /* quota / private mode — ignore */
  }
}

export function clearHomeSessionSnapshot(userId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (userId) {
      window.sessionStorage.removeItem(homeSessionStorageKey(userId));
      const active = window.sessionStorage.getItem(ACTIVE_UID_KEY);
      if (active === userId) window.sessionStorage.removeItem(ACTIVE_UID_KEY);
      return;
    }
    const active = window.sessionStorage.getItem(ACTIVE_UID_KEY);
    if (active) window.sessionStorage.removeItem(homeSessionStorageKey(active));
    window.sessionStorage.removeItem(ACTIVE_UID_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * silent merge: 1페이지 결과로 기존 스냅샷 피드를 갱신.
 * - 같은 id → 내용 갱신
 * - 응답에만 있는 id → 배열 앞쪽에 추가
 * - 기존에만 있는 항목 → 유지
 */
export function mergeFeedPageIntoSnapshot(
  existing: FeedPost[],
  page1: FeedPost[],
): FeedPost[] {
  if (page1.length === 0) return existing;
  const existingById = new Map(existing.map((p) => [p.id, p]));
  const pageIds = new Set(page1.map((p) => p.id));

  const prepend = page1.filter((p) => !existingById.has(p.id));
  const mergedExisting = existing.map((p) => {
    if (!pageIds.has(p.id)) return p;
    const fresh = page1.find((n) => n.id === p.id);
    return fresh ? { ...p, ...fresh } : p;
  });

  return [...prepend, ...mergedExisting];
}
