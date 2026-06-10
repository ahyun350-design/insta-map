"use client";

import { useCallback, useRef, useState } from "react";
import { inAppNotificationDedupeKey, type InAppNotificationItem } from "./inAppNotification";

const GAP_AFTER_DISMISS_MS = 200;
const GAP_AFTER_INTERRUPT_MS = 1000;
const DEDUPE_MS = 1000;

export function useInAppNotifications() {
  const [current, setCurrent] = useState<InAppNotificationItem | null>(null);
  const queueRef = useRef<InAppNotificationItem[]>([]);
  const showingRef = useRef(false);
  const pumpTimerRef = useRef<number | null>(null);
  const lastDedupeRef = useRef<Map<string, number>>(new Map());

  const clearPumpTimer = useCallback(() => {
    if (pumpTimerRef.current !== null) {
      window.clearTimeout(pumpTimerRef.current);
      pumpTimerRef.current = null;
    }
  }, []);

  const pump = useCallback(
    (gapMs: number) => {
      clearPumpTimer();
      pumpTimerRef.current = window.setTimeout(() => {
        pumpTimerRef.current = null;
        const next = queueRef.current.shift();
        if (!next) {
          showingRef.current = false;
          setCurrent(null);
          return;
        }
        showingRef.current = true;
        setCurrent(next);
      }, gapMs);
    },
    [clearPumpTimer],
  );

  const dismissCurrent = useCallback(
    (gapMs: number) => {
      setCurrent(null);
      pump(gapMs);
    },
    [pump],
  );

  const enqueue = useCallback(
    (item: InAppNotificationItem) => {
      const dedupeKey = inAppNotificationDedupeKey(item);
      const now = Date.now();
      const lastAt = lastDedupeRef.current.get(dedupeKey) ?? 0;
      if (now - lastAt < DEDUPE_MS) return;
      lastDedupeRef.current.set(dedupeKey, now);

      queueRef.current.push(item);
      if (!showingRef.current) {
        showingRef.current = true;
        pump(0);
        return;
      }
      clearPumpTimer();
      setCurrent(null);
      pump(GAP_AFTER_INTERRUPT_MS);
    },
    [clearPumpTimer, pump],
  );

  const handleDismiss = useCallback(() => {
    dismissCurrent(GAP_AFTER_DISMISS_MS);
  }, [dismissCurrent]);

  return { current, enqueue, handleDismiss };
}
