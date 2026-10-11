import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildKakaoRescueAttempts,
  normalizePlaceQuery,
  shouldAdoptRescueResult,
  stripBranchOrRegionSuffix,
} from "./kakaoQueryRescue";

describe("stripBranchOrRegionSuffix", () => {
  it("strips space-separated branch / region tails and returns region hint", () => {
    assert.deepEqual(stripBranchOrRegionSuffix("히사시돈부리 연남본점"), {
      cleaned: "히사시돈부리",
      regionHint: "연남",
    });
    assert.deepEqual(stripBranchOrRegionSuffix("오프뷰티 익선동점"), {
      cleaned: "오프뷰티",
      regionHint: "익선동",
    });
    assert.deepEqual(stripBranchOrRegionSuffix("카페 성수점"), {
      cleaned: "카페",
      regionHint: "성수",
    });
    assert.deepEqual(stripBranchOrRegionSuffix("맛집 본점"), {
      cleaned: "맛집",
      regionHint: "",
    });
    assert.deepEqual(stripBranchOrRegionSuffix("가게 지점"), {
      cleaned: "가게",
      regionHint: "",
    });
    assert.deepEqual(stripBranchOrRegionSuffix("가게 직영점"), {
      cleaned: "가게",
      regionHint: "",
    });
  });

  it("keeps hyphen inside a space-separated branch token", () => {
    assert.deepEqual(stripBranchOrRegionSuffix("이마트24 광안리굿-7점"), {
      cleaned: "이마트24",
      regionHint: "광안리굿-7",
    });
  });

  it("strips underscore / hyphen separated region suffixes", () => {
    assert.deepEqual(stripBranchOrRegionSuffix("파나짱_동대문구"), {
      cleaned: "파나짱",
      regionHint: "동대문구",
    });
    assert.deepEqual(stripBranchOrRegionSuffix("가게-성수동"), {
      cleaned: "가게",
      regionHint: "성수동",
    });
  });

  it("does not break names that end with 점 without a separator", () => {
    for (const name of ["홍콩반점", "동네주점", "원조할매집", "청석꼴막걸리"]) {
      assert.deepEqual(stripBranchOrRegionSuffix(name), {
        cleaned: name,
        regionHint: "",
      });
    }
  });

  it("keeps result only when cleaned name is at least 2 characters", () => {
    assert.deepEqual(stripBranchOrRegionSuffix("가 성수점"), {
      cleaned: "가 성수점",
      regionHint: "",
    });
  });
});

describe("normalizePlaceQuery", () => {
  it("removes spacing, vol markers, and normalizes latin/specials", () => {
    assert.equal(normalizePlaceQuery("위틀리 vol.2"), "위틀리");
    assert.equal(normalizePlaceQuery("Dance Dance Dance"), "dancedancedance");
    assert.equal(normalizePlaceQuery("The Love Comes Seoul!"), "thelovecomesseoul");
    assert.equal(normalizePlaceQuery("카페  드  파리"), "카페드파리");
  });

  it("returns empty when nothing usable remains", () => {
    assert.equal(normalizePlaceQuery("!!!"), "");
  });
});

describe("shouldAdoptRescueResult", () => {
  it("requires address to include hint when hint is present", () => {
    assert.equal(
      shouldAdoptRescueResult(
        {
          placeName: "히사시돈부리",
          address: "서울 마포구 연남동 1",
          roadAddress: "서울 마포구 연남로 1",
        },
        { cleanedName: "히사시돈부리", hint: "연남" },
      ),
      true,
    );
    assert.equal(
      shouldAdoptRescueResult(
        {
          placeName: "히사시돈부리",
          address: "서울 강남구 역삼동 1",
          roadAddress: "서울 강남구 테헤란로 1",
        },
        { cleanedName: "히사시돈부리", hint: "연남" },
      ),
      false,
    );
  });

  it("requires exact place_name match when hint is absent", () => {
    assert.equal(
      shouldAdoptRescueResult(
        {
          placeName: "위틀리",
          address: "서울 중구 1",
          roadAddress: "서울 중구 1",
        },
        { cleanedName: "위틀리", hint: "" },
      ),
      true,
    );
    assert.equal(
      shouldAdoptRescueResult(
        {
          placeName: "위틀리 명동점",
          address: "서울 중구 1",
          roadAddress: "서울 중구 1",
        },
        { cleanedName: "위틀리", hint: "" },
      ),
      false,
    );
  });
});

describe("buildKakaoRescueAttempts", () => {
  it("emits up to 3 post-fail attempts in order a→b→c", () => {
    const attempts = buildKakaoRescueAttempts("히사시돈부리 연남본점", "마포");
    assert.ok(attempts.length <= 3);
    assert.equal(attempts[0]?.stage, "rescue_strip");
    assert.equal(attempts[0]?.query, "히사시돈부리");
    // strip prefers peeled region over Claude hint
    assert.equal(attempts[0]?.adoptHint, "연남");
    const hintAttempt = attempts.find((a) => a.stage === "rescue_hint");
    assert.ok(hintAttempt);
    assert.equal(hintAttempt?.adoptHint, "마포");
    assert.ok(attempts.every((a) => a.query.length >= 2));
  });

  it("uses stripped region as adopt hint when Claude hint is empty", () => {
    const attempts = buildKakaoRescueAttempts("오프뷰티 익선동점", "");
    assert.equal(attempts[0]?.stage, "rescue_strip");
    assert.equal(attempts[0]?.adoptHint, "익선동");
  });

  it("skips duplicate queries across a/b/c", () => {
    const attempts = buildKakaoRescueAttempts("단골집", "성수");
    const queries = attempts.map((a) => a.query);
    assert.equal(new Set(queries).size, queries.length);
    assert.ok(attempts.length <= 3);
  });
});
