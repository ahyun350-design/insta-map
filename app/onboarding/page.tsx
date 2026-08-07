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
    toneClass: "onboardingTone1",
  },
  {
    title: "찾기 쉽게 자동 정리",
    description: "맛집·카페·쇼핑 알아서 나눠 담아요",
    Illustration: Slide2Illustration,
    toneClass: "onboardingTone2",
  },
  {
    title: "내 지도가 곧 여행 코스",
    description: "저장한 곳들을 골라 코스로 만들어요",
    Illustration: Slide3Illustration,
    toneClass: "onboardingTone3",
  },
  {
    title: "이제 내 지도를 채울 차례",
    description: "첫 릴스를 저장해보세요",
    Illustration: Slide4Illustration,
    toneClass: "",
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

function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <polygon points="8,5 19,12 8,19" />
    </svg>
  );
}

/** Lucide-style stroke icons (lucide-react 미설치 → 인라인 SVG) */
function IconUtensils({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7 2v20" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCoffee({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10 2v2M14 2v2M17 8H4a1 1 0 0 0-1 1v2a6 6 0 0 0 6 6h2a6 6 0 0 0 6-6V9a1 1 0 0 0-1-1Z"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18 8h1a3 3 0 0 1 0 6h-1" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 20h10" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconShoppingBag({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 6h18" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M16 10a4 4 0 0 1-8 0"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCamera({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

const PIN_SHADOW = "0 14px 32px rgba(27, 42, 107, 0.18), 0 4px 10px rgba(27, 42, 107, 0.08)";

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
        boxShadow: PIN_SHADOW,
        ...style,
      }}
    >
      <div style={{ transform: "rotate(45deg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

function IllustrationPlate({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "blue" | "lavender" | "mint";
}) {
  const bg =
    tone === "blue"
      ? "linear-gradient(160deg, rgba(255,255,255,0.55) 0%, rgba(210,222,245,0.35) 100%)"
      : tone === "lavender"
        ? "linear-gradient(160deg, rgba(255,255,255,0.55) 0%, rgba(220,214,240,0.4) 100%)"
        : "linear-gradient(160deg, rgba(255,255,255,0.55) 0%, rgba(200,230,228,0.4) 100%)";

  return (
    <div
      className="onboardingIllustrationPlate"
      style={{
        width: "min(100%, 280px)",
        height: 220,
        borderRadius: 28,
        background: bg,
        position: "relative",
        margin: "0 auto",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.65)",
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
      style={{ position: "relative", width: "min(100%, 280px)", height: 230, margin: "0 auto" }}
      aria-hidden
    >
      <div
        style={{
          position: "absolute",
          left: "46%",
          top: "52%",
          transform: "translate(-58%, -50%)",
          width: 132,
          height: 178,
          borderRadius: 22,
          border: "1.5px solid rgba(228, 231, 242, 0.95)",
          background: "#fff",
          boxShadow: "0 18px 40px rgba(27, 42, 107, 0.16), 0 4px 12px rgba(27, 42, 107, 0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: NAVY,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 10px 24px rgba(27, 42, 107, 0.28)",
          }}
        >
          <PlayIcon size={22} />
        </div>
      </div>
      <div style={{ position: "absolute", right: "2%", top: "2%" }}>
        <PinDrop size={72} color={NAVY}>
          <MapPinIcon size={32} color="#fff" />
        </PinDrop>
      </div>
    </div>
  );
}

function Slide2Illustration() {
  const pins: Array<{
    color: string;
    Icon: (p: { size?: number }) => ReactNode;
    top?: string;
    left?: string;
    right?: string;
    bottom?: string;
    key: string;
  }> = [
    { key: "food", color: NAVY, Icon: IconUtensils, top: "16%", left: "10%" },
    { key: "cafe", color: "#D8543A", Icon: IconCoffee, top: "6%", right: "12%", left: "auto" },
    { key: "shop", color: "#1D9E75", Icon: IconShoppingBag, bottom: "14%", left: "16%", top: "auto" },
    { key: "cam", color: "#BA7517", Icon: IconCamera, bottom: "8%", right: "8%", left: "auto", top: "auto" },
  ];

  return (
    <IllustrationPlate tone="lavender">
      {pins.map((pin) => (
        <div
          key={pin.key}
          style={{
            position: "absolute",
            top: pin.top,
            left: pin.left,
            right: pin.right,
            bottom: pin.bottom,
          }}
        >
          <PinDrop size={58} color={pin.color}>
            <pin.Icon size={22} />
          </PinDrop>
        </div>
      ))}
    </IllustrationPlate>
  );
}

function Slide3Illustration() {
  const routeNavy = "#1B2A4A";
  // 1 좌하 → 2 중앙 → 3 우상, 완만한 상승 곡선
  const p1 = { x: 28, y: 118 };
  const p2 = { x: 110, y: 78 };
  const p3 = { x: 188, y: 36 };
  const r = 16;
  const pathD = `M ${p1.x} ${p1.y} C 58 112, 78 92, ${p2.x} ${p2.y} S 158 48, ${p3.x} ${p3.y}`;

  return (
    <IllustrationPlate tone="mint">
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="220" height="168" viewBox="0 0 220 160" fill="none" aria-hidden>
          <defs>
            <filter id="onboardingRouteGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="onboardingRouteShadow" x="-20%" y="-20%" width="140%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="10" />
            </filter>
          </defs>

          {/* 경로 아래 옅은 그림자 */}
          <path
            d={pathD}
            stroke="rgba(27, 42, 74, 0.06)"
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
            transform="translate(0 8)"
            filter="url(#onboardingRouteShadow)"
          />

          {/* 점선 경로 */}
          <path
            d={pathD}
            stroke={routeNavy}
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeDasharray="5 7"
            fill="none"
            opacity="0.72"
          />

          {/* 1 */}
          <circle cx={p1.x} cy={p1.y} r={r} fill={routeNavy} />
          <text
            x={p1.x}
            y={p1.y + 1}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize="13"
            fontWeight="700"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            1
          </text>

          {/* 2 */}
          <circle cx={p2.x} cy={p2.y} r={r} fill={routeNavy} />
          <text
            x={p2.x}
            y={p2.y + 1}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize="13"
            fontWeight="700"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            2
          </text>

          {/* 3 — 도착 링 + 점 */}
          <circle
            cx={p3.x}
            cy={p3.y}
            r={r + 8}
            fill="none"
            stroke="rgba(27, 42, 74, 0.18)"
            strokeWidth="3"
            filter="url(#onboardingRouteGlow)"
          />
          <circle cx={p3.x} cy={p3.y} r={r} fill={routeNavy} />
          <text
            x={p3.x}
            y={p3.y + 1}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize="13"
            fontWeight="700"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            3
          </text>
        </svg>
      </div>
    </IllustrationPlate>
  );
}

function Slide4Illustration() {
  return (
    <div
      className="onboardingIllustrationStage"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200 }}
      aria-hidden
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: "50%",
          background: "rgba(255, 255, 255, 0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.18)",
        }}
      >
        <MapPinIcon size={48} color="#fff" />
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
    setIndex((i) => {
      if (i >= SLIDES.length - 1) {
        void finish();
        return i;
      }
      return i + 1;
    });
  }, [finish]);

  const handlePrimaryClick = () => {
    if (index >= SLIDES.length - 1) {
      void finish();
      return;
    }
    setIndex((i) => i + 1);
  };

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

  const slideAreaClass = isLast
    ? "onboardingSlideArea onboardingSlideAreaFinal"
    : `onboardingSlideArea onboardingSlideAreaCard ${slide.toneClass}`;

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

      <div className={slideAreaClass} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div key={index} className="onboardingIllustrationWrap onboardingIllustrationWrapAnim">
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
          className={isLast ? "onboardingPrimary onboardingPrimaryFinal" : "onboardingPrimary"}
          onClick={handlePrimaryClick}
        >
          {isLast ? "시작하기" : "다음"}
        </button>
      </div>
    </main>
  );
}
