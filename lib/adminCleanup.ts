/** Preferences key — 마지막 admin DB cleanup 시각 (ISO) */
export const ADMIN_CLEANUP_PREFS_KEY = "pindmap_last_cleanup";

const CLEANUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 관리자 앱 오픈 시 7일 간격으로 /api/admin/cleanup 호출.
 * 실패해도 throw하지 않음.
 */
export async function maybeRunAdminCleanup(accessToken: string): Promise<void> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key: ADMIN_CLEANUP_PREFS_KEY });
    const lastMs = value ? Date.parse(value) : 0;
    if (Number.isFinite(lastMs) && lastMs > 0 && Date.now() - lastMs < CLEANUP_INTERVAL_MS) {
      return;
    }

    const res = await fetch("/api/admin/cleanup", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[admin/cleanup] request failed", res.status);
      return;
    }

    await Preferences.set({
      key: ADMIN_CLEANUP_PREFS_KEY,
      value: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[admin/cleanup] skipped", err);
  }
}

export async function readAdminLastCleanupAt(): Promise<string | null> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key: ADMIN_CLEANUP_PREFS_KEY });
    const t = value?.trim();
    return t || null;
  } catch {
    return null;
  }
}
