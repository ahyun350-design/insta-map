"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WhatsNewPack, WhatsNewSlide, WhatsNewStep } from "@/lib/whatsNew";
import { setWhatsNewSeen } from "@/lib/whatsNew";

type Props = {
  pack: WhatsNewPack;
  onClose: () => void;
};

/** Lazy image — on error/missing, render nothing (text-only step remains). */
function LazyStepImage({
  src,
  alt,
  priority,
}: {
  src?: string;
  alt?: string;
  /** Current / next step: eager; others lazy */
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      className="whatsNewMediaImg"
      src={src}
      alt={alt ?? ""}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function StepsCarousel({ steps }: { steps: WhatsNewStep[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const syncIndexFromScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth <= 0) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setStepIndex(Math.max(0, Math.min(steps.length - 1, next)));
  }, [steps.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => syncIndexFromScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [syncIndexFromScroll]);

  const goTo = (i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(steps.length - 1, i));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
    setStepIndex(clamped);
  };

  return (
    <div className="whatsNewStepsCarousel">
      <div
        ref={scrollerRef}
        className="whatsNewStepsTrack"
        role="region"
        aria-label="설정 단계"
      >
        {steps.map((step, i) => (
          <div
            key={step.n}
            className="whatsNewStepPane"
            aria-hidden={i !== stepIndex}
          >
            <div className="whatsNewStepPaneHeader">
              <span className="whatsNewStepBadge" aria-hidden>
                {step.n}
              </span>
              <div className="whatsNewStepPaneCopy">
                <p className="whatsNewStepText">{step.text}</p>
                {step.hint ? <p className="whatsNewStepHint">{step.hint}</p> : null}
              </div>
            </div>
            <div className="whatsNewStepMedia">
              <LazyStepImage
                src={step.imageSrc}
                alt={step.imageAlt}
                priority={i === stepIndex || i === stepIndex + 1}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="whatsNewStepNav">
        <button
          type="button"
          className="whatsNewStepNavBtn"
          disabled={stepIndex <= 0}
          onClick={() => goTo(stepIndex - 1)}
          aria-label="이전 단계"
        >
          ‹
        </button>
        <div className="whatsNewStepDots" role="tablist" aria-label="단계">
          {steps.map((step, i) => (
            <button
              key={step.n}
              type="button"
              className={
                i === stepIndex
                  ? "whatsNewStepDot whatsNewStepDotActive"
                  : "whatsNewStepDot"
              }
              aria-label={`${step.n}단계`}
              aria-current={i === stepIndex ? "step" : undefined}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className="whatsNewStepNavBtn"
          disabled={stepIndex >= steps.length - 1}
          onClick={() => goTo(stepIndex + 1)}
          aria-label="다음 단계"
        >
          ›
        </button>
      </div>
      <p className="whatsNewStepProgress">
        {stepIndex + 1} / {steps.length}
      </p>
    </div>
  );
}

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
