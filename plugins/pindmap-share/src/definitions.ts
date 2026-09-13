export interface ConsumePendingShareResult {
  /** Instagram URL if a fresh pending share existed; otherwise null. */
  url: string | null;
  /** Native status for diagnostics. */
  status?: "ok" | "empty" | "expired";
}

export interface PindmapSharePlugin {
  /**
   * Atomically read + delete App Group pendingShareUrl / pendingShareAt.
   * Expired (>10 min) entries are cleared and return status=expired.
   */
  consumePendingShare(): Promise<ConsumePendingShareResult>;
}
