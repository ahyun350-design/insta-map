"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { WhatsNewPack, WhatsNewSlide } from "@/lib/whatsNew";
import { setWhatsNewSeen } from "@/lib/whatsNew";
import { LazyStepImage, StepsCarousel } from "@/components/StepsCarousel";

type Props = {
  pack: WhatsNewPack;
  onClose: () => void;
};

function SlideBody({ slide }: { slide: WhatsNewSlide }) {
  if (slide.steps && slide.steps.length > 0) {
    return <StepsCarousel steps={slide.steps} />;
  }

  return (
    <div className="whatsNewHeroMedia">
      <LazyStepImage src={slide.imageSrc} alt={slide.imageAlt} priority />
    </div>
  );
}

export function WhatsNewModal({ pack, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const slide = pack.slides[index]!;
  const isLast = index >= pack.slides.length - 1;

  const finish = useCallback(async () => {
    await setWhatsNewSeen(pack.id);
    onClose();
  }, [pack.id, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  // Prefetch next pack-slide hero (multiselect) while on slide 0
  useEffect(() => {
    const next = pack.slides[index + 1];
    if (!next?.imageSrc) return;
    const img = new Image();
    img.src = next.imageSrc;
  }, [pack.slides, index]);

  const goNext = () => {
    if (isLast) {
      void finish();
      return;
    }
    setIndex((i) => i + 1);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="whatsNewRoot"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-title"
      data-testid="whats-new-modal"
    >
      <button
        type="button"
        className="whatsNewBackdrop"
        aria-label="닫기"
        data-testid="whats-new-close"
        onClick={() => void finish()}
      />
      <div className="whatsNewCard">
        <header className="whatsNewHeader">
          <span className="whatsNewEyebrow">새 기능</span>
          <button
            type="button"
            className="whatsNewSkip"
            data-testid="whats-new-skip"
            onClick={() => void finish()}
          >
            건너뛰기
          </button>
        </header>

        <div className="whatsNewBody" key={slide.id}>
          <h2 id="whats-new-title" className="whatsNewTitle">
            {slide.title}
          </h2>
          <p className="whatsNewDescription">{slide.body}</p>
          <SlideBody slide={slide} />
        </div>

        <footer className="whatsNewFooter">
          <div className="whatsNewDots" role="tablist" aria-label="안내 진행">
            {pack.slides.map((s, i) => (
              <span
                key={s.id}
                className={i === index ? "whatsNewDot whatsNewDotActive" : "whatsNewDot"}
                aria-current={i === index ? "step" : undefined}
              />
            ))}
          </div>
          <button type="button" className="whatsNewPrimary" onClick={goNext}>
            {isLast ? "시작하기" : "다음"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
