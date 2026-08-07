/** WebView 흰 화면 자가 복구 — 첫 React 커밋이 없으면 1회 리로드, 이후 안내 화면 */

export const BOOT_FAIL_PREFS_KEY = "pindmap_boot_fail";
const RELOAD_ONCE_KEY = "pindmap_webview_reload_once";
const FIRST_COMMIT_MS = 10_000;
const OVERLAY_ID = "pindmap-webview-fail-overlay";

export type BootFailReport = {
  count: number;
  lastAt: string;
};

let committed = false;
let watchdogStarted = false;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

async function prefsGet(key: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key });
    return value;
  } catch {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

async function prefsSet(key: string, value: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value });
    return;
  } catch {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }
}

async function recordBootFail(): Promise<void> {
  try {
    let count = 0;
    let lastAt = nowIso();
    const raw = await prefsGet(BOOT_FAIL_PREFS_KEY);
    if (raw) {
      try {
        const prev = JSON.parse(raw) as BootFailReport;
        if (typeof prev.count === "number" && prev.count >= 0) count = prev.count;
      } catch {
        /* ignore */
      }
    }
    count += 1;
    lastAt = nowIso();
    await prefsSet(BOOT_FAIL_PREFS_KEY, JSON.stringify({ count, lastAt } satisfies BootFailReport));
  } catch {
    /* ignore */
  }
}

export async function loadBootFailReport(): Promise<BootFailReport | null> {
  try {
    const raw = await prefsGet(BOOT_FAIL_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BootFailReport;
    if (!parsed || typeof parsed.count !== "number" || typeof parsed.lastAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function showFailOverlay(): void {
  try {
    if (typeof document === "undefined") return;
    if (document.getElementById(OVERLAY_ID)) return;

    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.setAttribute("role", "alert");
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483000",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      boxSizing: "border-box",
      background: "#f7f4ef",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    });

    const title = document.createElement("p");
    title.textContent = "연결이 원활하지 않아요";
    Object.assign(title.style, {
      margin: "0 0 20px",
      fontSize: "17px",
      fontWeight: "600",
      color: "#1a2a7a",
      textAlign: "center",
    });

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "다시 시도";
    Object.assign(btn.style, {
      appearance: "none",
      border: "none",
      borderRadius: "12px",
      padding: "14px 28px",
      fontSize: "15px",
      fontWeight: "600",
      color: "#fff",
      background: "#1a2a7a",
      cursor: "pointer",
      fontFamily: "inherit",
    });
    btn.addEventListener("click", () => {
      try {
        window.location.reload();
      } catch {
        /* ignore */
      }
    });

    root.appendChild(title);
    root.appendChild(btn);
    document.body.appendChild(root);
  } catch {
    /* ignore */
  }
}

async function onFirstCommitTimeout(): Promise<void> {
  if (committed) return;
  try {
    void recordBootFail();
    let alreadyReloaded = false;
    try {
      alreadyReloaded = window.sessionStorage.getItem(RELOAD_ONCE_KEY) === "1";
    } catch {
      alreadyReloaded = false;
    }
    if (!alreadyReloaded) {
      try {
        window.sessionStorage.setItem(RELOAD_ONCE_KEY, "1");
      } catch {
        /* ignore */
      }
      window.location.reload();
      return;
    }
    showFailOverlay();
  } catch {
    try {
      showFailOverlay();
    } catch {
      /* ignore */
    }
  }
}

/** JS 번들 평가 직후 호출. 정상 부팅이면 첫 커밋에서 즉시 해제됨. */
export function startWebViewRecoveryWatchdog(): void {
  try {
    if (typeof window === "undefined") return;
    if (watchdogStarted || committed) return;
    watchdogStarted = true;
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      void onFirstCommitTimeout();
    }, FIRST_COMMIT_MS);
  } catch {
    /* ignore */
  }
}

/** 첫 React 커밋(useLayoutEffect)에서 호출 — 정상 부팅 시 워치독 해제 */
export function markFirstReactCommit(): void {
  try {
    if (committed) return;
    committed = true;
    if (watchdogTimer != null) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    try {
      window.sessionStorage.removeItem(RELOAD_ONCE_KEY);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

try {
  if (typeof window !== "undefined") {
    startWebViewRecoveryWatchdog();
  }
} catch {
  /* ignore */
}
