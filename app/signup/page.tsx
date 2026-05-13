"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const inputStyle: CSSProperties = {
  border: "0.5px solid #e0e0e0",
  borderRadius: "8px",
  padding: "13px 14px",
  fontSize: "13px",
  outline: "none",
  fontFamily: "inherit",
};

const checkboxStyle: CSSProperties = {
  width: "22px",
  height: "22px",
  minWidth: "22px",
  minHeight: "22px",
  flexShrink: 0,
  marginTop: "2px",
  cursor: "pointer",
  accentColor: "#1a1a1a",
};

const labelRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "10px",
  minHeight: "44px",
  cursor: "pointer",
  fontSize: "12px",
  color: "#1a1a1a",
  lineHeight: 1.45,
};

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const [agreeAll, setAgreeAll] = useState(false);
  const [agreeAge, setAgreeAge] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);

  useEffect(() => {
    setAgreeAll(agreeAge && agreeTerms && agreePrivacy && agreeMarketing);
  }, [agreeAge, agreeTerms, agreePrivacy, agreeMarketing]);

  const handleToggleAgreeAll = (checked: boolean) => {
    setAgreeAge(checked);
    setAgreeTerms(checked);
    setAgreePrivacy(checked);
    setAgreeMarketing(checked);
    setAgreeAll(checked);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!agreeAge || !agreeTerms || !agreePrivacy) {
      setError("필수 항목에 동의해주세요.");
      return;
    }

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

    const marketingChecked = agreeMarketing;

    // Supabase에 회원가입 요청
    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username.trim(),
          terms_agreed: true,
          privacy_agreed: true,
          is_adult: true,
          marketing_agreed: marketingChecked,
        },
      },
    });

    setLoading(false);

    if (signupError) {
      console.error("SIGNUP ERROR DETAIL:", JSON.stringify(signupError, null, 2));
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
      const now = new Date().toISOString();
      const { error: insertError } = await supabase.from("users").upsert(
        {
          id: data.user.id,
          username: finalUsername,
          terms_agreed_at: now,
          privacy_agreed_at: now,
          is_adult: true,
          marketing_agreed_at: marketingChecked ? now : null,
        },
        { onConflict: "id" },
      );
      if (insertError) {
        console.error("users INSERT 실패:", insertError);
        const msg = insertError.message ?? "";
        const isUsernameUniqueViolation =
          insertError.code === "23505" && msg.toLowerCase().includes("username");
        if (isUsernameUniqueViolation) {
          setError("이미 사용 중인 닉네임이에요. 다른 닉네임을 선택해주세요");
          return;
        } else {
          setError("회원가입은 완료됐지만 프로필 생성에 실패했어요. 로그인 후 다시 시도해주세요.");
          window.alert("회원가입은 완료됐지만 프로필 생성에 실패했어요. 로그인 후 다시 시도해주세요.");
          return;
        }
      } else {
        console.log("users INSERT 성공:", finalUsername);
      }
    }

    setSuccess(true);
  };

  const consentReady = agreeAge && agreeTerms && agreePrivacy;
  const submitDisabled = loading || !consentReady;

  // 성공 화면
  if (success) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafafa",
          padding: "20px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "380px",
            background: "#fff",
            borderRadius: "20px",
            padding: "40px 28px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>📧</div>
          <h2
            style={{
              margin: "0 0 12px",
              fontFamily: "'Playfair Display', serif",
              fontSize: "20px",
              color: "#1a1a1a",
            }}
          >
            이메일을 확인해주세요
          </h2>
          <p style={{ margin: "0 0 24px", fontSize: "13px", color: "#666", lineHeight: 1.6 }}>
            <strong>{email}</strong>로<br />
            인증 링크를 보냈어요.<br />
            <br />
            메일함을 확인하고 링크를 클릭하면
            <br />
            가입이 완료돼요!
          </p>
          <Link
            href="/login"
            style={{
              display: "inline-block",
              padding: "12px 28px",
              background: "#1a1a1a",
              color: "#fff",
              borderRadius: "8px",
              fontSize: "13px",
              textDecoration: "none",
              fontFamily: "'Playfair Display', serif",
              letterSpacing: "1px",
            }}
          >
            로그인 페이지로
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fafafa",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          background: "#fff",
          borderRadius: "20px",
          padding: "40px 28px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
        }}
      >
        {/* 로고 */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <svg width="48" height="48" viewBox="0 0 32 32" style={{ marginBottom: "12px" }}>
            <rect width="32" height="32" rx="8" fill="#1a1a1a" />
            <path d="M16 6C12 6 9 9 9 13C9 18 16 25 16 25S23 18 23 13C23 9 20 6 16 6Z" fill="white" />
            <circle cx="16" cy="13" r="3" fill="#1a1a1a" />
          </svg>
          <h1
            style={{
              margin: 0,
              fontFamily: "'Playfair Display', serif",
              fontSize: "26px",
              color: "#1a1a1a",
            }}
          >
            회원가입
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#999" }}>PindMap에 오신 것을 환영해요 👋</p>
        </div>

        {/* 회원가입 폼 */}
        <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <input
            type="text"
            placeholder="닉네임 (2자 이상)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="비밀번호 (6자 이상)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={inputStyle}
          />

          <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={labelRowStyle}>
              <input
                type="checkbox"
                checked={agreeAll}
                onChange={(e) => handleToggleAgreeAll(e.target.checked)}
                style={checkboxStyle}
              />
              <span style={{ fontWeight: 600, fontSize: "13px", color: "#1a1a1a" }}>전체 동의</span>
            </label>
            <div style={{ borderTop: "0.5px solid #e0e0e0", margin: "6px 0 4px", paddingTop: "8px" }} />

            <label style={labelRowStyle}>
              <input
                type="checkbox"
                checked={agreeAge}
                onChange={(e) => setAgreeAge(e.target.checked)}
                style={checkboxStyle}
              />
              <span>
                <span style={{ color: "#d9534f", fontWeight: 600 }}>[필수]</span> 만 14세 이상입니다
              </span>
            </label>

            <div style={{ ...labelRowStyle, cursor: "default" }}>
              <input
                id="signup-agree-terms"
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                style={checkboxStyle}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <label htmlFor="signup-agree-terms" style={{ cursor: "pointer" }}>
                  <span style={{ color: "#d9534f", fontWeight: 600 }}>[필수]</span> 서비스 이용약관 동의{" "}
                </label>
                <Link
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#1a1a1a", textDecoration: "underline", fontWeight: 500 }}
                >
                  보기
                </Link>
              </span>
            </div>

            <div style={{ ...labelRowStyle, cursor: "default" }}>
              <input
                id="signup-agree-privacy"
                type="checkbox"
                checked={agreePrivacy}
                onChange={(e) => setAgreePrivacy(e.target.checked)}
                style={checkboxStyle}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <label htmlFor="signup-agree-privacy" style={{ cursor: "pointer" }}>
                  <span style={{ color: "#d9534f", fontWeight: 600 }}>[필수]</span> 개인정보 처리방침 동의{" "}
                </label>
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#1a1a1a", textDecoration: "underline", fontWeight: 500 }}
                >
                  보기
                </Link>
              </span>
            </div>

            <label style={labelRowStyle}>
              <input
                type="checkbox"
                checked={agreeMarketing}
                onChange={(e) => setAgreeMarketing(e.target.checked)}
                style={checkboxStyle}
              />
              <span>
                <span style={{ color: "#666", fontWeight: 600 }}>[선택]</span> 마케팅 정보 수신 동의
              </span>
            </label>
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: "11px", color: "#e07070", textAlign: "center" }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={submitDisabled}
            style={{
              border: "none",
              background: submitDisabled ? "#c8c8c8" : "#1a1a1a",
              color: "#fff",
              padding: "13px",
              borderRadius: "8px",
              fontSize: "13px",
              fontFamily: "'Playfair Display', serif",
              letterSpacing: "1px",
              cursor: submitDisabled ? "not-allowed" : loading ? "wait" : "pointer",
              opacity: loading ? 0.85 : 1,
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
