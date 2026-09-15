import type { SupabaseClient } from "@supabase/supabase-js";
import { kakaoMissCacheKey } from "@/lib/extractPlaceFilters";

/** Kakao name-level negative cache TTL */
export const KAKAO_MISS_CACHE_TTL_HOURS = 24;

export async function readKakaoMissCache(
  admin: SupabaseClient,
  placeName: string,
): Promise<boolean> {
  const key = kakaoMissCacheKey(placeName);
  if (!key) return false;
  try {
    const oldest = new Date(
      Date.now() - KAKAO_MISS_CACHE_TTL_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await admin
      .from("kakao_place_miss_cache")
      .select("place_key")
      .eq("place_key", key)
      .gte("created_at", oldest)
      .maybeSingle();
    if (error) {
      // table missing → ignore
      if (error.code !== "42P01" && error.code !== "PGRST205") {
        console.warn("[kakao_miss_cache] read failed", error.message);
      }
      return false;
    }
    return !!data;
  } catch (e) {
    console.warn("[kakao_miss_cache] read threw", e);
    return false;
  }
}

export async function writeKakaoMissCache(
  admin: SupabaseClient,
  placeName: string,
): Promise<void> {
  const key = kakaoMissCacheKey(placeName);
  if (!key) return;
  try {
    const { error } = await admin.from("kakao_place_miss_cache").upsert(
      {
        place_key: key,
        error_code: "kakao_unresolved",
        created_at: new Date().toISOString(),
      },
      { onConflict: "place_key" },
    );
    if (error && error.code !== "42P01" && error.code !== "PGRST205") {
      console.warn("[kakao_miss_cache] write failed", error.message);
    }
  } catch (e) {
    console.warn("[kakao_miss_cache] write threw", e);
  }
}
