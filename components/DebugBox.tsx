"use client";

import { useCallback, useEffect, useState } from "react";
import { debugLog, type DebugLogState } from "@/lib/debugLog";

const HIDE_KEY = "debugBoxHidden";

function formatSendSteps(steps: DebugLogState["sendSteps"]): string {
  if (steps.length === 0) return "-";
  return steps
    .map((s) => (s.ms !== undefined ? `${s.step}:${s.ms}ms` : s.step))
    .join(" → ");
}

export default function DebugBox() {
  const [enabled, setEnabled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [snap, setSnap] = useState<DebugLogState>(debugLog.getState());

  useEffect(() => {
    const on = debugLog.isEnabled();
    setEnabled(on);
    if (!on) return;
    try {
      setHidden(sessionStorage.getItem(HIDE_KEY) === "1");
    } catch {
      setHidden(false);
    }
    setSnap(debugLog.getState());
    return debugLog.subscribe(() => setSnap(debugLog.getState()));
  }, []);

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(HIDE_KEY, "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  }, []);

  if (!enabled || hidden) return null;

  const warmupMs =
    snap.warmupStartedAt !== null && snap.warmupFinishedAt !== null
      ? snap.warmupFinishedAt - snap.warmupStartedAt
      : null;

  const bgLabel =
    snap.bgDurationMs !== null ? `${(snap.bgDurationMs / 1000).toFixed(1)}s` : "-";

  const warmAttemptsSuffix =
    snap.warmAttempts !== null && snap.warmAttempts > 1 ? ` [x${snap.warmAttempts}]` : "";

  const warmLabel =
    snap.warmupResult !== null
      ? `${snap.warmupResult}${warmupMs !== null ? ` (${warmupMs}ms)` : ""}${warmAttemptsSuffix}`
      : "-";

  const refreshLabel = `${snap.refreshResult ?? "-"}${snap.refreshMs !== null ? ` ${snap.refreshMs}ms` : ""}`;

  const sessLabel = snap.lastGetSession
    ? `${snap.lastGetSession.ok ? "ok" : "fail"} ${snap.lastGetSession.ms}ms`
    : "-";

  return (
    <div
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 8px)",
        right: 8,
        zIndex: 99999,
        maxWidth: 220,
        padding: "6px 8px",
        borderRadius: 6,
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10,
        lineHeight: 1.45,
        wordBreak: "break-word",
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="디버그 박스 닫기"
        style={{
          position: "absolute",
          top: 2,
          right: 4,
          border: "none",
          background: "transparent",
          color: "#aaa",
          fontSize: 12,
          lineHeight: 1,
          padding: "2px 4px",
          cursor: "pointer",
        }}
      >
        ×
      </button>
      <div style={{ paddingRight: 16 }}>
        <div>BG: {bgLabel}</div>
        <div>WARM: {warmLabel}</div>
        <div>AUTH: {snap.lastAuthEvent ?? "-"}</div>
        <div>SESS: {sessLabel}</div>
        <div>RT: {snap.realtimeStatus ?? "-"}</div>
        <div>SEND: {formatSendSteps(snap.sendSteps)}</div>
      </div>
    </div>
  );
}
