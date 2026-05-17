import type { Session, User } from "@supabase/supabase-js";
import { SUPABASE_AUTH_STORAGE_KEY, supabase } from "./supabase";

const EXPIRY_BUFFER_SEC = 5 * 60;

type StoredAuthPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user?: User;
  currentSession?: Session;
};

function expiresAtToMs(expiresAt: number): number {
  return expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
}

function isStoredSessionValid(payload: StoredAuthPayload): boolean {
  if (!payload.access_token || !payload.user?.id) return false;
  if (typeof payload.expires_at !== "number") return true;
  return expiresAtToMs(payload.expires_at) > Date.now() + EXPIRY_BUFFER_SEC * 1000;
}

function payloadToSession(payload: StoredAuthPayload): Session | null {
  const nested = payload.currentSession;
  if (nested?.access_token && nested.user?.id && isStoredSessionValid(nested as StoredAuthPayload)) {
    return nested;
  }
  if (!isStoredSessionValid(payload)) return null;
  return {
    access_token: payload.access_token!,
    refresh_token: payload.refresh_token ?? "",
    expires_in: payload.expires_in ?? 3600,
    expires_at: payload.expires_at,
    token_type: "bearer",
    user: payload.user!,
  };
}

/** navigator.locks 우회 — localStorage에 저장된 세션만 읽기 (쓰기 없음) */
export function readSessionFromLocalStorage(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuthPayload;
    return payloadToSession(parsed);
  } catch {
    return null;
  }
}

/**
 * getSession + 타임아웃. 실패 시 localStorage 폴백.
 * 항상 Session | null 반환 (throw 없음).
 */
export async function safeGetSession(timeoutMs = 3000): Promise<Session | null> {
  try {
    const fromSdk = await Promise.race([
      supabase.auth.getSession().then(({ data, error }) => {
        if (error) return null;
        return data.session ?? null;
      }),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (fromSdk?.user?.id && fromSdk.access_token) {
      return fromSdk;
    }
  } catch {
    /* SDK hang/error → localStorage 폴백 */
  }
  return readSessionFromLocalStorage();
}
