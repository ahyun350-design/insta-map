"use client";

import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import type { PluginListenerHandle } from "@capacitor/core";
import { useEffect, useState } from "react";

export type NativeKeyboardState = {
  isVisible: boolean;
  height: number;
  willShow: boolean;
  willHide: boolean;
};

const IDLE_KEYBOARD: NativeKeyboardState = {
  isVisible: false,
  height: 0,
  willShow: false,
  willHide: false,
};

function estimateWebKeyboardHeight(): number {
  if (typeof window === "undefined") return 0;
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - vv.height);
}

/**
 * V-2a: 네이티브 키보드 이벤트 인프라.
 * iOS Capacitor → @capacitor/keyboard, 웹 → visualViewport 폴백.
 * V-2b 이전까지 사용처 없음 — 기존 visualViewport 봉합과 병행.
 */
export function useNativeKeyboard(): NativeKeyboardState {
  const [state, setState] = useState<NativeKeyboardState>(IDLE_KEYBOARD);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (Capacitor.isNativePlatform()) {
      let cancelled = false;
      const handles: PluginListenerHandle[] = [];

      const register = async () => {
        try {
          const willShowHandle = await Keyboard.addListener("keyboardWillShow", ({ keyboardHeight }) => {
            setState({
              isVisible: true,
              willShow: true,
              willHide: false,
              height: keyboardHeight,
            });
          });
          const didShowHandle = await Keyboard.addListener("keyboardDidShow", ({ keyboardHeight }) => {
            setState((prev) => ({
              ...prev,
              willShow: false,
              height: keyboardHeight,
            }));
          });
          const willHideHandle = await Keyboard.addListener("keyboardWillHide", () => {
            setState((prev) => ({
              ...prev,
              willHide: true,
            }));
          });
          const didHideHandle = await Keyboard.addListener("keyboardDidHide", () => {
            setState(IDLE_KEYBOARD);
          });

          if (cancelled) {
            await Promise.all(
              [willShowHandle, didShowHandle, willHideHandle, didHideHandle].map((h) => h.remove()),
            );
            return;
          }

          handles.push(willShowHandle, didShowHandle, willHideHandle, didHideHandle);
        } catch (err) {
          console.warn("[useNativeKeyboard] native listener setup failed", err);
        }
      };

      void register();

      return () => {
        cancelled = true;
        void Promise.all(handles.map((h) => h.remove()));
      };
    }

    const vv = window.visualViewport;
    if (!vv) return;

    const syncFromViewport = () => {
      const height = estimateWebKeyboardHeight();
      if (height > 0) {
        setState({
          isVisible: true,
          height,
          willShow: false,
          willHide: false,
        });
      } else {
        setState(IDLE_KEYBOARD);
      }
    };

    syncFromViewport();
    vv.addEventListener("resize", syncFromViewport);

    return () => {
      vv.removeEventListener("resize", syncFromViewport);
    };
  }, []);

  return state;
}
