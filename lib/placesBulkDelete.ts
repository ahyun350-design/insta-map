/** Max ids accepted by POST /api/places/bulk-delete per request */
export const PLACES_BULK_DELETE_MAX = 500;

/** Show progress UI when deleting more than this many places */
export const PLACES_BULK_DELETE_PROGRESS_THRESHOLD = 100;

export function chunkPlaceIds(ids: string[], size = PLACES_BULK_DELETE_MAX): string[][] {
  if (size <= 0) return [ids];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

export function formatPlaceCount(n: number): string {
  return n.toLocaleString("ko-KR");
}
