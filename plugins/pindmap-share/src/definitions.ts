export interface ConsumePendingShareResult {
  /** Instagram URL if a fresh pending share existed; otherwise null. */
  url: string | null;
  /** Native status for diagnostics. */
  status?: "ok" | "empty" | "expired";
}

export interface LastExtensionStartedResult {
  /** URL Extension already POSTed to /api/extract/start; null if none. */
  url: string | null;
  /** Unix seconds when Extension started extract. */
  at: number | null;
}

export interface PindmapSharePlugin {
  /**
   * Atomically read + delete App Group pendingShareUrl / pendingShareAt.
   * Expired (>10 min) entries are cleared and return status=expired.
   */
  consumePendingShare(): Promise<ConsumePendingShareResult>;

  /**
   * Read App Group lastExtensionStartedUrl / lastExtensionStartedAt (no delete).
   * Native absent → empty. Used so app foreground does not re-extract.
   */
  getLastExtensionStarted(): Promise<LastExtensionStartedResult>;

  /** Clear lastExtensionStartedUrl / at after skip (or TTL). */
  clearLastExtensionStarted(): Promise<void>;
}
