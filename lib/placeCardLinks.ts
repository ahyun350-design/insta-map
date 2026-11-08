export type PlaceCardExternalLink = "kakao" | "naver" | "transit";

/** External-map buttons under the card's details (the bottom 대중교통 button covers transit when shown). */
export function placeCardExternalLinks(opts: {
  showAdminMapExtras: boolean;
  isMapTap: boolean;
  hasCoordinates: boolean;
  /** Admin MapLibre expanded card: no "카카오맵에서 보기" / "네이버 지도에서 보기". */
  hideExternalMapLinks: boolean;
  bottomTransitButton: boolean;
}): PlaceCardExternalLink[] {
  if (!(opts.showAdminMapExtras || opts.isMapTap) || !opts.hasCoordinates) return [];
  const links: PlaceCardExternalLink[] = opts.hideExternalMapLinks ? [] : ["kakao", "naver"];
  if (!opts.bottomTransitButton) links.push("transit");
  return links;
}
