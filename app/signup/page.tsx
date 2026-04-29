"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 비밀번호 길이 체크
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 해요.");
      return;
    }

    // 닉네임 길이 체크
    if (username.trim().length < 2) {
      setError("닉네임은 2자 이상이어야 해요.");
      return;
    }

    setLoading(true);

    // Supabase에 회원가입 요청
    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username: username.trim() },
      },
    });

    setLoading(false);

    if (signupError) {
      if (signupError.message.includes("already registered")) {
        setError("이미 가입된 이메일이에요.");
      } else {
        setError("회원가입에 실패했어요. 다시 시도해주세요.");
      }
      return;
    }

    // users 테이블에도 추가
    if (data.user) {
      const finalUsername = username.trim() || email.split("@")[0] || "user";
      const { error: insertError } = await supabase
        .from("users")
        .upsert({
          id: data.user.id,
          username: finalUsername,
        }, { onConflict: "id" });
      if (insertError) {
        console.error("users INSERT 실패:", insertError);
        setError("회원가입은 완료됐지만 프로필 생성에 실패했어요. 로그인 후 다시 시도해주세요.");
        window.alert("회원가입은 완료됐지만 프로필 생성에 실패했어요. 로그인 후 다시 시도해주세요.");
      } else {
        console.log("users INSERT 성공:", finalUsername);
      }
    }

    setSuccess(true);
  };

  // 성공 화면
  if (success) {
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
          textAlign: "center",
        }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>📧</div>
          <h2 style={{
            margin: "0 0 12px",
            fontFamily: "'Playfair Display', serif",
            fontSize: "20px",
            color: "#1a1a1a",
          }}>이메일을 확인해주세요</h2>
          <p style={{ margin: "0 0 24px", fontSize: "13px", color: "#666", lineHeight: 1.6 }}>
            <strong>{email}</strong>로<br />
            인증 링크를 보냈어요.<br /><br />
            메일함을 확인하고 링크를 클릭하면<br />
            가입이 완료돼요!
          </p>
          <Link href="/login" style={{
            display: "inline-block",
            padding: "12px 28px",
            background: "#1a1a1a",
            color: "#fff",
            borderRadius: "8px",
            fontSize: "13px",
            textDecoration: "none",
            fontFamily: "'Playfair Display', serif",
            letterSpacing: "1px",
          }}>로그인 페이지로</Link>
        </div>
      </main>
    );
  }

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
            fontSize: "26px",
            color: "#1a1a1a",
          }}>회원가입</h1>
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#999" }}>
            PindMap에 오신 것을 환영해요 👋
          </p>
        </div>

        {/* 회원가입 폼 */}
        <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <input
            type="text"
            placeholder="닉네임 (2자 이상)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
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
            placeholder="비밀번호 (6자 이상)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
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
            {loading ? "가입 중..." : "회원가입"}
          </button>
        </form>

        {/* 로그인 링크 */}
        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "12px", color: "#888" }}>
          이미 계정이 있나요?{" "}
          <Link href="/login" style={{ color: "#1a1a1a", fontWeight: 500, textDecoration: "none" }}>
            로그인
          </Link>
        </p>
      </div>
    </main>
  );
}