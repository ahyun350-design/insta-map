import { Capacitor } from "@capacitor/core";
import { PindmapShare } from "@pindmap/share";
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
