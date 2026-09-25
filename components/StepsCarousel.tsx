"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WhatsNewStep } from "@/lib/whatsNew";

/** Lazy image — on error/missing, render nothing (text-only step remains). */
export function LazyStepImage({
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

type StepsCarouselProps = {
  steps: WhatsNewStep[];
  /** Optional aria label for the track region */
  ariaLabel?: string;
};

/**
 * Horizontal how-to steps (Whats New + onboarding share slide).
 * Touch events stopPropagation so parent slide swipers do not advance.
 */
export function StepsCarousel({
  steps,
  ariaLabel = "설정 단계",
}: StepsCarouselProps) {
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

  const stopParentSwipe = (e: React.TouchEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="whatsNewStepsCarousel"
      data-testid="steps-carousel"
      onTouchStart={stopParentSwipe}
      onTouchMove={stopParentSwipe}
      onTouchEnd={stopParentSwipe}
    >
      <div
        ref={scrollerRef}
        className="whatsNewStepsTrack"
        role="region"
        aria-label={ariaLabel}
        data-testid="steps-carousel-track"
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
      <p className="whatsNewStepProgress" data-testid="steps-carousel-progress">
        {stepIndex + 1} / {steps.length}
      </p>
    </div>
  );
}
