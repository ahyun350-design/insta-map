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
  // MapLibre: in-app transit only — never the spare "대중교통 길찾기" external link.
  if (!opts.hideExternalMapLinks && !opts.bottomTransitButton) links.push("transit");
  return links;
}

/** "카카오맵에서 영업시간 보기": cards with a Kakao place page, except the admin MapLibre card. */
export function showKakaoHoursLink(opts: { placeUrl: string | null | undefined; hideExternalMapLinks: boolean }): boolean {
  return Boolean(opts.placeUrl) && !opts.hideExternalMapLinks;
}
