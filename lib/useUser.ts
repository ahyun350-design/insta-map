"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { debugLog } from "./debugLog";
import { runConnectionWarmupWithRetry, runExtraRefreshSession } from "./connectionRecovery";

const AUTH_LOGIN_GATE_GET_SESSION_MS = 3_000;

function promiseWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${label}:timeout`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

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
  const loggingOutRef = useRef(false);
  const reloadFromSessionRef = useRef<(() => Promise<void>) | null>(null);
  /** `document.visibilityState === "hidden"` 시각 — 포그라운드 복귀 시 백그라운드 경과 시간 계산용 */
  const authForegroundLastHiddenAtRef = useRef<number | null>(null);
  /** WKWebView 등 stale connection 구간: 가벼운 GET warmup 진행 중 (실패해도 전송 등은 막지 않음) */
  const connectionWarmupPendingRef = useRef(false);

  const authUiRef = useRef({
    user: null as AppUser | null,
    sessionChecked: false,
    loggingOut: false,
  });
  useEffect(() => {
    authUiRef.current = { user, sessionChecked, loggingOut };
  }, [user, sessionChecked, loggingOut]);

  const logout = useCallback(async () => {
    loggingOutRef.current = true;
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
      /** getSession까지 성공했고 session.user가 있었는데 이후 단계가 실패한 경우 — 세션은 유지되므로 user를 비우지 않음(P0). */
      let hadAuthedSessionFromGet = false;
      try {
        const getSessionT = Date.now();
        const { data: { session } } = await supabase.auth.getSession();
        try {
          debugLog.set({ lastGetSession: { ok: !!session, ms: Date.now() - getSessionT, at: Date.now() } });
        } catch {
          /* ignore */
        }
        if (!session?.user) {
          setUser(null);
          return;
        }
        hadAuthedSessionFromGet = true;
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
        if (!hadAuthedSessionFromGet) {
          setUser(null);
        }
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
    reloadFromSessionRef.current = loadUser;

    // 2) 로그인/로그아웃 변화 감지 (실시간)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session) => {
        if (!listenerFiredRef.current) {
          listenerFiredRef.current = true;
          tryMarkSessionChecked();
        }
        console.log("[PindMap:home][auth] onAuthStateChange start", event);
        try {
          debugLog.set({ lastAuthEvent: `${event}@${new Date().toLocaleTimeString()}` });
        } catch {
          /* ignore */
        }
        if (event === "SIGNED_OUT") {
          if (loggingOutRef.current) {
            setUser(null);
          } else {
            console.warn("[PindMap:auth] external SIGNED_OUT ignored; session will be re-checked on visibility");
          }
          stopAuthWatchdog();
          setLoading(false);
          return;
        }
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
          if (!session?.user) {
            setUser(null);
          } else {
            const su = session.user;
            setUser({
              id: su.id,
              username:
                su.user_metadata?.username ||
                su.user_metadata?.name ||
                su.email?.split("@")[0] ||
                "user",
              email: su.email,
            });
          }
        } finally {
          stopAuthWatchdog();
          setLoading(false);
        }
      }
    );

    /** 포그라운드 복귀 시 세션·user 불일치 회복 및 주기적 재검증 (N-1 워치독·sessionChecked 게이트 로직은 변경 없음) */
    const FOREGROUND_AUTH_DEBOUNCE_MS = 1000;
    /** 백그라운드 5초+ 복귀 시 connection 리셋·warmup — 짧은 전환은 생략 */
    const MIN_BG_MS_FOR_CONN_WARMUP = 5_000;
    const CONN_REFRESH_TIMEOUT_MS = 5_000;
    const FOREGROUND_PERIODIC_MS = 5 * 60 * 1000;
    let foregroundDebounceTimer: number | null = null;
    let foregroundResyncInFlight = false;
    let lastPeriodicVerifyAt = Date.now();

    const runForegroundAuthResync = async () => {
      const { user: u, sessionChecked: sc, loggingOut: lo } = authUiRef.current;
      if (lo || !sc || foregroundResyncInFlight) return;
      const resyncGetSessionT = Date.now();
      const { data: { session } } = await supabase.auth.getSession();
      try {
        debugLog.set({ lastGetSession: { ok: !!session, ms: Date.now() - resyncGetSessionT, at: Date.now() } });
      } catch {
        /* ignore */
      }
      if (!session?.user) return;
      const now = Date.now();
      if (!u) {
        foregroundResyncInFlight = true;
        try {
          await loadUser();
        } finally {
          foregroundResyncInFlight = false;
        }
        return;
      }
      if (now - lastPeriodicVerifyAt < FOREGROUND_PERIODIC_MS) return;
      lastPeriodicVerifyAt = now;
      foregroundResyncInFlight = true;
      try {
        await loadUser();
      } finally {
        foregroundResyncInFlight = false;
      }
    };

    const onVisibilityForAuth = () => {
      if (document.visibilityState === "hidden") {
        authForegroundLastHiddenAtRef.current = Date.now();
        try {
          debugLog.set({ bgEnteredAt: Date.now() });
        } catch {
          /* ignore */
        }
        return;
      }
      if (document.visibilityState !== "visible") return;
      if (foregroundDebounceTimer !== null) {
        window.clearTimeout(foregroundDebounceTimer);
      }
      foregroundDebounceTimer = window.setTimeout(() => {
        foregroundDebounceTimer = null;
        void (async () => {
          const hiddenAt = authForegroundLastHiddenAtRef.current;
          authForegroundLastHiddenAtRef.current = null;
          const bgMs = hiddenAt !== null ? Date.now() - hiddenAt : 0;
          try {
            debugLog.set({ bgDurationMs: hiddenAt !== null ? bgMs : null });
          } catch {
            /* ignore */
          }

          if (bgMs >= MIN_BG_MS_FOR_CONN_WARMUP) {
            try {
              await supabase.removeAllChannels();
            } catch {
              /* ignore */
            }

            const refreshT = Date.now();
            try {
              debugLog.set({ refreshResult: "pending", refreshMs: null });
            } catch {
              /* ignore */
            }
            try {
              await promiseWithTimeout(
                Promise.resolve(supabase.auth.refreshSession()),
                CONN_REFRESH_TIMEOUT_MS,
                "auth.refreshSession",
              );
              try {
                debugLog.set({ refreshResult: "ok", refreshMs: Date.now() - refreshT });
              } catch {
                /* ignore */
              }
            } catch {
              try {
                debugLog.set({ refreshResult: "fail", refreshMs: Date.now() - refreshT });
              } catch {
                /* ignore */
              }
            }

            if (!connectionWarmupPendingRef.current) {
              connectionWarmupPendingRef.current = true;
              try {
                let warmupResult = await runConnectionWarmupWithRetry();
                if (warmupResult === "fail") {
                  await runExtraRefreshSession();
                  warmupResult = await runConnectionWarmupWithRetry();
                }
                if (warmupResult === "fail") {
                  console.warn("[PindMap:auth] connection warmup failed after retry");
                }
              } catch (e) {
                console.warn("[PindMap:auth] connection warmup failed", e);
              } finally {
                connectionWarmupPendingRef.current = false;
              }
            }
          }

          await runForegroundAuthResync();
        })();
      }, FOREGROUND_AUTH_DEBOUNCE_MS);
    };
    document.addEventListener("visibilitychange", onVisibilityForAuth);

    return () => {
      if (foregroundDebounceTimer !== null) {
        window.clearTimeout(foregroundDebounceTimer);
      }
      document.removeEventListener("visibilitychange", onVisibilityForAuth);
      reloadFromSessionRef.current = null;
      stopAuthWatchdog();
      subscription.unsubscribe();
    };
  }, []);

  const reloadUserFromSession = useCallback(async () => {
    await reloadFromSessionRef.current?.();
  }, []);

  const verifySessionQuick = useCallback(async (): Promise<Session | null> => {
    const getSessionT = Date.now();
    try {
      const { data } = await promiseWithTimeout(
        Promise.resolve(supabase.auth.getSession()),
        AUTH_LOGIN_GATE_GET_SESSION_MS,
        "auth.loginGate.getSession",
      );
      try {
        debugLog.set({ lastGetSession: { ok: !!data?.session, ms: Date.now() - getSessionT, at: Date.now() } });
      } catch {
        /* ignore */
      }
      return data.session ?? null;
    } catch (e) {
      try {
        debugLog.set({ lastGetSession: { ok: false, ms: Date.now() - getSessionT, at: Date.now() } });
      } catch {
        /* ignore */
      }
      console.warn("[PindMap:auth] login gate getSession timeout or error", e);
      return null;
    }
  }, []);

  return { user, loading, sessionChecked, loggingOut, logout, reloadUserFromSession, verifySessionQuick };
}
