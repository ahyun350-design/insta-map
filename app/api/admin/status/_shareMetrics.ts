/**
 * Admin share-save user count (7d).
 * Share = extract_timing.meta.entry ∈ {share, share_fallback} ∪ share_received.
 * No URL / coords in meta — entry only.
 */

type EventRow = {
  event: string;
  meta: unknown;
  user_id?: string | null;
};

export function countShareSaveUsers(rows: EventRow[]): number {
  const users = new Set<string>();
  for (const row of rows) {
    const uid = typeof row.user_id === "string" ? row.user_id.trim() : "";
    if (!uid) continue;
    if (row.event === "share_received") {
      users.add(uid);
      continue;
    }
    if (row.event === "extract_timing") {
      const meta =
        row.meta && typeof row.meta === "object"
          ? (row.meta as { entry?: unknown })
          : {};
      if (meta.entry === "share" || meta.entry === "share_fallback") {
        users.add(uid);
      }
    }
  }
  return users.size;
}
