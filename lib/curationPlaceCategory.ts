import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FEED_POST_CATEGORIES,
  type FeedPostCategory,
} from "@/lib/feedPost";
import { resolvePlaceCategorySignals, mapKakaoCategoryGroupCode } from "@/lib/kakaoCategory";
import {
  isAppCategory,
  mapLocaldataRawCategory,
} from "@/lib/localdataCategory";
import { searchPoi } from "@/lib/poiSearch";

const PLACE_MATCH_RADIUS_M = 100;

function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compactName(s: string): string {
  return (s || "").replace(/\s+/g, "").toLowerCase();
}

export type CurationCategoryResolveInput = {
  placeName: string;
  lat: number;
  lng: number;
  groupCode?: string | null;
  categoryName?: string | null;
  /** 현재 로그인 사용자 — places 조회 범위 */
  userId?: string | null;
  /**
   * 이미 달린 태그 category.
   * 있으면 poi 단독 신호로는 덮지 않는다 (기존값 유지 → null이면 호출측이 유지).
   */
  existingCategory?: FeedPostCategory | null;
};

export type CurationCategoryResolveResult = {
  category: FeedPostCategory | null;
  source:
    | "kakao_code"
    | "kakao_name"
    | "places"
    | "poi_raw"
    | "existing_kept"
    | "unresolved";
};

/**
 * 큐레이션 Step2 장소 태그 category 판정.
 * 1) 카카오 group_code / name (FD6 포함) → 적용
 * 2) places (본인 저장) → 적용
 * 3) poi — 다른 신호가 없고 existingCategory도 없을 때만
 * 4) null → 사용자 선택 (맛집 폴백 없음)
 */
export async function resolveCurationTagCategory(
  supabase: SupabaseClient,
  input: CurationCategoryResolveInput,
): Promise<CurationCategoryResolveResult> {
  const fromKakao = resolvePlaceCategorySignals({
    groupCode: input.groupCode,
    categoryName: input.categoryName,
    claudeCategory: null,
    poiRawCategory: null,
  });
  if (fromKakao) {
    const code = (input.groupCode ?? "").trim();
    const fromGroup =
      code === "FD6" || mapKakaoCategoryGroupCode(code) != null;
    return {
      category: fromKakao,
      source: fromGroup ? "kakao_code" : "kakao_name",
    };
  }

  const fromPlaces = await lookupSavedPlaceCategory(supabase, input);
  if (fromPlaces) {
    return { category: fromPlaces, source: "places" };
  }

  // poi는 기존값이 있으면 이기지 못함
  if (input.existingCategory && isAppCategory(input.existingCategory)) {
    return { category: input.existingCategory, source: "existing_kept" };
  }

  const fromPoi = await lookupPoiCategory(supabase, input);
  if (fromPoi) {
    return { category: fromPoi, source: "poi_raw" };
  }

  return { category: null, source: "unresolved" };
}

/** 저장된 places에서 이름+좌표로 category 조회 (본인 장소 우선). */
export async function lookupSavedPlaceCategory(
  supabase: SupabaseClient,
  input: {
    placeName: string;
    lat: number;
    lng: number;
    userId?: string | null;
  },
): Promise<FeedPostCategory | null> {
  const name = input.placeName.trim();
  if (!name || !Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return null;
  }

  let q = supabase
    .from("places")
    .select("name, category, lat, lng, category_edited_by_user, user_id")
    .eq("name", name)
    .limit(30);

  if (input.userId) {
    q = q.eq("user_id", input.userId);
  }

  const { data, error } = await q;
  if (error || !data?.length) {
    // 이름 정확 일치 실패 시 느슨 조회는 생략 (오매칭 위험)
    return null;
  }

  type Row = {
    name: string;
    category: string;
    lat: number;
    lng: number;
    category_edited_by_user?: boolean;
  };

  const near = (data as Row[])
    .map((r) => {
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const dist = haversineM(input.lat, input.lng, lat, lng);
      if (dist > PLACE_MATCH_RADIUS_M) return null;
      const cat = typeof r.category === "string" ? r.category.trim() : "";
      if (!isAppCategory(cat)) return null;
      return {
        category: cat as FeedPostCategory,
        dist,
        edited: r.category_edited_by_user === true,
      };
    })
    .filter(Boolean) as Array<{
    category: FeedPostCategory;
    dist: number;
    edited: boolean;
  }>;

  if (near.length === 0) return null;
  near.sort((a, b) => {
    if (a.edited !== b.edited) return a.edited ? -1 : 1;
    return a.dist - b.dist;
  });
  return near[0]!.category;
}

async function lookupPoiCategory(
  supabase: SupabaseClient,
  input: { placeName: string; lat: number; lng: number },
): Promise<FeedPostCategory | null> {
  const hits = await searchPoi(supabase, {
    q: input.placeName.trim(),
    origin_lat: input.lat,
    origin_lng: input.lng,
    max_results: 5,
  });
  const target = compactName(input.placeName);
  for (const hit of hits) {
    if (hit.lat == null || hit.lng == null) continue;
    if (haversineM(input.lat, input.lng, hit.lat, hit.lng) > PLACE_MATCH_RADIUS_M) {
      continue;
    }
    const hitNorm = compactName(hit.name);
    const nameNorm = hit.name_norm ? compactName(hit.name_norm) : "";
    const nameOk =
      hitNorm === target ||
      nameNorm === target ||
      hitNorm.includes(target) ||
      target.includes(hitNorm);
    if (!nameOk) continue;

    if (hit.category && isAppCategory(hit.category)) {
      return hit.category;
    }
    const fromRaw = mapLocaldataRawCategory(hit.raw_category);
    if (fromRaw) return fromRaw;
  }
  return null;
}

export function isFeedPostCategoryValue(v: string): v is FeedPostCategory {
  return (FEED_POST_CATEGORIES as readonly string[]).includes(v as FeedPostCategory);
}
