"use client";

import { useLayoutEffect } from "react";
import NativeSplashInit from "@/components/NativeSplashInit";
import { ToastProvider } from "@/components/Toast";
import { markFirstReactCommit } from "@/lib/webviewRecovery";

export default function Providers({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    try {
      markFirstReactCommit();
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <ToastProvider>
      <NativeSplashInit />
      {children}
    </ToastProvider>
  );
}
