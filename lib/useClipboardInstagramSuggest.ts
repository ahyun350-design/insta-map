"use client";

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { findInstagramPostUrlInText } from "@/lib/instagramUrl";
import { track } from "@/lib/track";
import { supabase } from "@/lib/supabase";

const PREFS_KEY = "clipboard_last_suggested_instagram_url";

async function readLastSuggestedUrl(): Promise<string | null> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key: PREFS_KEY });
    return value?.trim() || null;
  } catch {
    return null;
  }
}

async function writeLastSuggestedUrl(url: string): Promise<void> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key: PREFS_KEY, value: url });
  } catch {
    /* ignore */
  }
}

async function readClipboardText(): Promise<string | null> {
  try {
    const { Clipboard } = await import("@capacitor/clipboard");
    const { value } = await Clipboard.read();
    const text = typeof value === "string" ? value.trim() : "";
    return text || null;
  } catch {
    return null;
  }
}

async function userAlreadyExtractedUrl(userId: string, url: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("extract_jobs")
      .select("id, instagram_url")
      .eq("user_id", userId)
      .eq("status", "completed")
      .limit(100);
    if (error || !data) return false;
    const target = url.replace(/\/$/, "").toLowerCase();
    return data.some((row) => {
      const raw = typeof row.instagram_url === "string" ? row.instagram_url : "";
      const normalized = raw.replace(/\/$/, "").toLowerCase();
      return normalized === target || normalized.includes(target) || target.includes(normalized);
    });
  } catch {
    return false;
  }
}

type Options = {
  userId: string | undefined;
  /** 진행 중 job URL — 있으면 제안 스킵 */
  activeInstagramUrls?: string[];
};

/**
 * 포그라운드 진입 시 클립보드 Instagram URL 1회 확인 → 배너용 URL.
 * 실패·미로그인은 no-op. 앱 동작에 영향 없음.
 */
export function useClipboardInstagramSuggest({ userId, activeInstagramUrls = [] }: Options) {
  const [suggestedUrl, setSuggestedUrl] = useState<string | null>(null);
  const checkingRef = useRef(false);
  const activeUrlsRef = useRef(activeInstagramUrls);
  activeUrlsRef.current = activeInstagramUrls;

  const rememberAndClear = useCallback(async (url: string) => {
    await writeLastSuggestedUrl(url);
    setSuggestedUrl((prev) => (prev === url ? null : prev));
  }, []);

  const dismiss = useCallback(() => {
    const url = suggestedUrl;
    if (!url) return;
    track("clipboard_dismiss", { url });
    void rememberAndClear(url);
  }, [suggestedUrl, rememberAndClear]);

  const accept = useCallback((): string | null => {
    const url = suggestedUrl;
    if (!url) return null;
    track("clipboard_accept", { url });
    void rememberAndClear(url);
    return url;
  }, [suggestedUrl, rememberAndClear]);

  const checkOnce = useCallback(async () => {
    if (!userId) return;
    if (!Capacitor.isNativePlatform()) return;
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const text = await readClipboardText();
      if (!text) return;
      const url = findInstagramPostUrlInText(text);
      if (!url) return;

      const last = await readLastSuggestedUrl();
      if (last && last.replace(/\/$/, "").toLowerCase() === url.replace(/\/$/, "").toLowerCase()) {
        return;
      }

      const activeHit = activeUrlsRef.current.some((u) => {
        const a = u.replace(/\/$/, "").toLowerCase();
        const b = url.replace(/\/$/, "").toLowerCase();
        return a === b || a.includes(b) || b.includes(a);
      });
      if (activeHit) return;

      if (await userAlreadyExtractedUrl(userId, url)) {
        await writeLastSuggestedUrl(url);
        return;
      }

      track("clipboard_detected", { url });
      await writeLastSuggestedUrl(url);
      setSuggestedUrl(url);
    } catch {
      /* 클립보드 실패는 무시 */
    } finally {
      checkingRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setSuggestedUrl(null);
      return;
    }
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let listener: { remove: () => Promise<void> | void } | undefined;

    void (async () => {
      // 콜드 스타트: 진입 시 1회
      if (!cancelled) await checkOnce();
      try {
        listener = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive && !cancelled) void checkOnce();
        });
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, [userId, checkOnce]);

  return { suggestedUrl, dismiss, accept };
}
