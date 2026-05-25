/**
 * App Store URL — v1.2 출시 후 `.env`에 설정:
 * NEXT_PUBLIC_APP_STORE_URL=https://apps.apple.com/app/idXXXXXXXXX
 */
export function getAppStoreUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_APP_STORE_URL?.trim();
  return url || null;
}

export function getSiteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://pindmap.com";
}
