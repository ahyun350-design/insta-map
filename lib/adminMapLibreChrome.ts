/**
 * Admin MapLibre expanded chrome: category / discover chips under the search bar.
 * Default: hidden (display off — chip code stays). E2E may force-show for before shots.
 */
export const ADMIN_MAP_CATEGORY_CHIPS_VISIBLE = false;

/** Search pill height + top chrome padding used for 재검색 offset. */
export const ADMIN_MAP_SEARCH_PILL_OFFSET_PX = 56; // 12 padding-top + 44 pill
export const ADMIN_MAP_RESEARCH_GAP_BELOW_SEARCH_PX = 8;

export function showAdminMapCategoryChrome(): boolean {
  if (typeof window !== "undefined") {
    const w = window as unknown as { __PINDMAP_E2E_SHOW_CATEGORY_CHIPS__?: boolean };
    if (w.__PINDMAP_E2E_SHOW_CATEGORY_CHIPS__ === true) return true;
  }
  return ADMIN_MAP_CATEGORY_CHIPS_VISIBLE;
}

/**
 * Admin MapLibre expanded surface only — in-app TransitRoutePanel instead of external Kakao.
 * `expandedMapIsMapLibre` is already admin/e2e-gated (MAP_GL_ROLLOUT_PERCENT=0).
 */
export function shouldOpenInAppTransit(opts: {
  showAdminMapExtras: boolean;
  expandedMapIsMapLibre: boolean;
}): boolean {
  void opts.showAdminMapExtras; // kept for call-site clarity / future gates
  return Boolean(opts.expandedMapIsMapLibre);
}
