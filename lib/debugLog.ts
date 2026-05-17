export type KbResetAttempt = {
  n: number;
  docScroll: number;
  vvOffset: number | null;
  htmlReflow?: boolean;
};

export type KbResetDiag = {
  at: number;
  scrollY: number;
  docScroll: number;
  bodyScroll: number | null;
  vvOffset: number | null;
  blurredActive: string | null;
  after1: {
    scrollY: number;
    docScroll: number;
    bodyScroll: number | null;
    vvOffset: number | null;
  } | null;
  attempts: KbResetAttempt[];
};

export type DebugLogState = {
  bgEnteredAt: number | null;
  bgDurationMs: number | null;
  warmupStartedAt: number | null;
  warmupFinishedAt: number | null;
  warmupResult: "ok" | "fail" | "pending" | null;
  warmAttempts: number | null;
  refreshResult: "ok" | "fail" | "pending" | null;
  refreshMs: number | null;
  lastAuthEvent: string | null;
  lastGetSession: { ok: boolean; ms: number; at: number } | null;
  sendSteps: Array<{ step: string; at: number; ms?: number }>;
  realtimeStatus: string | null;
  kbReset: KbResetDiag | null;
};

const INITIAL_STATE: DebugLogState = {
  bgEnteredAt: null,
  bgDurationMs: null,
  warmupStartedAt: null,
  warmupFinishedAt: null,
  warmupResult: null,
  warmAttempts: null,
  refreshResult: null,
  refreshMs: null,
  lastAuthEvent: null,
  lastGetSession: null,
  sendSteps: [],
  realtimeStatus: null,
  kbReset: null,
};

let state: DebugLogState = { ...INITIAL_STATE };
const listeners = new Set<() => void>();

const FORCE_DEBUG = false;

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const enabled =
      FORCE_DEBUG ||
      localStorage.getItem("debugMode") === "1" ||
      new URLSearchParams(window.location.search).get("debug") === "1";
    return enabled;
  } catch {
    return FORCE_DEBUG;
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
