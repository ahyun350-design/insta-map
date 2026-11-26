/**
 * Admin: share-extension extract/start auth failures (7d), by reason.
 * Counts extract_start_auth_fail where meta.client === share_ext.
 */

type EventRow = {
  event: string;
  meta: unknown;
};

export function countShareExtAuthFailsByReason(
  rows: EventRow[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.event !== "extract_start_auth_fail") continue;
    const meta =
      row.meta && typeof row.meta === "object"
        ? (row.meta as { client?: unknown; reason?: unknown })
        : null;
    if (!meta || meta.client !== "share_ext") continue;
    const reason = typeof meta.reason === "string" ? meta.reason.trim() : "";
    if (!reason) continue;
    out[reason] = (out[reason] ?? 0) + 1;
  }
  return out;
}

/** Admin card line: expired(3) · no_header(1) or 0건 */
export function formatShareExtAuthFailSummary(
  counts: Record<string, number>,
): string {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return "0건";
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.map(([reason, n]) => `${reason}(${n})`).join(" · ");
}
