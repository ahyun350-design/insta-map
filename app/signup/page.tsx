"use client";

import { useEffect, useRef, useState, type CompositionEvent, type CSSProperties } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/track";

/** 'idle' = 아직 검사 안 함 / 입력 변경됨 — 제출 전 재검사 (API 실패는 가입 허용) */
type UsernameGate = "idle" | "checking" | "available" | "taken" | "error";

const USERNAME_CHECK_TIMEOUT_MS = 5_000;

/** AuthError.code / status 기준 — 메시지 문자열에 의존하지 않음 */
function mapSignupAuthError(err: {
  code?: string;
  status?: number;
}): { message: string; reason: string } {
  const code = err.code ?? "";
  const status = err.status;

  if (code === "user_already_exists" || code === "email_exists") {
    return {
      message: "이미 가입된 이메일이에요. 로그인해 주세요",
      reason: code,
    };
  }
  if (code === "email_address_invalid") {
    return {
      message: "이메일 주소를 다시 확인해 주세요",
      reason: code,
    };
  }
  if (code === "weak_password") {
    return {
      message: "비밀번호는 6자 이상이어야 해요",
      reason: code,
    };
  }
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    status === 429
  ) {
    return {
      message: "잠시 후 다시 시도해 주세요",
      reason: code || "rate_limit",
    };
  }

  return {
    message: "회원가입에 실패했어요. 다시 시도해주세요",
    reason: code || (status != null ? `status_${status}` : "unknown"),
  };
}

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
  const [usernameGate, setUsernameGate] = useState<UsernameGate>("idle");
  /** 마지막으로 서버 검사한 trim 닉 — 한글 IME onChange가 taken을 지우지 않게 */
  const lastCheckedRef = useRef<{ value: string; gate: UsernameGate } | null>(null);
  const checkSeqRef = useRef(0);

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

  const checkUsernameAvailable = async (raw: string): Promise<boolean | null> => {
    const trimmed = raw.trim();
    if (trimmed.length < 2) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), USERNAME_CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(
        `/api/username-available?username=${encodeURIComponent(trimmed)}`,
        { cache: "no-store", signal: controller.signal },
      );
      const body = (await res.json()) as { available?: boolean; error?: string };
      if (!res.ok || typeof body.available !== "boolean") return null;
      return body.available;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const runUsernameCheck = async (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length < 2) {
      lastCheckedRef.current = null;
      setUsernameGate("idle");
      return null;
    }

    // 같은 값으로 이미 taken/available이면 재호출 생략 (IME 중복 이벤트)
    const prev = lastCheckedRef.current;
    if (prev && prev.value === trimmed && (prev.gate === "taken" || prev.gate === "available")) {
      setUsernameGate(prev.gate);
      return prev.gate === "available";
    }

    const seq = ++checkSeqRef.current;
    setUsernameGate("checking");
    const available = await checkUsernameAvailable(trimmed);
    if (seq !== checkSeqRef.current) return available;

    if (available === false) {
      lastCheckedRef.current = { value: trimmed, gate: "taken" };
      setUsernameGate("taken");
      setError("이미 사용 중인 닉네임이에요");
      return false;
    }
    if (available === true) {
      lastCheckedRef.current = { value: trimmed, gate: "available" };
      setUsernameGate("available");
      setError((e) => (e === "이미 사용 중인 닉네임이에요" ? "" : e));
      return true;
    }
    // API 실패·타임아웃 → fail-open (DB unique가 최종 방어). 버튼은 잠그지 않음.
    lastCheckedRef.current = null;
    setUsernameGate("idle");
    setError((e) =>
      e === "이미 사용 중인 닉네임이에요" ||
      e === "닉네임 확인에 실패했어요. 잠시 후 다시 시도해 주세요."
        ? ""
        : e,
    );
    return null;
  };

  const handleUsernameBlur = () => {
    void runUsernameCheck(username);
  };

  const handleUsernameCompositionEnd = (e: CompositionEvent<HTMLInputElement>) => {
    // 한글 조합 확정 직후 검사 (blur 전에 조합만 끝나는 경우 대비)
    void runUsernameCheck(e.currentTarget.value);
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
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 2) {
      setError("닉네임은 2자 이상이어야 해요.");
      return;
    }

    if (usernameGate === "taken") {
      setError("이미 사용 중인 닉네임이에요");
      return;
    }

    setLoading(true);

    // 제출 직전 재확인 — 중복(false)만 차단. API 실패(null)는 가입 허용 (DB unique 방어)
    const available = await runUsernameCheck(trimmedUsername);
    if (available === false) {
      setLoading(false);
      setError("이미 사용 중인 닉네임이에요");
      return;
    }

    const marketingChecked = agreeMarketing;

    // Supabase에 회원가입 요청
    const { error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/welcome`,
        data: {
          username: trimmedUsername,
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
      const mapped = mapSignupAuthError({
        code: signupError.code,
        status: signupError.status,
      });
      track("signup_failed", { reason: mapped.reason });
      setError(mapped.message);
      return;
    }

    setSuccess(true);
  };

  const consentReady = agreeAge && agreeTerms && agreePrivacy;
  // taken / checking만 잠금 — API error(fail-open)는 잠그지 않음
  const usernameBlocked = usernameGate === "taken" || usernameGate === "checking";
  const submitDisabled = loading || !consentReady || usernameBlocked;

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
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              const next = e.target.value;
              setUsername(next);
              const trimmed = next.trim();
              const prev = lastCheckedRef.current;
              // 값이 바뀐 경우에만 gate 리셋 — 한글 IME가 같은 값으로 onChange 내도 taken 유지
              if (!prev || prev.value !== trimmed) {
                lastCheckedRef.current = null;
                setUsernameGate("idle");
                setError((err) =>
                  err === "이미 사용 중인 닉네임이에요" ||
                  err === "닉네임 확인에 실패했어요. 잠시 후 다시 시도해 주세요."
                    ? ""
                    : err,
                );
              }
            }}
            onBlur={handleUsernameBlur}
            onCompositionEnd={handleUsernameCompositionEnd}
            required
            style={inputStyle}
          />
          {usernameGate === "checking" && (
            <p style={{ margin: "-4px 0 0", fontSize: "11px", color: "#999" }}>닉네임 확인 중…</p>
          )}
          {usernameGate === "taken" && (
            <p style={{ margin: "-4px 0 0", fontSize: "11px", color: "#e07070" }}>이미 사용 중인 닉네임이에요</p>
          )}
          <input
            type="text"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
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
