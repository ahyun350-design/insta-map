"use client";

import type { CSSProperties } from "react";
import { openPindMapAppOrStore, getAppStoreUrl } from "@/lib/pindmapLinks";

const pageStyle: CSSProperties = {
  minHeight: "100dvh",
  margin: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "28px 20px",
  background: "linear-gradient(165deg, #FFF8EC 0%, #F5EDE0 55%, #E8DFD0 100%)",
  fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
  color: "#1B2A4A",
};

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: "360px",
  textAlign: "center",
};

const logoWrapStyle: CSSProperties = {
  width: 72,
  height: 72,
  margin: "0 auto 28px",
  borderRadius: 18,
  background: "#1B2A4A",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 10px 28px rgba(27, 42, 74, 0.22)",
};

const titleStyle: CSSProperties = {
  margin: "0 0 12px",
  fontFamily: "'Playfair Display', Georgia, serif",
  fontSize: "26px",
  fontWeight: 600,
  letterSpacing: "-0.02em",
  lineHeight: 1.25,
  color: "#1B2A4A",
};

const subStyle: CSSProperties = {
  margin: "0 0 36px",
  fontSize: "15px",
  lineHeight: 1.55,
  color: "rgba(27, 42, 74, 0.72)",
};

const ctaStyle: CSSProperties = {
  display: "block",
  width: "100%",
  border: "none",
  borderRadius: 12,
  padding: "16px 18px",
  background: "#1B2A4A",
  color: "#FFF8EC",
  fontSize: "15px",
  fontWeight: 600,
  letterSpacing: "0.02em",
  cursor: "pointer",
  fontFamily: "inherit",
};

const hintStyle: CSSProperties = {
  margin: "18px 0 0",
  fontSize: "12px",
  lineHeight: 1.5,
  color: "rgba(27, 42, 74, 0.5)",
};

export default function WelcomePage() {
  const storeUrl = getAppStoreUrl();

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <div style={logoWrapStyle} aria-hidden>
          <svg width="40" height="40" viewBox="0 0 32 32">
            <path
              d="M16 6C12 6 9 9 9 13C9 18 16 25 16 25S23 18 23 13C23 9 20 6 16 6Z"
              fill="#FFF8EC"
            />
            <circle cx="16" cy="13" r="3" fill="#1B2A4A" />
          </svg>
        </div>

        <p
          style={{
            margin: "0 0 8px",
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: "13px",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(27, 42, 74, 0.55)",
          }}
        >
          PindMap
        </p>

        <h1 style={titleStyle}>회원가입이 완료되었어요</h1>
        <p style={subStyle}>앱을 열어 로그인해 주세요</p>

        <button type="button" style={ctaStyle} onClick={() => openPindMapAppOrStore("welcome")}>
          앱 열기
        </button>

        <p style={hintStyle}>
          {storeUrl
            ? "앱이 열리지 않으면 App Store로 이동합니다."
            : "앱이 설치되어 있지 않다면 App Store에서 PindMap을 검색해 주세요."}
        </p>
      </div>
    </main>
  );
}
