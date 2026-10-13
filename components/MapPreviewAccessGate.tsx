"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MAP_PREVIEW_ADMIN_USER_ID } from "@/lib/mapPreviewAccess";
import { supabase } from "@/lib/supabase";

type Props = {
  /** Server already validated ?e2e= token */
  e2eGranted: boolean;
  children: ReactNode;
};

/**
 * /map-preview: admin session OR server-validated e2e token.
 * Unauthenticated visitors see a simple denied state (no map mount).
 */
export default function MapPreviewAccessGate({ e2eGranted, children }: Props) {
  const [state, setState] = useState<"loading" | "ok" | "denied">(
    e2eGranted ? "ok" : "loading",
  );

  useEffect(() => {
    if (e2eGranted) {
      setState("ok");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        if (data.user?.id === MAP_PREVIEW_ADMIN_USER_ID) {
          setState("ok");
        } else {
          setState("denied");
        }
      } catch {
        if (!cancelled) setState("denied");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [e2eGranted]);

  if (state === "loading") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#8f93a6",
          fontSize: 14,
        }}
      >
        확인 중…
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div
        data-testid="map-preview-denied"
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#8f93a6",
          fontSize: 14,
        }}
      >
        접근할 수 없어요
      </div>
    );
  }

  return <>{children}</>;
}
