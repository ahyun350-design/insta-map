import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_MAP_CATEGORY_CHIPS_VISIBLE,
  ADMIN_MAP_RESEARCH_GAP_BELOW_SEARCH_PX,
  ADMIN_MAP_SEARCH_PILL_OFFSET_PX,
  shouldOpenInAppTransit,
  showAdminMapCategoryChrome,
} from "./adminMapLibreChrome";

test("admin MapLibre category chrome: hidden by default", () => {
  assert.equal(ADMIN_MAP_CATEGORY_CHIPS_VISIBLE, false);
  assert.equal(showAdminMapCategoryChrome(), false);
  assert.equal(ADMIN_MAP_RESEARCH_GAP_BELOW_SEARCH_PX, 8);
  assert.equal(ADMIN_MAP_SEARCH_PILL_OFFSET_PX, 56);
});

test("shouldOpenInAppTransit: expanded MapLibre surface only", () => {
  assert.equal(
    shouldOpenInAppTransit({ showAdminMapExtras: true, expandedMapIsMapLibre: true }),
    true,
  );
  assert.equal(
    shouldOpenInAppTransit({ showAdminMapExtras: false, expandedMapIsMapLibre: true }),
    true,
  );
  assert.equal(
    shouldOpenInAppTransit({ showAdminMapExtras: true, expandedMapIsMapLibre: false }),
    false,
  );
  assert.equal(
    shouldOpenInAppTransit({ showAdminMapExtras: false, expandedMapIsMapLibre: false }),
    false,
  );
});
