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

/** F-1a 웹 코스 공유 페이지 URL */
export function getCourseShareUrl(courseId: string): string {
  const origin = getSiteOrigin().replace(/\/$/, "");
  return `${origin}/course/${encodeURIComponent(courseId)}`;
}

/** 클립보드 복사 — clipboard API 우선, 실패 시 textarea fallback */
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
