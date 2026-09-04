import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawPlace } from "@/app/api/extract/_shared";

/** 성공 캐시 TTL */
export const REEL_CACHE_OK_TTL_DAYS = 30;
/** 실패 캐시 TTL (캡션 수정 가능하므로 짧게) */
export const REEL_CACHE_FAIL_TTL_DAYS = 7;

/** @deprecated 성공 TTL과 동일 — 기존 import 호환 */
export const REEL_CACHE_TTL_DAYS = REEL_CACHE_OK_TTL_DAYS;

export type ReelCacheStatus = "ok" | "no_places" | "no_caption";

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
  status: ReelCacheStatus;
  caption: string | null;
  claude_places: RawPlace[] | null;
  created_at: string;
};

function parseStatus(raw: unknown): ReelCacheStatus {
  if (raw === "ok" || raw === "no_places" || raw === "no_caption") return raw;
  return "ok";
}

function ttlDaysForStatus(status: ReelCacheStatus): number {
  return status === "ok" ? REEL_CACHE_OK_TTL_DAYS : REEL_CACHE_FAIL_TTL_DAYS;
}

function isFresh(createdAt: string, status: ReelCacheStatus, now = new Date()): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  const maxAgeMs = ttlDaysForStatus(status) * 24 * 60 * 60 * 1000;
  return now.getTime() - created <= maxAgeMs;
}

/** 유효 기간 안 캐시만 반환. 실패 시 null (extract는 계속 진행). */
export async function readReelCache(
  admin: SupabaseClient,
  rawUrl: string,
): Promise<ReelCacheRow | null> {
  const key = normalizeReelCacheUrl(rawUrl);
  if (!key) return null;
  try {
    // fail TTL(7일)보다 오래된 행은 서버에서 걸러냄 — ok는 30일
    const oldestOk = new Date(
      Date.now() - REEL_CACHE_OK_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await admin
      .from("reel_cache")
      .select("instagram_url, status, caption, claude_places, created_at")
      .eq("instagram_url", key)
      .gte("created_at", oldestOk)
      .maybeSingle();
    if (error) {
      console.warn("[reel_cache] read failed", error.message);
      return null;
    }
    if (!data) return null;

    const status = parseStatus((data as { status?: unknown }).status);
    if (!isFresh(data.created_at, status)) return null;

    const caption = typeof data.caption === "string" ? data.caption : null;

    if (status === "ok") {
      if (!caption?.trim()) return null;
      if (!Array.isArray(data.claude_places)) return null;
      return {
        instagram_url: data.instagram_url,
        status,
        caption,
        claude_places: data.claude_places as RawPlace[],
        created_at: data.created_at,
      };
    }

    // no_places / no_caption — Apify 스킵용 실패 캐시
    return {
      instagram_url: data.instagram_url,
      status,
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

export type WriteReelCacheInput = {
  status: ReelCacheStatus;
  caption?: string | null;
  claudePlaces?: RawPlace[] | null;
};

/** upsert. 실패해도 extract는 계속. */
export async function writeReelCache(
  admin: SupabaseClient,
  rawUrl: string,
  input: WriteReelCacheInput,
): Promise<void> {
  const key = normalizeReelCacheUrl(rawUrl);
  if (!key) return;
  try {
    const { error } = await admin.from("reel_cache").upsert(
      {
        instagram_url: key,
        status: input.status,
        caption: input.caption ?? null,
        claude_places: input.claudePlaces ?? null,
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

/** Apify 결과가 캡션 없음으로 확정될 때만 no_caption 캐시 */
export function isNoCaptionScrapeError(message: string): boolean {
  return (
    message === "캡션을 찾을 수 없습니다." ||
    message === "Instagram 게시물을 가져올 수 없습니다."
  );
}
