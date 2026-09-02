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

/** iOS 커스텀 스킴 — Info.plist CFBundleURLSchemes 와 일치 */
export const PIND_MAP_APP_SCHEME = "pindmap";

/**
 * 앱이 있으면 스킴으로 열고, 없으면 앱스토어(또는 로그인)로.
 * Universal Link 미설정 환경용 베스트에포트.
 */
export function openPindMapAppOrStore(path = "welcome"): void {
  if (typeof window === "undefined") return;
  const storeUrl = getAppStoreUrl();
  const deepLink = `${PIND_MAP_APP_SCHEME}://${path.replace(/^\//, "")}`;
  const fallback = storeUrl || `${getSiteOrigin().replace(/\/$/, "")}/login`;

  const started = Date.now();
  const timer = window.setTimeout(() => {
    // 앱이 열리면 보통 blur/hidden 이 됨 — 그대로면 스토어로
    if (document.visibilityState === "visible" && Date.now() - started < 2800) {
      window.location.href = fallback;
    }
  }, 1200);

  const onHide = () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onHide);
  };
  document.addEventListener("visibilitychange", onHide);

  window.location.href = deepLink;
}

/** F-1a 웹 코스 공유 페이지 URL */
export function getCourseShareUrl(courseId: string): string {
  const origin = getSiteOrigin().replace(/\/$/, "");
  return `${origin}/course/${encodeURIComponent(courseId)}`;
}

/** 클립보드 복사 — clipboard API 우선, 실패 시 textarea fallback */
export type NavigatorShareResult = "shared" | "cancelled" | "unsupported";

/** 시스템 공유 시트 (카톡·문자 등). 미지원/실패 시 unsupported */
export async function shareViaNavigatorShare(
  data: ShareData,
): Promise<NavigatorShareResult> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return "unsupported";
  }
  try {
    await navigator.share(data);
    return "shared";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    if (e instanceof Error && e.name === "AbortError") return "cancelled";
    return "unsupported";
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fallback below */
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
