"use client";

import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { mark } from "@/lib/bootTiming";

const SPLASH_MAX_WAIT_MS = 8000;

let hidden = false;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

/** 무한 스플래시 방지 — 앱 어디서든 한 번만 스케줄 */
export function scheduleNativeSplashFallback(maxMs = SPLASH_MAX_WAIT_MS): void {
  if (typeof window === "undefined") return;
  if (hidden || fallbackTimer != null) return;
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null;
    void hideNativeSplash();
  }, maxMs);
}

/** WebView 앱이 준비되면 호출. 웹·중복 호출은 no-op. */
export async function hideNativeSplash(): Promise<void> {
  if (hidden) return;
  hidden = true;
  if (fallbackTimer != null) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  if (!Capacitor.isNativePlatform()) {
    try {
      mark("splash_hidden");
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch {
    /* plugin missing / web — ignore */
  }
  try {
    mark("splash_hidden");
  } catch {
    /* ignore */
  }
}
