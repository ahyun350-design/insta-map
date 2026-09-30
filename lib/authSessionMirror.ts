/**
 * Write-only Supabase session mirror for Share Extension (Shared Keychain).
 *
 * Separate onAuthStateChange from useUser — does not touch watchdog,
 * safeGetSession, or loggingOutRef.
 *
 * Native plugin absent / web → no-op (try/catch).
 */
import { Capacitor } from "@capacitor/core";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

let started = false;
let unsubscribe: (() => void) | null = null;

async function safeMirror(session: Session): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { PindmapAuthSession } = await import("@pindmap/auth-session");
    const accessToken = session.access_token;
    const refreshToken = session.refresh_token;
    if (!accessToken || !refreshToken || !session.user?.id) return;
    await PindmapAuthSession.mirrorSession({
      accessToken,
      refreshToken,
      expiresAt:
        typeof session.expires_at === "number" ? session.expires_at : null,
      userId: session.user.id,
    });
  } catch (err) {
    console.warn(
      "[authSessionMirror] mirror no-op",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function clearMirroredAuthSession(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { PindmapAuthSession } = await import("@pindmap/auth-session");
    await PindmapAuthSession.clearSession();
  } catch (err) {
    console.warn(
      "[authSessionMirror] clear no-op",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function onAuthEvent(
  event: AuthChangeEvent,
  session: Session | null,
): Promise<void> {
  if (event === "SIGNED_OUT" || !session?.access_token) {
    await clearMirroredAuthSession();
    return;
  }
  // INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED …
  await safeMirror(session);
}

/** Idempotent. Call once from app shell; returns disposer. */
export function startAuthSessionMirror(): () => void {
  if (started) {
    return () => {
      /* keep singleton until explicit stop */
    };
  }
  started = true;

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    // Defer off the sync auth callback (same #762 pattern as useUser)
    setTimeout(() => {
      void onAuthEvent(event, session);
    }, 0);
  });

  unsubscribe = () => {
    subscription.unsubscribe();
    unsubscribe = null;
    started = false;
  };

  return () => {
    unsubscribe?.();
  };
}
