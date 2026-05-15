export type DebugLogState = {
  bgEnteredAt: number | null;
  bgDurationMs: number | null;
  warmupStartedAt: number | null;
  warmupFinishedAt: number | null;
  warmupResult: "ok" | "fail" | "pending" | null;
  lastAuthEvent: string | null;
  lastGetSession: { ok: boolean; ms: number; at: number } | null;
  sendSteps: Array<{ step: string; at: number; ms?: number }>;
  realtimeStatus: string | null;
};

const INITIAL_STATE: DebugLogState = {
  bgEnteredAt: null,
  bgDurationMs: null,
  warmupStartedAt: null,
  warmupFinishedAt: null,
  warmupResult: null,
  lastAuthEvent: null,
  lastGetSession: null,
  sendSteps: [],
  realtimeStatus: null,
};

let state: DebugLogState = { ...INITIAL_STATE };
const listeners = new Set<() => void>();

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem("debugMode") === "1") return true;
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

export const debugLog = {
  isEnabled,

  getState(): DebugLogState {
    return state;
  },

  set(partial: Partial<DebugLogState>): void {
    if (!isEnabled()) return;
    try {
      state = { ...state, ...partial };
      notify();
    } catch {
      /* ignore */
    }
  },

  pushSendStep(step: string, ms?: number): void {
    if (!isEnabled()) return;
    try {
      const next = [...state.sendSteps, { step, at: Date.now(), ...(ms !== undefined ? { ms } : {}) }];
      state = { ...state, sendSteps: next.slice(-10) };
      notify();
    } catch {
      /* ignore */
    }
  },

  resetSendSteps(): void {
    if (!isEnabled()) return;
    try {
      state = { ...state, sendSteps: [] };
      notify();
    } catch {
      /* ignore */
    }
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
