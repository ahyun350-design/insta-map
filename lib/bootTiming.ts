/** 앱 시작 단계 계측 — performance.now() 기반, 실패해도 앱에 영향 없음 */

export type BootMarkName =
  | "webview_start"
  | "bundle_loaded"
  | "auth_start"
  | "auth_done"
  | "cache_read_start"
  | "cache_read_done"
  | "loaddata_start"
  | "loaddata_done"
  | "map_sdk_start"
  | "map_sdk_ready"
  | "map_first_paint"
  | "splash_hidden";

export const BOOT_MARK_ORDER: BootMarkName[] = [
  "webview_start",
  "bundle_loaded",
  "auth_start",
  "auth_done",
  "cache_read_start",
  "cache_read_done",
  "loaddata_start",
  "loaddata_done",
  "map_sdk_start",
  "map_sdk_ready",
  "map_first_paint",
  "splash_hidden",
];

export const BOOT_TIMING_PREFS_KEY = "pindmap_boot_timing";

export type BootTimingSegment = { from: string; to: string; ms: number };

export type BootTimingReport = {
  at: string;
  totalMs: number;
  /** webview_start 기준 상대 ms */
  marks: Partial<Record<BootMarkName, number>>;
  segments: BootTimingSegment[];
};

const marks: Partial<Record<BootMarkName, number>> = {};
let persisted = false;

function nowMs(): number {
  try {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  } catch {
    return Date.now();
  }
}

try {
  if (typeof window !== "undefined") {
    marks.webview_start = nowMs();
  }
} catch {
  /* ignore */
}

export function mark(name: BootMarkName): void {
  try {
    if (marks[name] != null) return;
    marks[name] = nowMs();
    if (name === "splash_hidden") {
      void persistBootTimingReport();
    }
  } catch {
    /* ignore */
  }
}

export function getReport(): BootTimingReport {
  const start = marks.webview_start ?? nowMs();
  const rel: Partial<Record<BootMarkName, number>> = {};
  for (const name of BOOT_MARK_ORDER) {
    const t = marks[name];
    if (t == null) continue;
    rel[name] = Math.round(t - start);
  }
  const present = BOOT_MARK_ORDER.filter((n) => marks[n] != null);
  const segments: BootTimingSegment[] = [];
  for (let i = 1; i < present.length; i++) {
    const from = present[i - 1]!;
    const to = present[i]!;
    segments.push({
      from,
      to,
      ms: Math.round((marks[to] ?? 0) - (marks[from] ?? 0)),
    });
  }
  const last = present[present.length - 1];
  const totalMs = last != null ? Math.round((marks[last] ?? start) - start) : 0;
  return {
    at: new Date().toISOString(),
    totalMs,
    marks: rel,
    segments,
  };
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

export async function persistBootTimingReport(): Promise<void> {
  try {
    if (persisted) return;
    persisted = true;
    const report = getReport();
    await prefsSet(BOOT_TIMING_PREFS_KEY, JSON.stringify(report));
  } catch {
    persisted = false;
  }
}

export async function loadLastBootTimingReport(): Promise<BootTimingReport | null> {
  try {
    const raw = await prefsGet(BOOT_TIMING_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BootTimingReport;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.totalMs !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}
