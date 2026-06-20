"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setOnboardingSeen } from "@/lib/onboarding";

const SLIDES = [
  {
    title: "인스타 릴스를 지도에 콕",
    description: "맘에 든 릴스 URL 붙여넣으면 자동으로 핀.",
    Illustration: ReelToPinIllustration,
  },
  {
    title: "검색하고 걸어가기까지",
    description: "카카오·네이버 없이 핀맵 안에서 도보 길찾기.",
    Illustration: WalkDirectionsIllustration,
  },
  {
    title: "나만의 코스로 묶기",
    description: "가고 싶은 곳들을 순서대로 코스로, 도보로 안내.",
    Illustration: CourseIllustration,
  },
  {
    title: "친구들의 추천도 지도에서",
    description: "큐레이션을 지도에서 발견.",
    Illustration: SocialIllustration,
  },
] as const;

function ReelToPinIllustration() {
  return (
    <svg viewBox="0 0 280 200" className="onboardingIllustration" aria-hidden>
      <rect x="24" y="28" width="88" height="144" rx="14" fill="#fff" stroke="#e8ecf7" strokeWidth="2" />
      <rect x="34" y="40" width="68" height="88" rx="8" fill="#fce6b7" />
      <polygon points="58,68 58,92 76,80" fill="#513229" opacity="0.85" />
      <path d="M34 136h68" stroke="#ddd" strokeWidth="2" strokeLinecap="round" />
      <path d="M130 100h36" stroke="#1a2a7a" strokeWidth="2.5" strokeLinecap="round" markerEnd="url(#arrow)" />
      <path
        d="M190 52c0-14 11-25 25-25s25 11 25 25c0 19-25 45-25 45S190 71 190 52z"
        fill="#1a2a7a"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle cx="215" cy="52" r="10" fill="#fff" />
      <text x="215" y="56" textAnchor="middle" fontSize="11" fill="#1a2a7a" fontWeight="700">
        📍
      </text>
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#1a2a7a" />
        </marker>
      </defs>
    </svg>
  );
}

function WalkDirectionsIllustration() {
  return (
    <svg viewBox="0 0 280 200" className="onboardingIllustration" aria-hidden>
      <rect x="20" y="24" width="240" height="152" rx="16" fill="#f5f7fd" stroke="#e4e9f7" strokeWidth="2" />
      <path
        d="M48 140 Q90 110 120 128 T180 96 T228 72"
        fill="none"
        stroke="#16a34a"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="8 6"
      />
      <circle cx="48" cy="140" r="8" fill="#1a2a7a" stroke="#fff" strokeWidth="2" />
      <path
        d="M228 72c0-10 8-18 18-18s18 8 18 18c0 14-18 32-18 32S228 86 228 72z"
        fill="#513229"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle cx="246" cy="72" r="6" fill="#fff" />
      <g fill="#1a2a7a" opacity="0.7">
        <ellipse cx="130" cy="158" rx="5" ry="8" />
        <path d="M130 148v-12M126 152l4-4 4 4" stroke="#1a2a7a" strokeWidth="2" fill="none" strokeLinecap="round" />
        <ellipse cx="158" cy="152" rx="5" ry="8" />
        <path d="M158 142v-12M154 146l4-4 4 4" stroke="#1a2a7a" strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function CourseIllustration() {
  const pins = [
    { x: 56, y: 130, n: "1" },
    { x: 128, y: 88, n: "2" },
    { x: 210, y: 118, n: "3" },
  ];
  return (
    <svg viewBox="0 0 280 200" className="onboardingIllustration" aria-hidden>
      <rect x="20" y="24" width="240" height="152" rx="16" fill="#f5f7fd" stroke="#e4e9f7" strokeWidth="2" />
      <path
        d="M56 130 L128 88 L210 118"
        fill="none"
        stroke="#1a2a7a"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pins.map((pin) => (
        <g key={pin.n}>
          <path
            d={`M${pin.x} ${pin.y - 18}c-8 0-14 6-14 14c0 10 14 26 14 26s14-16 14-26c0-8-6-14-14-14z`}
            fill="#1a2a7a"
            stroke="#fff"
            strokeWidth="1.5"
          />
          <circle cx={pin.x} cy={pin.y - 16} r="9" fill="#fff" />
          <text x={pin.x} y={pin.y - 12} textAnchor="middle" fontSize="11" fill="#1a2a7a" fontWeight="700">
            {pin.n}
          </text>
        </g>
      ))}
    </svg>
  );
}

function SocialIllustration() {
  return (
    <svg viewBox="0 0 280 200" className="onboardingIllustration" aria-hidden>
      <rect x="20" y="24" width="240" height="152" rx="16" fill="#f5f7fd" stroke="#e4e9f7" strokeWidth="2" />
      <circle cx="72" cy="88" r="22" fill="#d8ebf9" stroke="#1a2a7a" strokeWidth="2" />
      <circle cx="72" cy="82" r="8" fill="#1a2a7a" />
      <path d="M56 104c4-8 12-12 16-12s12 4 16 12" fill="none" stroke="#1a2a7a" strokeWidth="2" strokeLinecap="round" />
      <circle cx="208" cy="88" r="22" fill="#fce6b7" stroke="#513229" strokeWidth="2" />
      <circle cx="208" cy="82" r="8" fill="#513229" />
      <path d="M192 104c4-8 12-12 16-12s12 4 16 12" fill="none" stroke="#513229" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M118 100c0-12 10-22 22-22s22 10 22 22c0 16-22 38-22 38S118 116 118 100z"
        fill="#1a2a7a"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle cx="140" cy="100" r="8" fill="#fff" />
      <path
        d="M148 132c6 4 14 6 22 6 8 0 16-2 22-6"
        fill="#e53935"
        stroke="#fff"
        strokeWidth="1.5"
        transform="translate(0,-8)"
      />
      <text x="140" y="168" textAnchor="middle" fontSize="22">
        ♥
      </text>
    </svg>
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
    <main className="onboardingRoot">
      <header className="onboardingHeader">
        <span className="onboardingBrand">PindMap</span>
        <button type="button" className="onboardingSkip" onClick={() => void finish()}>
          건너뛰기
        </button>
      </header>

      <div
        className="onboardingSlideArea"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="onboardingIllustrationWrap">
          <slide.Illustration />
        </div>
        <h1 className="onboardingTitle">{slide.title}</h1>
        <p className="onboardingDescription">{slide.description}</p>
      </div>

      <div className="onboardingFooter">
        <div className="onboardingDots" role="tablist" aria-label="온보딩 진행">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${i + 1}번째 소개`}
              className={i === index ? "onboardingDot onboardingDotActive" : "onboardingDot"}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className={isLast ? "onboardingPrimary onboardingPrimaryLarge" : "onboardingPrimary"}
          onClick={goNext}
        >
          {isLast ? "시작하기" : "다음"}
        </button>
      </div>
    </main>
  );
}
