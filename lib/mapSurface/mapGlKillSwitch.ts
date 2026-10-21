/**
 * Remote MapLibre kill switch via public.app_config key=map_gl_enabled.
 * false / unread / timeout / error → Kakao for everyone (incl. admin local force).
 * Fetch: once at boot + on foreground. Timeout 1.5s.
 */

export const MAP_GL_CONFIG_KEY = "map_gl_enabled";
export const MAP_GL_KILL_FETCH_TIMEOUT_MS = 1500;

/** Cached remote allow. null = never successfully read (treat as Kakao). */
let remoteEnabled: boolean | null = null;
let lastFetchAt = 0;
let fetchInFlight: Promise<boolean> | null = null;

type E2eWindow = Window & {
  __PINDMAP_E2E_MAP_GL_REMOTE__?: boolean | null;
};

function e2eRemoteOverride(): boolean | null | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const v = (window as E2eWindow).__PINDMAP_E2E_MAP_GL_REMOTE__;
    if (v === true || v === false || v === null) return v;
    return undefined;
  } catch {
    return undefined;
  }
}

/** true only when remote config explicitly allows MapLibre. */
export function isMapGlRemoteAllowed(): boolean {
  const e2e = e2eRemoteOverride();
  if (e2e === true) return true;
  if (e2e === false || e2e === null) return false;
  return remoteEnabled === true;
}

/** Last known remote value for admin UI (null = unread / failed). */
export function getMapGlRemoteEnabledCached(): boolean | null {
  const e2e = e2eRemoteOverride();
  if (e2e === true || e2e === false) return e2e;
  if (e2e === null) return null;
  return remoteEnabled;
}

/** Test/admin helper: set cache without network. */
export function setMapGlRemoteEnabledForTests(value: boolean | null): void {
  remoteEnabled = value;
}

function parseEnabledValue(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  if (raw && typeof raw === "object") {
    const o = raw as { enabled?: unknown; value?: unknown };
    if (typeof o.enabled === "boolean") return o.enabled;
    if (typeof o.value === "boolean") return o.value;
  }
  return null;
}

/**
 * Fetch map_gl_enabled. On failure/timeout → cache false (Kakao).
 * Returns whether MapLibre is remotely allowed after this read.
 */
export async function refreshMapGlRemoteKill(): Promise<boolean> {
  const e2e = e2eRemoteOverride();
  if (e2e === true || e2e === false) {
    remoteEnabled = e2e;
    lastFetchAt = Date.now();
    return e2e;
  }
  if (e2e === null) {
    remoteEnabled = false;
    lastFetchAt = Date.now();
    return false;
  }

  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    try {
      const { supabase } = await import("@/lib/supabase");
      const timeoutPromise = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), MAP_GL_KILL_FETCH_TIMEOUT_MS);
      });
      const queryPromise = supabase
        .from("app_config")
        .select("value")
        .eq("key", MAP_GL_CONFIG_KEY)
        .maybeSingle()
        .then(
          (r) =>
            r as {
              data: { value: unknown } | null;
              error: { message?: string } | null;
            },
        );

      const raced = await Promise.race([queryPromise, timeoutPromise]);
      if (raced === "timeout") {
        remoteEnabled = false;
        lastFetchAt = Date.now();
        return false;
      }
      if (raced.error) {
        remoteEnabled = false;
        lastFetchAt = Date.now();
        return false;
      }
      const parsed = parseEnabledValue(raced.data?.value);
      // Missing row or unparsable → Kakao (safe).
      remoteEnabled = parsed === true;
      lastFetchAt = Date.now();
      return remoteEnabled;
    } catch {
      remoteEnabled = false;
      lastFetchAt = Date.now();
      return false;
    } finally {
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}

export function getMapGlKillLastFetchAt(): number {
  return lastFetchAt;
}

/** Reset module state (unit tests). */
export function resetMapGlKillSwitchForTests(): void {
  remoteEnabled = null;
  lastFetchAt = 0;
  fetchInFlight = null;
}
