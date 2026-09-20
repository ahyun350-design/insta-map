"use client";

type RouterLike = {
  back: () => void;
  replace: (href: string) => void;
  push: (href: string) => void;
};

const STORAGE_KEY = "pindmap_in_app_route_depth";

function readDepth(): number {
  if (typeof window === "undefined") return 0;
  try {
    const n = Number(window.sessionStorage.getItem(STORAGE_KEY) ?? "0");
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writeDepth(n: number): void {
  if (typeof window === "undefined") return;
  try {
    if (n <= 0) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    /* ignore */
  }
}

/** Call immediately before an in-app `router.push` to a subpage (profile, course, …). */
export function markInAppRoutePush(): void {
  writeDepth(readDepth() + 1);
}

/**
 * Prefer `router.back()` only when we previously marked an in-app push.
 * Otherwise `replace(fallback)` so deep-link / cold-start never blanks the WebView.
 */
export function safeRouterBack(router: Pick<RouterLike, "back" | "replace">, fallbackHref = "/"): void {
  const depth = readDepth();
  if (depth > 0) {
    writeDepth(depth - 1);
    router.back();
    return;
  }
  router.replace(fallbackHref);
}

/** Convenience: mark then push. */
export function pushInAppRoute(router: Pick<RouterLike, "push">, href: string): void {
  markInAppRoutePush();
  router.push(href);
}
