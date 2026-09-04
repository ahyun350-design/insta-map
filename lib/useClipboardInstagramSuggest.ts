"use client";

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { findInstagramPostUrlInText } from "@/lib/instagramUrl";
import { track } from "@/lib/track";
import { supabase } from "@/lib/supabase";

/** 앱 세션(완전 종료 전까지) 「안 함」 후 배너 재표시 금지 */
const SESSION_DISMISS_KEY = "pindmap_clipboard_suggest_session_dismissed";

function normalizeIgUrl(url: string): string {
  return url.replace(/\/$/, "").toLowerCase();
}

function readSessionDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSessionDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
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

/** 이미 추출·저장한 URL 이면 true (배너 스킵) */
async function userAlreadyExtractedUrl(userId: string, url: string): Promise<boolean> {
  try {
    const target = normalizeIgUrl(url);
    const { data, error } = await supabase
      .from("extract_jobs")
      .select("id, instagram_url")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data) return false;
    return data.some((row) => urlsMatch(row.instagram_url, target));
  } catch {
    return false;
  }
}

function urlsMatch(raw: unknown, targetNormalized: string): boolean {
  if (typeof raw !== "string" || !raw.trim()) return false;
  const normalized = normalizeIgUrl(raw);
  return (
    normalized === targetNormalized ||
    normalized.includes(targetNormalized) ||
    targetNormalized.includes(normalized)
  );
}

type Options = {
  userId: string | undefined;
  /** 진행 중 job URL — 있으면 제안 스킵 */
  activeInstagramUrls?: string[];
};

/**
 * 포그라운드 진입 시 클립보드 Instagram URL 확인 → 배너용 URL.
 * 「안 함」 후엔 해당 앱 세션 동안 재표시 안 함 (sessionStorage).
 */
export function useClipboardInstagramSuggest({ userId, activeInstagramUrls = [] }: Options) {
  const [suggestedUrl, setSuggestedUrl] = useState<string | null>(null);
  const checkingRef = useRef(false);
  const activeUrlsRef = useRef(activeInstagramUrls);
  activeUrlsRef.current = activeInstagramUrls;

  /** 세션 전체 억제 (안 함) — 메모리 + sessionStorage */
  const sessionDismissedRef = useRef(readSessionDismissed());
  /** 이번 세션에 이미 제안했거나 스킵한 URL (포그라운드마다 재팝업 방지) */
  const handledUrlsRef = useRef<Set<string>>(new Set());

  const dismiss = useCallback(() => {
    const url = suggestedUrl;
    sessionDismissedRef.current = true;
    writeSessionDismissed();
    if (url) {
      handledUrlsRef.current.add(normalizeIgUrl(url));
      track("clipboard_dismiss", { url });
    }
    setSuggestedUrl(null);
  }, [suggestedUrl]);

  /** 배너만 숨김 — 세션 억제는 아님 (다른 UI 동작 시) */
  const clearBanner = useCallback(() => {
    setSuggestedUrl((prev) => {
      if (prev) handledUrlsRef.current.add(normalizeIgUrl(prev));
      return null;
    });
  }, []);

  const accept = useCallback((): string | null => {
    const url = suggestedUrl;
    if (!url) return null;
    track("clipboard_accept", { url });
    handledUrlsRef.current.add(normalizeIgUrl(url));
    setSuggestedUrl(null);
    return url;
  }, [suggestedUrl]);

  const checkOnce = useCallback(async () => {
    if (!userId) return;
    if (!Capacitor.isNativePlatform()) return;
    if (sessionDismissedRef.current || readSessionDismissed()) {
      sessionDismissedRef.current = true;
      return;
    }
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const text = await readClipboardText();
      if (!text) return;
      const url = findInstagramPostUrlInText(text);
      if (!url) return;

      const key = normalizeIgUrl(url);
      if (handledUrlsRef.current.has(key)) return;

      const activeHit = activeUrlsRef.current.some((u) => {
        const a = normalizeIgUrl(u);
        return a === key || a.includes(key) || key.includes(a);
      });
      if (activeHit) {
        handledUrlsRef.current.add(key);
        return;
      }

      if (await userAlreadyExtractedUrl(userId, url)) {
        handledUrlsRef.current.add(key);
        return;
      }

      // 다시 한 번 세션 플래그 (체크 중 닫기 가능)
      if (sessionDismissedRef.current || readSessionDismissed()) {
        sessionDismissedRef.current = true;
        return;
      }

      track("clipboard_detected", { url });
      handledUrlsRef.current.add(key);
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

    sessionDismissedRef.current = readSessionDismissed();

    let cancelled = false;
    let listener: { remove: () => Promise<void> | void } | undefined;

    void (async () => {
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

  return { suggestedUrl, dismiss, accept, clearBanner };
}
