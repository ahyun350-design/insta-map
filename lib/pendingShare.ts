import { Capacitor } from "@capacitor/core";
import { PindmapShare } from "@pindmap/share";
import { cleanInstagramUrl } from "@/lib/instagramUrl";
import { safeUrlHostname } from "@/lib/pindmapDeepLink";

export type ConsumePendingShareStatus =
  | "found"
  | "empty"
  | "expired"
  | "plugin_error"
  | "skipped";

export type ConsumePendingShareOutcome = {
  url: string | null;
  status: ConsumePendingShareStatus;
  errorMessage?: string;
};

/** Same TTL as native pending share (10 min). */
export const EXTENSION_STARTED_TTL_SEC = 10 * 60;

/**
 * Atomically consume App Group pending share (native only).
 * Logs diagnostic tags only — never the full URL.
 */
export async function consumePendingShareUrl(): Promise<ConsumePendingShareOutcome> {
  if (!Capacitor.isNativePlatform()) {
    return { url: null, status: "skipped" };
  }

  console.log("pending_share|check");
  try {
    const result = await PindmapShare.consumePendingShare();
    const statusRaw = result?.status;
    const trimmed = typeof result?.url === "string" ? result.url.trim() : "";

    if (statusRaw === "expired") {
      console.log("pending_share|expired");
      return { url: null, status: "expired" };
    }
    if (!trimmed) {
      console.log("pending_share|empty");
      return { url: null, status: "empty" };
    }

    const domain = safeUrlHostname(trimmed);
    console.log("pending_share|found", domain ? { domain } : {});
    return { url: trimmed, status: "found" };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn("pending_share|plugin_error", errorMessage);
    return { url: null, status: "plugin_error", errorMessage };
  }
}

/**
 * True if Share Extension already started extract for this URL recently.
 * Clears the marker when matched. Native plugin absent → false (no-op).
 */
export async function shouldSkipExtractAlreadyStartedByExtension(
  instagramUrl: string,
): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const cleaned = cleanInstagramUrl(instagramUrl);
  if (!cleaned) return false;

  try {
    const last = await PindmapShare.getLastExtensionStarted();
    const lastUrl =
      typeof last?.url === "string" ? cleanInstagramUrl(last.url) : "";
    const at = typeof last?.at === "number" ? last.at : 0;
    if (!lastUrl || at <= 0) return false;

    const ageSec = Date.now() / 1000 - at;
    if (ageSec > EXTENSION_STARTED_TTL_SEC) {
      try {
        await PindmapShare.clearLastExtensionStarted();
      } catch {
        /* ignore */
      }
      return false;
    }

    if (lastUrl !== cleaned) return false;

    console.log("pending_share|skip_extension_started");
    try {
      await PindmapShare.clearLastExtensionStarted();
    } catch {
      /* ignore */
    }
    return true;
  } catch (err) {
    console.warn(
      "pending_share|extension_started_noop",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}
