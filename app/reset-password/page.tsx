"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 해요.");
      return;
    }

    if (password !== confirmPassword) {
      setError("비밀번호가 일치하지 않아요.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      setError("비밀번호 변경에 실패했어요. 다시 시도해주세요.");
      return;
    }

    setSuccess(true);
    setTimeout(() => {
      router.push("/login");
    }, 2000);
  };

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
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>✅</div>
          <h2 style={{
            margin: "0 0 12px",
            fontFamily: "'Playfair Display', serif",
            fontSize: "20px",
            color: "#1a1a1a",
          }}>비밀번호 변경 완료!</h2>
          <p style={{ margin: 0, fontSize: "13px", color: "#666" }}>
            잠시 후 로그인 페이지로 이동해요...
          </p>
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
          }}>새 비밀번호 설정</h1>
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#999" }}>
            새로운 비밀번호를 입력해주세요
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <input
            type="password"
            placeholder="새 비밀번호 (6자 이상)"
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
          <input
            type="password"
            placeholder="비밀번호 확인"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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
            {loading ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
      </div>
    </main>
  );
}