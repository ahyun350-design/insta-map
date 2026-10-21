/**
 * Aggregate map_gl_timing / map_gl_fallback / map_gl_auto_off for admin status.
 */

export type MapGlWindowMetrics = {
  timingMedianFirstVisibleMs: number | null;
  timingP90FirstVisibleMs: number | null;
  fallbackCount: number;
  fallbackTop3: Array<{ code: string; count: number }>;
  autoOffDeviceCount: number;
};

export type MapGlStatusMetrics = {
  last24h: MapGlWindowMetrics;
  last7d: MapGlWindowMetrics;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function topCodes(
  codes: string[],
  limit: number,
): Array<{ code: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of codes) {
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, limit);
}

export function emptyMapGlWindow(): MapGlWindowMetrics {
  return {
    timingMedianFirstVisibleMs: null,
    timingP90FirstVisibleMs: null,
    fallbackCount: 0,
    fallbackTop3: [],
    autoOffDeviceCount: 0,
  };
}

type EventRow = {
  event: string;
  meta: unknown;
  user_id?: string | null;
  created_at?: string | null;
};

export function computeMapGlWindowMetrics(rows: EventRow[]): MapGlWindowMetrics {
  const firstVisible: number[] = [];
  const fallbackReasons: string[] = [];
  let fallbackCount = 0;
  const autoOffUsers = new Set<string>();

  for (const row of rows) {
    const meta =
      row.meta && typeof row.meta === "object"
        ? (row.meta as Record<string, unknown>)
        : {};
    if (row.event === "map_gl_timing") {
      const ms = meta.first_visible_ms;
      if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) {
        firstVisible.push(Math.round(ms));
      }
    } else if (row.event === "map_gl_fallback") {
      fallbackCount += 1;
      const reason =
        typeof meta.reason === "string" && meta.reason.trim()
          ? meta.reason.trim()
          : "unknown";
      fallbackReasons.push(reason);
    } else if (row.event === "map_gl_auto_off") {
      const uid = typeof row.user_id === "string" ? row.user_id : "";
      if (uid) autoOffUsers.add(uid);
      else autoOffUsers.add(`anon:${row.created_at ?? autoOffUsers.size}`);
    }
  }

  firstVisible.sort((a, b) => a - b);
  return {
    timingMedianFirstVisibleMs: median(firstVisible),
    timingP90FirstVisibleMs: percentile(firstVisible, 90),
    fallbackCount,
    fallbackTop3: topCodes(fallbackReasons, 3),
    autoOffDeviceCount: autoOffUsers.size,
  };
}

export function computeMapGlStatusMetrics(input: {
  rows24h: EventRow[];
  rows7d: EventRow[];
}): MapGlStatusMetrics {
  return {
    last24h: computeMapGlWindowMetrics(input.rows24h),
    last7d: computeMapGlWindowMetrics(input.rows7d),
  };
}
