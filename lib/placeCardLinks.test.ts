import { test } from "node:test";
import assert from "node:assert/strict";
import { placeCardExternalLinks } from "./placeCardLinks";

const base = { showAdminMapExtras: true, isMapTap: false, hasCoordinates: true, hideExternalMapLinks: false, bottomTransitButton: true };

test("place card: MapLibre expanded card has no 카카오맵/네이버 지도 buttons", () => {
  assert.deepEqual(placeCardExternalLinks({ ...base, hideExternalMapLinks: true }), []);
  assert.deepEqual(placeCardExternalLinks({ ...base, isMapTap: true, hideExternalMapLinks: true }), []);
  // Transit stays an external link when there is no bottom 대중교통 button.
  assert.deepEqual(placeCardExternalLinks({ ...base, hideExternalMapLinks: true, bottomTransitButton: false }), ["transit"]);
});

test("place card: other paths keep their buttons as before", () => {
  assert.deepEqual(placeCardExternalLinks(base), ["kakao", "naver"]);
  assert.deepEqual(placeCardExternalLinks({ ...base, bottomTransitButton: false }), ["kakao", "naver", "transit"]);
  assert.deepEqual(placeCardExternalLinks({ ...base, showAdminMapExtras: false }), []);
  assert.deepEqual(placeCardExternalLinks({ ...base, hasCoordinates: false }), []);
});
