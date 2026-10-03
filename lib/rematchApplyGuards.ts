/**
 * Daily/admin rematch 적용 전용 조건.
 * 신규 추출(resolvePlaceViaPoi 기본)에는 사용하지 않는다.
 */
import poiRules from "./poiMatch.rules.json";
import { normalizePoiName } from "@/lib/poiMatch";
import { SANGGA_SOURCE } from "@/lib/sanggaGuard";

/** apply_sangga_rematch.py 와 동일 */
export const SANGGA_REMATCH_MAX_DIST_M = 30;

const FACILITY_SOURCES = new Set(
  Object.keys((poiRules as { facilityRouting?: Record<string, unknown> }).facilityRouting ?? {}),
);

const ROAD_BN =
  /([0-9A-Za-z가-힣]+(?:로|길|거리))\s*([0-9]+(?:-[0-9]+)?)\s*$/;

/** 도로명(+로/길/거리) + 건물번호 — Python apply_sangga_rematch 와 동일 */
export function roadBuildingKey(
  addr: string | null | undefined,
): { road: string; bn: string } | null {
  let s = (addr || "").trim();
  if (!s) return null;
  s = s.split(",")[0]!.split("(")[0]!.trim();
  const m = ROAD_BN.exec(s);
  if (!m) return null;
  return { road: m[1]!, bn: m[2]! };
}

export function isExactNormalizedName(
  placeName: string,
  poiName: string,
): boolean {
  const a = normalizePoiName(placeName);
  const b = normalizePoiName(poiName);
  return Boolean(a) && a === b;
}

/**
 * sangga 매칭을 rematch로 places에 쓸 때만.
 * 거리 ≤30m OR (정규화 이름 완전일치 AND 도로명+건물번호 동일)
 */
export function sanggaRematchApplyAllowed(input: {
  placeName: string;
  placeAddress: string | null | undefined;
  poiName: string;
  poiAddress: string | null | undefined;
  matchDistM: number;
}): boolean {
  if (input.matchDistM <= SANGGA_REMATCH_MAX_DIST_M) return true;
  if (!isExactNormalizedName(input.placeName, input.poiName)) return false;
  const pk = roadBuildingKey(input.placeAddress);
  const sk = roadBuildingKey(input.poiAddress);
  return Boolean(pk && sk && pk.road === sk.road && pk.bn === sk.bn);
}

export function isFacilityPoiSource(source: string | null | undefined): boolean {
  return Boolean(source && FACILITY_SOURCES.has(source));
}

/**
 * park/market/museum/library/tourspot 등 시설 소스:
 * rematch 적용은 정규화 이름 완전일치만.
 */
export function facilityRematchApplyAllowed(
  placeName: string,
  poiName: string,
  poiSource: string | null | undefined,
): boolean {
  if (!isFacilityPoiSource(poiSource)) return true;
  return isExactNormalizedName(placeName, poiName);
}

export function rematchApplyRejectReason(input: {
  placeName: string;
  placeAddress: string | null | undefined;
  poiName: string;
  poiAddress: string | null | undefined;
  poiSource: string | null | undefined;
  matchDistM: number;
}): "sangga_apply" | "facility_nonexact" | null {
  const src = input.poiSource || "";
  if (src === SANGGA_SOURCE) {
    if (
      !sanggaRematchApplyAllowed({
        placeName: input.placeName,
        placeAddress: input.placeAddress,
        poiName: input.poiName,
        poiAddress: input.poiAddress,
        matchDistM: input.matchDistM,
      })
    ) {
      return "sangga_apply";
    }
  }
  if (!facilityRematchApplyAllowed(input.placeName, input.poiName, src)) {
    return "facility_nonexact";
  }
  return null;
}
