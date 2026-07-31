"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom";

type Props = {
  targetSelector: string;
  title: string;
  body: string;
  placement?: Placement;
  onDismiss: () => void;
  onTargetMissing?: () => void;
};

type TargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
};

const FIND_TIMEOUT_MS = 3000;
const FIND_INTERVAL_MS = 200;
const HOLE_PAD = 6;
const BUBBLE_GAP = 12;

function readSafeInsets() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top,0px);" +
    "padding-bottom:env(safe-area-inset-bottom,0px);";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const top = parseFloat(style.paddingTop) || 0;
  const bottom = parseFloat(style.paddingBottom) || 0;
  document.body.removeChild(probe);
  return { top, bottom };
}

export function Coachmark({
  targetSelector,
  title,
  body,
  placement = "bottom",
  onDismiss,
  onTargetMissing,
}: Props) {
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [ready, setReady] = useState(false);
  const [resolvedPlacement, setResolvedPlacement] = useState<Placement>(placement);
  const onTargetMissingRef = useRef(onTargetMissing);
  onTargetMissingRef.current = onTargetMissing;

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const maxTries = Math.ceil(FIND_TIMEOUT_MS / FIND_INTERVAL_MS);
    let missingNotified = false;

    const notifyMissing = () => {
      if (cancelled || missingNotified) return;
      missingNotified = true;
      onTargetMissingRef.current?.();
    };

    const measure = () => {
      const el = document.querySelector(targetSelector);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (cancelled) return true;
      const next: TargetRect = {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
        right: r.right,
      };
      setRect(next);

      const insets = readSafeInsets();
      const bubbleApproxH = 140;
      let place = placement;
      if (place === "bottom" && next.bottom + BUBBLE_GAP + bubbleApproxH > window.innerHeight - insets.bottom) {
        place = "top";
      } else if (place === "top" && next.top - BUBBLE_GAP - bubbleApproxH < insets.top) {
        place = "bottom";
      }
      setResolvedPlacement(place);
      setReady(true);
      return true;
    };

    if (measure()) {
      return () => {
        cancelled = true;
      };
    }

    const interval = window.setInterval(() => {
      tries += 1;
      if (measure()) {
        window.clearInterval(interval);
        return;
      }
      if (tries >= maxTries) {
        window.clearInterval(interval);
        notifyMissing();
      }
    }, FIND_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [targetSelector, placement]);

  useEffect(() => {
    if (!ready) return;
    const onReposition = () => {
      const el = document.querySelector(targetSelector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      setRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
        right: r.right,
      });
    };
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [ready, targetSelector]);

  if (!ready || !rect || typeof document === "undefined") return null;

  const holeTop = rect.top - HOLE_PAD;
  const holeLeft = rect.left - HOLE_PAD;
  const holeW = rect.width + HOLE_PAD * 2;
  const holeH = rect.height + HOLE_PAD * 2;
  const holeCenterX = holeLeft + holeW / 2;

  const bubbleStyle: CSSProperties = {
    position: "fixed",
    left: Math.min(Math.max(16, holeCenterX - 140), window.innerWidth - 16 - 280),
    width: "min(280px, calc(100vw - 32px))",
    zIndex: 100021,
  };
  if (resolvedPlacement === "bottom") {
    bubbleStyle.top = holeTop + holeH + BUBBLE_GAP;
  } else {
    bubbleStyle.bottom = window.innerHeight - holeTop + BUBBLE_GAP;
  }

  return createPortal(
    <div className="coachmarkRoot" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="coachmarkBackdrop" aria-label="닫기" onClick={onDismiss} />
      <div
        className="coachmarkHole"
        style={{
          top: holeTop,
          left: holeLeft,
          width: holeW,
          height: holeH,
        }}
        aria-hidden
      />
      <div
        className="coachmarkBubble"
        style={bubbleStyle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <div
          className={
            resolvedPlacement === "bottom" ? "coachmarkArrow coachmarkArrowUp" : "coachmarkArrow coachmarkArrowDown"
          }
          aria-hidden
        />
        <p className="coachmarkTitle">{title}</p>
        <p className="coachmarkBody">{body}</p>
        <button type="button" className="coachmarkBtn" onClick={onDismiss}>
          알겠어요
        </button>
      </div>
    </div>,
    document.body,
  );
}
