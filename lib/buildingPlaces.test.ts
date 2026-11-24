import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILDING_PLACES_MAX,
  buildingPlaceCategoryLabel,
  buildingPlaceDisplayName,
  filterBuildingPlaces,
  formatBuildingFloor,
  roadAddressKey,
  roadAddressesMatch,
  type BuildingPlaceCandidate,
} from "./buildingPlaces";

describe("roadAddressKey / roadAddressesMatch", () => {
  it("matches full vs short 시·도 forms for the same 로·번지", () => {
    assert.equal(roadAddressKey("서울특별시 마포구 망원로4길 3"), "망원로4길3");
    assert.equal(roadAddressKey("서울 마포구 망원로4길 3"), "망원로4길3");
    assert.equal(
      roadAddressesMatch("서울특별시 마포구 망원로4길 3", "서울 마포구 망원로4길 3"),
      true,
    );
  });

  it("rejects a different 번지 on the same road", () => {
    assert.equal(
      roadAddressesMatch("서울 마포구 망원로4길 3", "서울 마포구 망원로4길 5"),
      false,
    );
  });
});

describe("formatBuildingFloor / buildingPlaceDisplayName", () => {
  it("formats floors", () => {
    assert.equal(formatBuildingFloor("1"), "1층");
    assert.equal(formatBuildingFloor("B2"), "지하 2층");
    assert.equal(formatBuildingFloor(""), null);
  });

  it("joins branch when not already in the name", () => {
    assert.equal(buildingPlaceDisplayName("이디야", "망원점"), "이디야 망원점");
    assert.equal(buildingPlaceDisplayName("이디야 망원점", "망원점"), "이디야 망원점");
  });
});

describe("buildingPlaceCategoryLabel", () => {
  it("maps map-icon classes to Korean; hides unmapped English and raw Hangul", () => {
    assert.equal(buildingPlaceCategoryLabel("restaurant"), "음식점");
    assert.equal(buildingPlaceCategoryLabel("cafe"), "카페");
    assert.equal(buildingPlaceCategoryLabel("bar"), "술집");
    assert.equal(buildingPlaceCategoryLabel("books"), "서점");
    assert.equal(buildingPlaceCategoryLabel("bakery"), "빵·디저트");
    assert.equal(buildingPlaceCategoryLabel("카페"), "카페");
    assert.equal(buildingPlaceCategoryLabel("음식점"), "음식점");
    assert.equal(buildingPlaceCategoryLabel("unknown_shop"), null);
    assert.equal(buildingPlaceCategoryLabel("Laundry"), null);
    assert.equal(buildingPlaceCategoryLabel("한식"), null);
    assert.equal(buildingPlaceCategoryLabel(""), null);
    assert.equal(buildingPlaceCategoryLabel(null), null);
  });
});

describe("filterBuildingPlaces", () => {
  const base = (over: Partial<BuildingPlaceCandidate>): BuildingPlaceCandidate => ({
    id: "a",
    name: "가게A",
    branch: null,
    category: "cafe",
    floor: "1",
    roadAddress: "서울 마포구 망원로4길 3",
    lat: 37.55,
    lng: 126.9,
    distM: 1,
    ...over,
  });

  it("keeps matching rows, drops others, caps at max, nearest first", () => {
    const items = filterBuildingPlaces(
      [
        base({ id: "far", name: "먼곳", distM: 15, roadAddress: "서울 마포구 망원로4길 3" }),
        base({ id: "near", name: "가까운곳", distM: 2 }),
        base({
          id: "other",
          name: "이웃",
          roadAddress: "서울 마포구 망원로4길 5",
          distM: 3,
        }),
        base({ id: "near", name: "중복id", distM: 1 }),
        base({ id: "eng", name: "영문업종", category: "laundry", distM: 4 }),
      ],
      "서울특별시 마포구 망원로4길 3",
      10,
    );
    assert.deepEqual(
      items.map((i) => i.id),
      ["near", "eng", "far"],
    );
    assert.equal(items[0].floorLabel, "1층");
    assert.equal(items[0].category, "카페");
    assert.equal(items[1].category, null);
  });

  it("returns [] when none match or road empty; never exceeds BUILDING_PLACES_MAX", () => {
    assert.deepEqual(filterBuildingPlaces([base({})], "", 10), []);
    assert.deepEqual(
      filterBuildingPlaces(
        [base({ roadAddress: "서울 마포구 다른로 1" })],
        "서울 마포구 망원로4길 3",
      ),
      [],
    );
    const many = Array.from({ length: 15 }, (_, i) =>
      base({ id: `id${i}`, name: `가게${i}`, distM: i }),
    );
    assert.equal(filterBuildingPlaces(many, "서울 마포구 망원로4길 3").length, BUILDING_PLACES_MAX);
  });
});
