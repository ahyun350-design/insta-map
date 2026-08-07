"use client";

import { useEffect } from "react";
import { mark } from "@/lib/bootTiming";
import { scheduleNativeSplashFallback } from "@/lib/nativeSplash";

/** 앱 어디서든 최대 대기 후 스플래시 강제 숨김 (무한 스플래시 방지) */
export default function NativeSplashInit() {
  useEffect(() => {
    try {
      mark("bundle_loaded");
    } catch {
      /* ignore */
    }
    scheduleNativeSplashFallback();
  }, []);
  return null;
}
