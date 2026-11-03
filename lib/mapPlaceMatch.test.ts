import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countSavedUsers,
  normalizePlaceName,
  pickKakaoDoc,
  pickSanggaRow,
  placeNamesMatch,
} from "./mapPlaceMatch";

test("normalizePlaceName strips spaces, brackets and branch suffix", () => {
  assert.equal(normalizePlaceName(" 스타벅스 (망원점) "), "스타벅스망원");
  assert.equal(normalizePlaceName("Mom's touch"), "momstouch");
});

test("placeNamesMatch: equal or containment (≥3 chars)", () => {
  assert.ok(placeNamesMatch("스타벅스 망원점", "스타벅스망원"));
  assert.ok(placeNamesMatch("망원시장", "망원시장 고객센터"));
  assert.ok(!placeNamesMatch("화월", "화월당"));
  assert.ok(!placeNamesMatch("", "x"));
});

test("pickSanggaRow: nearest matching row within radius", () => {
  const rows = [
    { bizes_id: "a", name: "다른가게", branch: null, ind_m_name: null, ind_s_name: null, poi_class: null, road_address: null, floor: null, dist_m: 0 },
    { bizes_id: "b", name: "카페온도", branch: "망원점", ind_m_name: null, ind_s_name: null, poi_class: "cafe", road_address: "r", floor: "1", dist_m: 2 },
    { bizes_id: "c", name: "카페온도", branch: "망원점", ind_m_name: null, ind_s_name: null, poi_class: "cafe", road_address: "r", floor: "1", dist_m: 9 },
  ];
  assert.equal(pickSanggaRow("카페온도 망원점", rows, 5)?.bizes_id, "b");
  assert.equal(pickSanggaRow("카페온도 망원점", rows.slice(2), 5), null);
});

test("pickKakaoDoc: name + 100m gate", () => {
  const docs = [
    { id: "1", place_name: "카페온도", x: "126.9100", y: "37.5565" },
    { id: "2", place_name: "카페온도 망원점", x: "126.9020", y: "37.5566" },
  ];
  assert.equal(pickKakaoDoc("카페온도 망원점", 37.5565, 126.9019, docs)?.id, "2");
  assert.equal(pickKakaoDoc("다른곳", 37.5565, 126.9019, docs), null);
});

test("countSavedUsers: distinct users, same name, ≤100m", () => {
  const rows = [
    { user_id: "u1", name: "카페온도", lat: 37.5565, lng: 126.9019 },
    { user_id: "u1", name: "카페 온도", lat: 37.5565, lng: 126.902 },
    { user_id: "u2", name: "카페온도 망원점", lat: 37.5566, lng: 126.9019 },
    { user_id: "u3", name: "카페온도", lat: 37.57, lng: 126.95 },
    { user_id: "u4", name: "다른곳", lat: 37.5565, lng: 126.9019 },
  ];
  assert.equal(countSavedUsers("카페온도", 37.5565, 126.9019, rows), 2);
});
