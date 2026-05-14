"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

export type AppUser = {
  id: string;
  username: string;
  email?: string;
};

// 현재 로그인된 사용자 정보를 가져오는 훅
export function useUser() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[PindMap:home][auth] signOut failed", err);
    } finally {
      const target = "/login";
      window.location.href = target;
      window.setTimeout(() => {
        window.location.href = target;
      }, 50);
    }
  }, []);

  useEffect(() => {
    setSessionChecked(false);
    const loadFinishedRef = { current: false };
    const listenerFiredRef = { current: false };

    const tryMarkSessionChecked = () => {
      if (loadFinishedRef.current && listenerFiredRef.current) {
        setSessionChecked(true);
      }
    };

    let timeoutId: number | null = null;
    let timeoutTriggered = false;
    /** loadUser 시작 시점 기준 단발 데드라인 — onAuthStateChange마다 리셋하지 않음(starvation 방지) */
    const AUTH_TIMEOUT_MS = 5000;

    const startAuthWatchdogOnce = () => {
      if (timeoutId !== null) return;
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        timeoutTriggered = true;
        console.warn("[PindMap:home][auth] auth watchdog fired - loading forced off");
        setLoading(false);
        setSessionChecked(true);
      }, AUTH_TIMEOUT_MS);
    };
    const stopAuthWatchdog = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const ensureUserExists = async (userId: string, email?: string, preferredUsername?: string) => {
      console.log("users 테이블 체크 시작", { userId });
      const { data: existing, error: selectError } = await supabase
        .from("users")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (selectError) {
        console.error("users 체크 실패:", selectError);
        return;
      }

      if (existing) {
        console.log("users 이미 존재:", preferredUsername?.trim() || email?.split("@")[0] || email || userId);
        return;
      }

      const fallbackUsername =
        preferredUsername?.trim() ||
        email?.split("@")[0] ||
        "user";

      const { error } = await supabase.from("users").upsert({
        id: userId,
        username: fallbackUsername,
      }, { onConflict: "id" });
      if (error) {
        console.error("users 자동 INSERT 실패:", error);
      } else {
        console.log("users INSERT 성공:", fallbackUsername);
      }
    };

    // 1) 페이지 처음 로드시 현재 세션 확인
    const loadUser = async () => {
      console.log("[PindMap:home][auth] loadUser start");
      startAuthWatchdogOnce();
      /** getSession에서 user가 확인되면 리스너 대기 없이 sessionChecked (로딩 단축). null 세션만 리스너+워치독 게이트 유지 (N-1 WK). */
      let loadUserHadAuthUser = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setUser(null);
          return;
        }
        loadUserHadAuthUser = true;

        await ensureUserExists(
          session.user.id,
          session.user.email,
          session.user.user_metadata?.username || session.user.user_metadata?.name
        );

        // users 테이블에서 username 가져오기
        const { data } = await supabase
          .from("users")
          .select("username")
          .eq("id", session.user.id)
          .single();

        const username =
          data?.username ||
          session.user.user_metadata?.username ||
          session.user.user_metadata?.name ||
          session.user.email?.split("@")[0] ||
          "user";

        setUser({
          id: session.user.id,
          username,
          email: session.user.email,
        });
        console.log("[PindMap:home][auth] loadUser done");
      } catch (err) {
        console.error("[PindMap:home][auth] loadUser failed", err);
        setUser(null);
      } finally {
        loadFinishedRef.current = true;
        if (loadUserHadAuthUser) {
          setSessionChecked(true);
        } else {
          tryMarkSessionChecked();
        }
        stopAuthWatchdog();
        setLoading(false);
        if (timeoutTriggered) {
          console.warn("[PindMap:home][auth] resumed after timeout fallback");
        }
      }
    };

    void loadUser();

    // 2) 로그인/로그아웃 변화 감지 (실시간)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!listenerFiredRef.current) {
          listenerFiredRef.current = true;
          tryMarkSessionChecked();
        }
        console.log("[PindMap:home][auth] onAuthStateChange start");
        try {
          if (!session?.user) {
            setUser(null);
            return;
          }

          await ensureUserExists(
            session.user.id,
            session.user.email,
            session.user.user_metadata?.username || session.user.user_metadata?.name
          );

          const { data } = await supabase
            .from("users")
            .select("username")
            .eq("id", session.user.id)
            .single();

          const username =
            data?.username ||
            session.user.user_metadata?.username ||
            session.user.user_metadata?.name ||
            session.user.email?.split("@")[0] ||
            "user";

          setUser({
            id: session.user.id,
            username,
            email: session.user.email,
          });
          console.log("[PindMap:home][auth] onAuthStateChange done");
        } catch (err) {
          console.error("[PindMap:home][auth] onAuthStateChange failed", err);
          setUser(null);
        } finally {
          stopAuthWatchdog();
          setLoading(false);
        }
      }
    );

    return () => {
      stopAuthWatchdog();
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading, sessionChecked, loggingOut, logout };
}
