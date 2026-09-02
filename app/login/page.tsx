"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Capacitor } from "@capacitor/core";
import type { AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { hasSeenOnboarding } from "@/lib/onboarding";
import { hideNativeSplash } from "@/lib/nativeSplash";
import { getSiteOrigin } from "@/lib/pindmapLinks";

function formatLoginError(error: AuthError): string {
  const raw = (error.message || "").trim();
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";

  if (
    code === "invalid_credentials" ||
    /invalid login credentials|invalid email or password|invalid_credentials/i.test(raw)
  ) {
    return "이메일 또는 비밀번호가 올바르지 않아요.";
  }
  if (
    /already.*(authenticated|signed)|user already signed|session exists|already logged/i.test(raw) ||
    code === "session_exists"
  ) {
    return "이미 로그인된 상태입니다. 앱을 재시작해 주세요.";
  }
  if (/email not confirmed|email address not confirmed/i.test(raw)) {
    return "이메일 인증이 필요합니다. 메일함을 확인해 주세요.";
  }
  if (/rate limit|too many requests|over_request_rate|429/i.test(raw) || code === "over_request_rate_limit") {
    return "요청이 많아 잠시 후 다시 시도해 주세요.";
  }
  console.error("[formatLoginError]", error);
  return "로그인에 실패했어요. 잠시 후 다시 시도해 주세요.";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const warmupInputRef = useRef<HTMLInputElement>(null);
  const warmupDoneRef = useRef(false);
  const userFocusedRealInputRef = useRef(false);

  const WARMUP_DELAY_MS = 400;
  const WARMUP_FOCUS_HOLD_MS = 400;

  const releaseWarmupFocus = (el: HTMLInputElement) => {
    el.blur();
    if (document.activeElement === el) {
      el.blur();
    }
    requestAnimationFrame(() => {
      if (document.activeElement === el) {
        el.blur();
      }
    });
  };

  useEffect(() => {
    if (!onboardingChecked || warmupDoneRef.current) return;
    if (!Capacitor.isNativePlatform()) {
      warmupDoneRef.current = true;
      return;
    }

    let cancelled = false;
    let holdTimerId: number | null = null;

    const finishSplash = () => {
      void hideNativeSplash();
    };

    const timerId = window.setTimeout(() => {
      void (async () => {
        if (cancelled || warmupDoneRef.current) return;
        if (userFocusedRealInputRef.current) {
          warmupDoneRef.current = true;
          finishSplash();
          return;
        }

        const el = warmupInputRef.current;
        if (!el) {
          warmupDoneRef.current = true;
          finishSplash();
          return;
        }

        warmupDoneRef.current = true;

        el.readOnly = true;
        el.focus({ preventScroll: true });
        el.blur();
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            if (document.activeElement === el) {
              el.blur();
            }
            resolve();
          });
        });

        if (cancelled || userFocusedRealInputRef.current) {
          releaseWarmupFocus(el);
          finishSplash();
          return;
        }

        el.readOnly = false;
        el.focus({ preventScroll: true });

        await new Promise<void>((resolve) => {
          holdTimerId = window.setTimeout(() => {
            holdTimerId = null;
            resolve();
          }, WARMUP_FOCUS_HOLD_MS);
        });

        if (cancelled) return;

        releaseWarmupFocus(el);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            releaseWarmupFocus(el);
            resolve();
          });
        });

        finishSplash();
      })();
    }, WARMUP_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      if (holdTimerId != null) {
        window.clearTimeout(holdTimerId);
      }
    };
  }, [onboardingChecked]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      void hideNativeSplash();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const seen = await hasSeenOnboarding();
      if (cancelled) return;
      if (!seen) {
        void hideNativeSplash();
        router.replace("/onboarding");
        return;
      }
      setOnboardingChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleRealInputFocus = () => {
    userFocusedRealInputRef.current = true;
  };

  if (!onboardingChecked) {
    return null;
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(formatLoginError(error));
      return;
    }

    router.push("/");
    router.refresh();
  };

  const handleKakaoLogin = async () => {
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "kakao",
      options: {
        redirectTo: `${getSiteOrigin()}/auth/callback`,
        scopes: "profile_nickname",
      },
    });

    if (error) {
      setError("카카오 로그인에 실패했어요. 다시 시도해주세요.");
    }
  };

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#fafafa",
      padding: "20px",
    }}>
      <input
        ref={warmupInputRef}
        type="text"
        inputMode="email"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        tabIndex={-1}
        aria-hidden
        style={{
          position: "fixed",
          left: -9999,
          top: 0,
          width: 0,
          height: 0,
          opacity: 0,
          pointerEvents: "none",
          border: "none",
          padding: 0,
          margin: 0,
        }}
      />
      <div style={{
        width: "100%",
        maxWidth: "380px",
        background: "#fff",
        borderRadius: "20px",
        padding: "40px 28px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
      }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <svg width="48" height="48" viewBox="0 0 32 32" style={{ marginBottom: "12px" }}>
            <rect width="32" height="32" rx="8" fill="#1a1a1a" />
            <path d="M16 6C12 6 9 9 9 13C9 18 16 25 16 25S23 18 23 13C23 9 20 6 16 6Z" fill="white" />
            <circle cx="16" cy="13" r="3" fill="#1a1a1a" />
          </svg>
          <h1 style={{
            margin: 0,
            fontFamily: "'Playfair Display', serif",
            fontSize: "28px",
            fontWeight: 400,
            color: "#1a1a1a",
            letterSpacing: "0.5px",
          }}>PindMap</h1>
          <p style={{
            margin: "6px 0 0",
            fontSize: "12px",
            color: "#999",
            letterSpacing: "0.5px",
          }}>인스타에서 본 그곳, 지도 위에서 다시 만나다</p>
        </div>

        <form onSubmit={handleEmailLogin} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <input
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="이메일"
            value={email}
            onFocus={handleRealInputFocus}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              border: "0.5px solid #e0e0e0",
              borderRadius: "8px",
              padding: "13px 14px",
              fontSize: "13px",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <input
            type="password"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="비밀번호"
            value={password}
            onFocus={handleRealInputFocus}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              border: "0.5px solid #e0e0e0",
              borderRadius: "8px",
              padding: "13px 14px",
              fontSize: "13px",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          {error && (
            <p style={{ margin: 0, fontSize: "11px", color: "#e07070", textAlign: "center" }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              border: "none",
              background: "#1a1a1a",
              color: "#fff",
              padding: "13px",
              borderRadius: "8px",
              fontSize: "13px",
              fontFamily: "'Playfair Display', serif",
              letterSpacing: "1px",
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.6 : 1,
              marginTop: "4px",
            }}
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        {/*
        비즈 앱 검수 전까지 카카오 로그인 비활성화 — 검수 후 이 블록 전체 주석 해제

        <div style={{ display: "flex", alignItems: "center", margin: "20px 0", gap: "10px" }}>
          <div style={{ flex: 1, height: "0.5px", background: "#e5e5e5" }} />
          <span style={{ fontSize: "11px", color: "#bbb", letterSpacing: "0.5px" }}>또는</span>
          <div style={{ flex: 1, height: "0.5px", background: "#e5e5e5" }} />
        </div>

        <button
          type="button"
          onClick={handleKakaoLogin}
          style={{
            width: "100%",
            border: "none",
            background: "#FEE500",
            color: "#191919",
            padding: "13px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: "16px" }}>💬</span>
          카카오로 시작하기
        </button>
        */}

        <p style={{ textAlign: "center", marginTop: "16px", fontSize: "12px", color: "#888" }}>
          <Link href="/forgot-password" style={{ color: "#888", textDecoration: "none" }}>
            비밀번호를 잊으셨나요?
          </Link>
        </p>
        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "12px", color: "#888" }}>
          처음 오셨나요?{" "}
          <Link href="/signup" style={{ color: "#1a1a1a", fontWeight: 500, textDecoration: "none" }}>
            회원가입
          </Link>
        </p>
      </div>
    </main>
  );
}
