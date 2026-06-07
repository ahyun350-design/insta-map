"use client";

import { useEffect } from "react";
import { initKeyboardAccessoryBarHidden } from "@/lib/initKeyboardAccessoryBar";

/** Capacitor iOS: 키보드 accessory bar 숨김 (V-1) */
export default function KeyboardAccessoryBarInit() {
  useEffect(() => {
    void initKeyboardAccessoryBarHidden();
  }, []);

  return null;
}
