import { supabase } from "./supabase";

export function normalizeAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type UserAvatarRow = {
  id: string;
  username: string;
  avatar_url?: unknown;
};

/** 세션 내 user id / username → avatar_url 메모이제이션 */
export class UserAvatarCache {
  private byId = new Map<string, string | undefined>();
  private byUsername = new Map<string, string | undefined>();

  setFromRow(row: UserAvatarRow) {
    const url = normalizeAvatarUrl(row.avatar_url);
    this.byId.set(row.id, url);
    if (row.username) {
      this.byUsername.set(row.username.toLowerCase(), url);
    }
  }

  setByUserId(id: string, avatarUrl: string | undefined) {
    this.byId.set(id, avatarUrl);
  }

  getByUserId(id: string | undefined | null): string | undefined {
    if (!id) return undefined;
    return this.byId.get(id);
  }

  getByUsername(username: string | undefined | null): string | undefined {
    if (!username) return undefined;
    return this.byUsername.get(username.toLowerCase());
  }

  resolve(id?: string | null, username?: string | null): string | undefined {
    if (id) {
      const byId = this.byId.get(id);
      if (byId !== undefined) return byId;
    }
    if (username) return this.getByUsername(username);
    return undefined;
  }

  async prefetchByIds(ids: string[]): Promise<void> {
    const missing = [...new Set(ids.filter(Boolean))].filter((id) => !this.byId.has(id));
    if (missing.length === 0) return;

    const { data, error } = await supabase
      .from("users")
      .select("id, username, avatar_url")
      .in("id", missing);

    if (error) {
      console.warn("[PindMap:avatar] prefetchByIds failed", error);
      missing.forEach((id) => this.byId.set(id, undefined));
      return;
    }

    const found = new Set<string>();
    (data ?? []).forEach((row) => {
      found.add(row.id);
      this.setFromRow(row as UserAvatarRow);
    });
    missing.forEach((id) => {
      if (!found.has(id)) this.byId.set(id, undefined);
    });
  }

  async prefetchByUsernames(usernames: string[]): Promise<void> {
    const missing = [...new Set(usernames.filter(Boolean))].filter(
      (name) => !this.byUsername.has(name.toLowerCase()),
    );
    if (missing.length === 0) return;

    const { data, error } = await supabase
      .from("users")
      .select("id, username, avatar_url")
      .in("username", missing);

    if (error) {
      console.warn("[PindMap:avatar] prefetchByUsernames failed", error);
      missing.forEach((name) => this.byUsername.set(name.toLowerCase(), undefined));
      return;
    }

    const found = new Set<string>();
    (data ?? []).forEach((row) => {
      found.add(row.username.toLowerCase());
      this.setFromRow(row as UserAvatarRow);
    });
    missing.forEach((name) => {
      if (!found.has(name.toLowerCase())) this.byUsername.set(name.toLowerCase(), undefined);
    });
  }
}

export function collectFeedPostAvatarKeys(posts: {
  userId?: string;
  user?: string;
  comments?: { userId?: string; user?: string }[];
}[]): { userIds: string[]; usernames: string[] } {
  const userIds = new Set<string>();
  const usernames = new Set<string>();
  for (const post of posts) {
    if (post.userId) userIds.add(post.userId);
    else if (post.user) usernames.add(post.user);
    for (const c of post.comments ?? []) {
      if (c.userId) userIds.add(c.userId);
      else if (c.user) usernames.add(c.user);
    }
  }
  return { userIds: [...userIds], usernames: [...usernames] };
}
