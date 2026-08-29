/** Instagram 게시물/릴스/TV URL — 서버 extract와 동일 판정 */
export function isValidInstagramPostUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\//i.test(url);
}

/** 쿼리·해시 제거 후 canonical path + trailing slash */
export function cleanInstagramUrl(url: string): string {
  const match = url.match(/(https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[^/?#]+)/i);
  if (match) {
    return `${match[1]}/`;
  }
  return url.trim();
}

/** 클립보드 등 자유 텍스트에서 첫 Instagram 게시 URL 추출 */
export function findInstagramPostUrlInText(text: string): string | null {
  const match = text.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[^\s/?#]+/i);
  if (!match) return null;
  const cleaned = cleanInstagramUrl(match[0]);
  return isValidInstagramPostUrl(cleaned) ? cleaned : null;
}
