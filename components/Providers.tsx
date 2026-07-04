"use client";

import NativeSplashInit from "@/components/NativeSplashInit";
import { ToastProvider } from "@/components/Toast";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <NativeSplashInit />
      {children}
    </ToastProvider>
  );
}