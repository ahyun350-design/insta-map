import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawPlace } from "@/app/api/extract/_shared";
import {
  EXTRACT_PLACE_RULE_VERSION,
  filterCachedClaudePlaces,
} from "@/lib/extractPlaceFilters";

/** 성공 캐시 TTL */
export const REEL_CACHE_OK_TTL_DAYS = 30;
/** 기본 실패 캐시 TTL */
export const REEL_CACHE_FAIL_TTL_DAYS = 7;
/** kakao_unresolved URL-level — short; place-level miss cache is separate */
export const REEL_CACHE_KAKAO_FAIL_TTL_HOURS = 24;

/** @deprecated 성공 TTL과 동일 — 기존 import 호환 */
export const REEL_CACHE_TTL_DAYS = REEL_CACHE_OK_TTL_DAYS;

export type ReelCacheStatus = "ok" | "no_places" | "no_caption" | "failed";

export type ReelCacheErrorCode =
  | "caption_empty"
  | "caption_too_short"
  | "only_account_handles"
  | "overseas_unsupported"
  | "no_places_in_caption"
  | "kakao_unresolved"
  | "no_caption";

/**
 * 캐시 키용 URL 정규화.
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
  claude_places: RawPlace[] | null;
  created_at: string;
  error_code: ReelCacheErrorCode | null;
  rule_version: number;
};

function parseStatus(raw: unknown): ReelCacheStatus {
  if (raw === "ok" || raw === "no_places" || raw === "no_caption" || raw === "failed") {
    return raw;
  }
  return "ok";
}

function parseErrorCode(raw: unknown): ReelCacheErrorCode | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim() as ReelCacheErrorCode;
  return v;
}

function ttlMsFor(status: ReelCacheStatus, errorCode: ReelCacheErrorCode | null): number {
  if (status === "ok") return REEL_CACHE_OK_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (errorCode === "kakao_unresolved") {
    return REEL_CACHE_KAKAO_FAIL_TTL_HOURS * 60 * 60 * 1000;
  }
  // caption_empty / too_short / only_account_handles / overseas / no_places / no_caption → 7d
  return REEL_CACHE_FAIL_TTL_DAYS * 24 * 60 * 60 * 1000;
}

function isFresh(
  createdAt: string,
  status: ReelCacheStatus,
  errorCode: ReelCacheErrorCode | null,
  now = new Date(),
): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  return now.getTime() - created <= ttlMsFor(status, errorCode);
}

/** Map cached fail → thrown error_message */
export function reelCacheFailToErrorMessage(row: ReelCacheRow): string {
  if (row.status === "no_caption") return "caption_empty";
  if (row.status === "no_places") {
    return row.error_code === "only_account_handles"
      ? "only_account_handles"
      : "no_places_in_caption";
  }
  if (row.status === "failed" && row.error_code) return row.error_code;
  return row.error_code || "no_places_in_caption";
}

/** Codes we persist as negative URL cache */
export function isNegativeCacheableError(message: string): ReelCacheErrorCode | null {
  const code = message.split("|")[0]?.trim() || message.trim();
  switch (code) {
    case "caption_empty":
    case "caption_too_short":
    case "only_account_handles":
    case "overseas_unsupported":
    case "no_places_in_caption":
    case "kakao_unresolved":
      return code;
    case "캡션을 찾을 수 없습니다.":
      return "caption_empty";
    default:
      return null;
  }
}

/** 유효 기간 안 캐시만 반환. bypassCache면 항상 null. */
export async function readReelCache(
  admin: SupabaseClient,
  rawUrl: string,
  opts?: { bypassCache?: boolean },
): Promise<ReelCacheRow | null> {
  if (opts?.bypassCache) return null;
  const key = normalizeReelCacheUrl(rawUrl);
  if (!key) return null;
  try {
    const oldestOk = new Date(
      Date.now() - REEL_CACHE_OK_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await admin
      .from("reel_cache")
      .select("instagram_url, status, claude_places, created_at, error_code, rule_version")
      .eq("instagram_url", key)
      .gte("created_at", oldestOk)
      .maybeSingle();
    if (error) {
      // Older schema without new columns — retry minimal select
      if (
        error.message?.includes("error_code") ||
        error.message?.includes("rule_version") ||
        error.code === "42703"
      ) {
        return readReelCacheLegacy(admin, key);
      }
      console.warn("[reel_cache] read failed", error.message);
      return null;
    }
    if (!data) return null;

    const status = parseStatus((data as { status?: unknown }).status);
    const errorCode = parseErrorCode((data as { error_code?: unknown }).error_code);
    if (!isFresh(data.created_at, status, errorCode)) return null;

    const ruleVersion =
      typeof (data as { rule_version?: unknown }).rule_version === "number"
        ? ((data as { rule_version: number }).rule_version)
        : 1;

    if (status === "ok") {
      if (!Array.isArray(data.claude_places)) return null;
      // (b) lazy clean account handles from cached places
      const { cleaned } = filterCachedClaudePlaces(data.claude_places as RawPlace[]);
      return {
        instagram_url: data.instagram_url,
        status,
        claude_places: cleaned,
        created_at: data.created_at,
        error_code: null,
        rule_version: ruleVersion,
      };
    }

    return {
      instagram_url: data.instagram_url,
      status,
      claude_places: Array.isArray(data.claude_places)
        ? (data.claude_places as RawPlace[])
        : null,
      created_at: data.created_at,
      error_code: errorCode,
      rule_version: ruleVersion,
    };
  } catch (e) {
    console.warn("[reel_cache] read threw", e);
    return null;
  }
}

async function readReelCacheLegacy(
  admin: SupabaseClient,
  key: string,
): Promise<ReelCacheRow | null> {
  const { data, error } = await admin
    .from("reel_cache")
    .select("instagram_url, status, claude_places, created_at")
    .eq("instagram_url", key)
    .maybeSingle();
  if (error || !data) return null;
  const status = parseStatus(data.status);
  if (!isFresh(data.created_at, status, null)) return null;
  if (status === "ok") {
    if (!Array.isArray(data.claude_places)) return null;
    const { cleaned } = filterCachedClaudePlaces(data.claude_places as RawPlace[]);
    return {
      instagram_url: data.instagram_url,
      status,
      claude_places: cleaned,
      created_at: data.created_at,
      error_code: null,
      rule_version: 1,
    };
  }
  return {
    instagram_url: data.instagram_url,
    status,
    claude_places: Array.isArray(data.claude_places)
      ? (data.claude_places as RawPlace[])
      : null,
    created_at: data.created_at,
    error_code:
      status === "no_caption"
        ? "caption_empty"
        : status === "no_places"
          ? "no_places_in_caption"
          : null,
    rule_version: 1,
  };
}

export type WriteReelCacheInput = {
  status: ReelCacheStatus;
  /** @deprecated 개인정보 — upsert에 포함하지 않음 */
  caption?: string | null;
  claudePlaces?: RawPlace[] | null;
  errorCode?: ReelCacheErrorCode | null;
  ruleVersion?: number;
};

/** upsert. 실패해도 extract는 계속. */
export async function writeReelCache(
  admin: SupabaseClient,
  rawUrl: string,
  input: WriteReelCacheInput,
): Promise<void> {
  const key = normalizeReelCacheUrl(rawUrl);
  if (!key) return;
  const payload: Record<string, unknown> = {
    instagram_url: key,
    status: input.status,
    claude_places: input.claudePlaces ?? null,
    created_at: new Date().toISOString(),
    rule_version: input.ruleVersion ?? EXTRACT_PLACE_RULE_VERSION,
    error_code: input.errorCode ?? null,
  };
  try {
    const { error } = await admin
      .from("reel_cache")
      .upsert(payload, { onConflict: "instagram_url" });
    if (error) {
      // Fallback without new columns
      if (
        error.message?.includes("error_code") ||
        error.message?.includes("rule_version") ||
        error.message?.includes("failed") ||
        error.code === "42703" ||
        error.code === "23514"
      ) {
        const legacyStatus: ReelCacheStatus =
          input.status === "failed"
            ? input.errorCode === "caption_empty" ||
              input.errorCode === "caption_too_short"
              ? "no_caption"
              : "no_places"
            : input.status;
        const { error: e2 } = await admin.from("reel_cache").upsert(
          {
            instagram_url: key,
            status: legacyStatus,
            claude_places: input.claudePlaces ?? null,
            created_at: new Date().toISOString(),
          },
          { onConflict: "instagram_url" },
        );
        if (e2) console.warn("[reel_cache] write failed", e2.message);
        return;
      }
      console.warn("[reel_cache] write failed", error.message);
    }
  } catch (e) {
    console.warn("[reel_cache] write threw", e);
  }
}

/** Force-retry: drop URL negative/success cache so Apify runs again. */
export async function deleteReelCache(
  admin: SupabaseClient,
  rawUrl: string,
): Promise<void> {
  const key = normalizeReelCacheUrl(rawUrl);
  if (!key) return;
  try {
    const { error } = await admin.from("reel_cache").delete().eq("instagram_url", key);
    if (error) console.warn("[reel_cache] delete failed", error.message);
  } catch (e) {
    console.warn("[reel_cache] delete threw", e);
  }
}

/** Apify 결과가 캡션 없음으로 확정될 때만 */
export function isNoCaptionScrapeError(message: string): boolean {
  return message === "캡션을 찾을 수 없습니다." || message === "caption_empty";
}
