"use client";

import { useEffect, useRef } from "react";

export const EDGE_SWIPE_PRIORITY = {
  CONFIRM_MODAL: 1,
  CATEGORY_PICKER: 2,
  CURATION_DETAIL: 3,
  PLACE_SHEET: 4,
  MY_LISTS: 5,
  SAVED_SELECT: 6,
  WHATS_NEW: 7,
  HOME_SEARCH: 8,
} as const;

export type EdgeSwipePriority =
  (typeof EDGE_SWIPE_PRIORITY)[keyof typeof EDGE_SWIPE_PRIORITY];

type EdgeSwipeEntry = {
  id: string;
  priority: number;
  onClose: () => void;
  seq: number;
};

const EDGE_PX = 24;
const MIN_DX = 60;
const MAX_MS = 600;
const DX_OVER_DY = 1.5;

const stack: EdgeSwipeEntry[] = [];
let seqCounter = 0;
let listenersAttached = false;

type GestureState = {
  tracking: boolean;
  startX: number;
  startY: number;
  startAt: number;
  lastX: number;
  lastY: number;
};

let gesture: GestureState | null = null;

function getTopEntry(): EdgeSwipeEntry | null {
  if (stack.length === 0) return null;
  let best = stack[0]!;
  for (let i = 1; i < stack.length; i++) {
    const cur = stack[i]!;
    if (cur.priority < best.priority) {
      best = cur;
    } else if (cur.priority === best.priority && cur.seq > best.seq) {
      best = cur;
    }
  }
  return best;
}

function abandonGesture(): void {
  gesture = null;
}

function onTouchStart(e: TouchEvent): void {
  if (e.touches.length !== 1) {
    abandonGesture();
    return;
  }
  if (stack.length === 0) {
    abandonGesture();
    return;
  }
  const t = e.touches[0]!;
  if (t.clientX > EDGE_PX) {
    abandonGesture();
    return;
  }
  gesture = {
    tracking: true,
    startX: t.clientX,
    startY: t.clientY,
    startAt: Date.now(),
    lastX: t.clientX,
    lastY: t.clientY,
  };
}

function onTouchMove(e: TouchEvent): void {
  if (!gesture?.tracking) return;
  if (e.touches.length !== 1) {
    abandonGesture();
    return;
  }
  const t = e.touches[0]!;
  const dx = t.clientX - gesture.startX;
  const dy = Math.abs(t.clientY - gesture.startY);
  gesture.lastX = t.clientX;
  gesture.lastY = t.clientY;
  // Ignore micro-jitter until direction is clear.
  if (Math.abs(dx) < 10 && dy < 10) return;
  // Keep tracking only while clearly horizontal-right.
  if (!(dx > 0 && dx > dy * DX_OVER_DY)) {
    abandonGesture();
  }
}

function onTouchEnd(e: TouchEvent): void {
  if (!gesture?.tracking) {
    abandonGesture();
    return;
  }
  if (e.touches.length > 0) {
    abandonGesture();
    return;
  }
  const g = gesture;
  abandonGesture();
  const dx = g.lastX - g.startX;
  const elapsed = Date.now() - g.startAt;
  if (dx < MIN_DX || elapsed > MAX_MS) return;
  const top = getTopEntry();
  if (!top) return;
  try {
    top.onClose();
  } catch {
    /* ignore close errors */
  }
}

function onTouchCancel(): void {
  abandonGesture();
}

function ensureListeners(): void {
  if (listenersAttached || typeof document === "undefined") return;
  listenersAttached = true;
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: true });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  document.addEventListener("touchcancel", onTouchCancel, { passive: true });
}

/**
 * Register an overlay that can be closed by a left-edge swipe.
 * Returns unregister. Lower priority number closes first.
 */
export function registerEdgeSwipeBack(entry: {
  id: string;
  priority: number;
  onClose: () => void;
}): () => void {
  ensureListeners();
  // Replace same id if already present (latest onClose wins).
  const existing = stack.findIndex((e) => e.id === entry.id);
  if (existing >= 0) stack.splice(existing, 1);
  const next: EdgeSwipeEntry = {
    id: entry.id,
    priority: entry.priority,
    onClose: entry.onClose,
    seq: ++seqCounter,
  };
  stack.push(next);
  return () => {
    const i = stack.findIndex((e) => e.id === next.id && e.seq === next.seq);
    if (i >= 0) stack.splice(i, 1);
  };
}

/**
 * While `enabled`, register this overlay on the global edge-swipe stack.
 * Empty stack → gesture is a no-op (never router.back / app exit).
 */
export function useEdgeSwipeBack(options: {
  id: string;
  enabled: boolean;
  priority: number;
  onClose: () => void;
}): void {
  const onCloseRef = useRef(options.onClose);
  onCloseRef.current = options.onClose;

  useEffect(() => {
    if (!options.enabled) return;
    return registerEdgeSwipeBack({
      id: options.id,
      priority: options.priority,
      onClose: () => onCloseRef.current(),
    });
  }, [options.enabled, options.id, options.priority]);
}

/** Test helper — current stack size. */
export function getEdgeSwipeStackSizeForTests(): number {
  return stack.length;
}
