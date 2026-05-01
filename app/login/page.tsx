"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 이메일 로그인
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
      setError("이메일 또는 비밀번호가 올바르지 않아요.");
      return;
    }

    router.push("/");
    router.refresh();
  };

  // 카카오 로그인
  const handleKakaoLogin = async () => {
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "kakao",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
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
      <div style={{
        width: "100%",
        maxWidth: "380px",
        background: "#fff",
        borderRadius: "20px",
        padding: "40px 28px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
      }}>
        {/* 로고 */}
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

        {/* 이메일 로그인 폼 */}
        <form onSubmit={handleEmailLogin} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <input
            type="email"
            placeholder="이메일"
            value={email}
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
            placeholder="비밀번호"
            value={password}
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

        {/* 구분선 */}
        <div style={{ display: "flex", alignItems: "center", margin: "20px 0", gap: "10px" }}>
          <div style={{ flex: 1, height: "0.5px", background: "#e5e5e5" }} />
          <span style={{ fontSize: "11px", color: "#bbb", letterSpacing: "0.5px" }}>또는</span>
          <div style={{ flex: 1, height: "0.5px", background: "#e5e5e5" }} />
        </div>

        {/* 카카오 로그인 */}
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

        {/* 회원가입 링크 */}
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