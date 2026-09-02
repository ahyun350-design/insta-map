import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawPlace } from "@/app/api/extract/_shared";

export const REEL_CACHE_TTL_DAYS = 30;

/**
 * 캐시 키용 URL 정규화.
 * - 쿼리·해시·트래킹 제거
 * - host 소문자, trailing slash
 * - shortcode는 대소문자 유지 (IG shortcode는 case-sensitive)
 * - /p|reel|tv/ 동일 shortcode → 같은 미디어이므로 /p/{code}/ 로 통일
 */
export function normalizeReelCacheUrl(url: string): string | null {
  const trimmed = url.trim();
  const m = trimmed.match(
    /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([^/?#]+)\/?/i,
  );
  if (!m?.[1]) return null;
  const code = m[1];
  if (!code) return null;
  return `https://www.instagram.com/p/${code}/`;
}

export type ReelCacheRow = {
  instagram_url: string;
  caption: string | null;
  claude_places: RawPlace[] | null;
  created_at: string;
};

function cacheFreshCutoffIso(now = new Date()): string {
  return new Date(now.getTime() - REEL_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** 30일 이내 캐시만 반환. 실패 시 null (extract는 계속 진행). */
export async function readReelCache(
  admin: SupabaseClient,
  rawUrl: string,
): Promise<ReelCacheRow | null> {
  const key = normalizeReelCacheUrl(rawUrl);
  if (!key) return null;
  try {
    const { data, error } = await admin
      .from("reel_cache")
      .select("instagram_url, caption, claude_places, created_at")
      .eq("instagram_url", key)
      .gte("created_at", cacheFreshCutoffIso())
      .maybeSingle();
    if (error) {
      console.warn("[reel_cache] read failed", error.message);
      return null;
    }
    if (!data) return null;
    const caption = typeof data.caption === "string" ? data.caption : null;
    if (!caption?.trim()) return null;
    return {
      instagram_url: data.instagram_url,
      caption,
      claude_places: Array.isArray(data.claude_places)
        ? (data.claude_places as RawPlace[])
        : null,
      created_at: data.created_at,
    };
  } catch (e) {
    console.warn("[reel_cache] read threw", e);
    return null;
  }
}

/** Apify+Claude 성공 후 upsert. 실패해도 extract는 계속. */
export async function writeReelCache(
  admin: SupabaseClient,
  rawUrl: string,
  caption: string,
  claudePlaces: RawPlace[],
): Promise<void> {
  const key = normalizeReelCacheUrl(rawUrl);
  if (!key) return;
  try {
    const { error } = await admin.from("reel_cache").upsert(
      {
        instagram_url: key,
        caption,
        claude_places: claudePlaces,
        created_at: new Date().toISOString(),
      },
      { onConflict: "instagram_url" },
    );
    if (error) {
      console.warn("[reel_cache] write failed", error.message);
    }
  } catch (e) {
    console.warn("[reel_cache] write threw", e);
  }
}
