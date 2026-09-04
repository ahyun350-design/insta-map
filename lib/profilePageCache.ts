/** 프로필 페이지 재마운트 시 로딩 깜빡임 방지용 캐시 (메모리 + sessionStorage) */

export type ProfilePageCacheUser = {
  id: string;
  username: string;
  avatar_url?: string | null;
  bio?: string | null;
  total_likes_received: number;
};

export type ProfilePageCachePost = {
  id: string;
  title: string;
  place_name: string;
  address: string;
  category: string;
  comment: string;
  images: string[];
  created_at: string;
  likes_count: number;
  liked_by_me: boolean;
  commentCount: number;
};

export type ProfilePageCacheEntry = {
  username: string;
  profile: ProfilePageCacheUser;
  posts: ProfilePageCachePost[];
  postCount: number;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  likedPostIds: string[];
  scrollTop: number;
  savedAt: number;
};

const STORAGE_PREFIX = "pindmap:profilePageCache:v1:";
const TTL_MS = 10 * 60 * 1000;

const memoryCache = new Map<string, ProfilePageCacheEntry>();

function storageKey(username: string): string {
  return `${STORAGE_PREFIX}${username}`;
}

function isFresh(entry: ProfilePageCacheEntry): boolean {
  return Date.now() - entry.savedAt < TTL_MS;
}

function readFromSession(username: string): ProfilePageCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfilePageCacheEntry;
    if (!parsed?.username || !parsed?.profile?.id || !Array.isArray(parsed.posts)) return null;
    if (!isFresh(parsed)) {
      window.sessionStorage.removeItem(storageKey(username));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeToSession(entry: ProfilePageCacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(entry.username), JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

export function readProfilePageCache(username: string): ProfilePageCacheEntry | null {
  const key = username.trim();
  if (!key) return null;

  const mem = memoryCache.get(key);
  if (mem && isFresh(mem)) return mem;
  if (mem) memoryCache.delete(key);

  const fromSession = readFromSession(key);
  if (fromSession) {
    memoryCache.set(key, fromSession);
    return fromSession;
  }
  return null;
}

export function writeProfilePageCache(
  entry: Omit<ProfilePageCacheEntry, "savedAt"> & { savedAt?: number },
): void {
  const key = entry.username.trim();
  if (!key || !entry.profile?.id) return;
  const full: ProfilePageCacheEntry = {
    ...entry,
    username: key,
    savedAt: entry.savedAt ?? Date.now(),
  };
  memoryCache.set(key, full);
  writeToSession(full);
}

export function updateProfilePageScroll(username: string, scrollTop: number): void {
  const key = username.trim();
  if (!key) return;
  const existing = readProfilePageCache(key);
  if (!existing) return;
  const next = { ...existing, scrollTop: Math.max(0, scrollTop), savedAt: Date.now() };
  memoryCache.set(key, next);
  writeToSession(next);
}
