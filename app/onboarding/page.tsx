"use client";

import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { setOnboardingSeen } from "@/lib/onboarding";

const NAVY = "#1B2A6B";

const SLIDES = [
  {
    title: "릴스 속 그곳, 지도에 저장",
    description: "URL 붙여넣으면 위치까지 자동으로",
    Illustration: Slide1Illustration,
  },
  {
    title: "찾기 쉽게 자동 정리",
    description: "맛집·카페·쇼핑 알아서 나눠 담아요",
    Illustration: Slide2Illustration,
  },
  {
    title: "내 지도가 곧 여행 코스",
    description: "저장한 곳들을 골라 코스로 만들어요",
    Illustration: Slide3Illustration,
  },
  {
    title: "이제 내 지도를 채울 차례",
    description: "첫 릴스를 저장해보세요",
    Illustration: Slide4Illustration,
  },
] as const;

function MapPinIcon({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z"
        fill={color}
        stroke={color}
        strokeWidth="1.5"
      />
      <circle cx="12" cy="10" r="2.5" fill={color === "#fff" ? NAVY : "#fff"} />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <polygon points="8,5 19,12 8,19" />
    </svg>
  );
}

function PinDrop({
  size,
  color,
  children,
  style,
}: {
  size: number;
  color: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50% 50% 50% 0",
        transform: "rotate(-45deg)",
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        ...style,
      }}
    >
      <div style={{ transform: "rotate(45deg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

function IllustrationPlate({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: 150,
        height: 130,
        borderRadius: 18,
        background: "#EEF0FA",
        position: "relative",
        margin: "0 auto",
      }}
    >
      {children}
    </div>
  );
}

function Slide1Illustration() {
  return (
    <div
      className="onboardingIllustrationStage"
      style={{ position: "relative", width: "min(100%, 200px)", height: 150, margin: "0 auto" }}
      aria-hidden
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-58%, -50%)",
          width: 88,
          height: 120,
          borderRadius: 16,
          border: "1.5px solid #E4E7F2",
          background: "#fff",
          boxShadow: "0 10px 28px rgba(27, 42, 107, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: NAVY,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PlayIcon />
        </div>
      </div>
      <div style={{ position: "absolute", right: "4%", top: "6%" }}>
        <PinDrop size={48} color={NAVY}>
          <MapPinIcon size={22} color="#fff" />
        </PinDrop>
      </div>
    </div>
  );
}

function Slide2Illustration() {
  const pins = [
    { color: NAVY, emoji: "🍜", top: "18%", left: "12%" },
    { color: "#D8543A", emoji: "☕", top: "8%", right: "14%", left: "auto" as const },
    { color: "#1D9E75", emoji: "🛍️", bottom: "16%", left: "18%", top: "auto" as const },
    { color: "#BA7517", emoji: "📷", bottom: "10%", right: "10%", left: "auto" as const, top: "auto" as const },
  ];

  return (
    <IllustrationPlate>
      {pins.map((pin) => (
        <div
          key={pin.emoji}
          style={{
            position: "absolute",
            top: pin.top,
            left: pin.left,
            right: pin.right,
            bottom: pin.bottom,
          }}
        >
          <PinDrop size={40} color={pin.color}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{pin.emoji}</span>
          </PinDrop>
        </div>
      ))}
    </IllustrationPlate>
  );
}

function Slide3Illustration() {
  return (
    <IllustrationPlate>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="112" height="88" viewBox="0 0 112 88" fill="none" aria-hidden>
          <path
            d="M16 68 C34 58, 42 28, 56 24 S78 40, 96 20"
            stroke={NAVY}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="5 5"
            opacity="0.45"
          />
          <circle cx="16" cy="68" r="7" fill={NAVY} />
          <circle cx="16" cy="68" r="3" fill="#EEF0FA" />
          <circle cx="56" cy="24" r="7" fill={NAVY} />
          <circle cx="56" cy="24" r="3" fill="#EEF0FA" />
          <circle cx="96" cy="20" r="7" fill={NAVY} />
          <circle cx="96" cy="20" r="3" fill="#EEF0FA" />
          <path
            d="M44 52 L52 44 L60 52 L68 40"
            stroke={NAVY}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="44" cy="52" r="4" fill={NAVY} />
          <circle cx="68" cy="40" r="4" fill={NAVY} />
        </svg>
      </div>
    </IllustrationPlate>
  );
}

function Slide4Illustration() {
  return (
    <div
      className="onboardingIllustrationStage"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 180 }}
      aria-hidden
    >
      <div
        style={{
          width: 82,
          height: 82,
          borderRadius: "50%",
          background: "rgba(255, 255, 255, 0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MapPinIcon size={42} color="#fff" />
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index]!;

  const finish = useCallback(async () => {
    await setOnboardingSeen();
    router.push("/login");
  }, [router]);

  const goNext = useCallback(() => {
    if (isLast) {
      void finish();
      return;
    }
    setIndex((i) => Math.min(i + 1, SLIDES.length - 1));
  }, [finish, isLast]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const delta = end - start;
    if (delta < -48) goNext();
    else if (delta > 48) goPrev();
  };

  return (
    <main className={isLast ? "onboardingRoot onboardingRootFinal" : "onboardingRoot"}>
      {!isLast && (
        <header className="onboardingHeader">
          <span className="onboardingBrand">PindMap</span>
          <button type="button" className="onboardingSkip" onClick={() => void finish()}>
            건너뛰기
          </button>
        </header>
      )}

      <div
        className={isLast ? "onboardingSlideArea onboardingSlideAreaFinal" : "onboardingSlideArea onboardingSlideAreaCard"}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="onboardingIllustrationWrap">
          <slide.Illustration />
        </div>
        <h1 className={isLast ? "onboardingTitle onboardingTitleFinal" : "onboardingTitle"}>{slide.title}</h1>
        <p className={isLast ? "onboardingDescription onboardingDescriptionFinal" : "onboardingDescription"}>
          {slide.description}
        </p>
      </div>

      <div className={isLast ? "onboardingFooter onboardingFooterFinal" : "onboardingFooter"}>
        <div className="onboardingDots" role="tablist" aria-label="온보딩 진행">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${i + 1}번째 소개`}
              className={
                i === index
                  ? isLast
                    ? "onboardingDot onboardingDotActive onboardingDotActiveFinal"
                    : "onboardingDot onboardingDotActive"
                  : isLast
                    ? "onboardingDot onboardingDotFinal"
                    : "onboardingDot"
              }
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className={
            isLast
              ? "onboardingPrimary onboardingPrimaryFinal"
              : "onboardingPrimary"
          }
          onClick={goNext}
        >
          {isLast ? "시작하기" : "다음"}
        </button>
      </div>
    </main>
  );
}
