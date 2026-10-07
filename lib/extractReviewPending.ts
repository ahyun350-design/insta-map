/**
 * Extract complete review helpers.
 * Pending/done localStorage is a cache; server `extract_jobs.reviewed_at` is source of truth.
 */

export type ExtractReviewPlace = {
  id: string;
  name: string;
  address: string;
  category: string;
  subcategory?: string | null;
};

export type ExtractReviewPending = {
  jobId: string;
  places: ExtractReviewPlace[];
  /** ms epoch when extract completed / review was queued */
  at: number;
  /** When true, 1-place complete card may be restored (e2e / tests). Production multi-only. */
  allowSingle?: boolean;
};

export const EXTRACT_REVIEW_PENDING_KEY = "pindmap_extract_review_pending";
export const EXTRACT_REVIEW_DONE_KEY = "pindmap_extract_review_done";

/** Do not surface reviews older than this */
export const EXTRACT_REVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const DONE_IDS_MAX = 40;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readExtractReviewPending(): ExtractReviewPending | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(EXTRACT_REVIEW_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExtractReviewPending;
    if (!parsed || typeof parsed.jobId !== "string" || !Array.isArray(parsed.places)) {
      return null;
    }
    if (typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return null;
    const places = parsed.places.filter(
      (p): p is ExtractReviewPlace =>
        !!p &&
        typeof p.id === "string" &&
        p.id.trim().length > 0 &&
        typeof p.name === "string" &&
        typeof p.address === "string" &&
        typeof p.category === "string",
    );
    if (places.length === 0) return null;
    return {
      jobId: parsed.jobId.trim(),
      places,
      at: parsed.at,
      ...(parsed.allowSingle ? { allowSingle: true } : {}),
    };
  } catch {
    return null;
  }
}

export function writeExtractReviewPending(pending: ExtractReviewPending): void {
  if (!canUseStorage()) return;
  if (pending.places.length < 2 && !pending.allowSingle) {
    clearExtractReviewPending();
    return;
  }
  if (pending.places.length === 0) {
    clearExtractReviewPending();
    return;
  }
  try {
    window.localStorage.setItem(EXTRACT_REVIEW_PENDING_KEY, JSON.stringify(pending));
  } catch {
    /* quota */
  }
}

export function clearExtractReviewPending(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(EXTRACT_REVIEW_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export function isExtractReviewFresh(at: number, now = Date.now()): boolean {
  return now - at >= 0 && now - at <= EXTRACT_REVIEW_MAX_AGE_MS;
}

function readDoneJobIds(): string[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(EXTRACT_REVIEW_DONE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  } catch {
    return [];
  }
}

export function markExtractReviewDone(jobId: string): void {
  if (!canUseStorage()) return;
  const id = jobId.trim();
  if (!id) return;
  clearExtractReviewPending();
  try {
    const prev = readDoneJobIds().filter((x) => x !== id);
    const next = [id, ...prev].slice(0, DONE_IDS_MAX);
    window.localStorage.setItem(EXTRACT_REVIEW_DONE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function isExtractReviewDone(jobId: string): boolean {
  const id = jobId.trim();
  if (!id) return false;
  return readDoneJobIds().includes(id);
}

/** Latest fresh pending from localStorage, or null */
export function getFreshExtractReviewPending(now = Date.now()): ExtractReviewPending | null {
  const pending = readExtractReviewPending();
  if (!pending) return null;
  if (!isExtractReviewFresh(pending.at, now)) {
    clearExtractReviewPending();
    return null;
  }
  if (isExtractReviewDone(pending.jobId)) {
    clearExtractReviewPending();
    return null;
  }
  if (pending.places.length >= 2) return pending;
  if (pending.places.length === 1 && pending.allowSingle) return pending;
  clearExtractReviewPending();
  return null;
}

function filterReviewPlaces(raw: unknown): ExtractReviewPlace[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is ExtractReviewPlace =>
      !!p &&
      typeof p === "object" &&
      typeof (p as ExtractReviewPlace).id === "string" &&
      String((p as ExtractReviewPlace).id).trim().length > 0 &&
      typeof (p as ExtractReviewPlace).name === "string" &&
      typeof (p as ExtractReviewPlace).address === "string" &&
      typeof (p as ExtractReviewPlace).category === "string",
  ).map((p) => ({
    id: String(p.id).trim(),
    name: p.name,
    address: p.address,
    category: p.category,
    subcategory:
      typeof p.subcategory === "string"
        ? p.subcategory
        : p.subcategory === null
          ? null
          : null,
  }));
}

/** Server: latest completed & unreviewed job (24h, places ≥ 1). */
export async function fetchPendingExtractReview(
  accessToken: string,
): Promise<ExtractReviewPending | null> {
  const token = accessToken.trim();
  if (!token) return null;
  try {
    const res = await fetch("/api/extract/pending-review", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      jobId?: string | null;
      places?: ExtractReviewPlace[];
      at?: number | null;
    };
    const jobId = typeof data.jobId === "string" ? data.jobId.trim() : "";
    if (!jobId || !Array.isArray(data.places) || data.places.length < 1) return null;
    const places = filterReviewPlaces(data.places);
    if (places.length < 1) return null;
    const at =
      typeof data.at === "number" && Number.isFinite(data.at) ? data.at : Date.now();
    if (!isExtractReviewFresh(at)) return null;
    return {
      jobId,
      places,
      at,
      ...(places.length === 1 ? { allowSingle: true } : {}),
    };
  } catch {
    return null;
  }
}

export type ExtractReviewPendingJob = {
  jobId: string;
  places: ExtractReviewPlace[];
  at: number;
};

/**
 * Server: up to 20 unreviewed jobs (additive `jobs` on pending-review).
 * Falls back to the legacy single jobId/places when `jobs` is absent.
 */
export async function fetchPendingExtractReviewJobs(
  accessToken: string,
): Promise<ExtractReviewPendingJob[]> {
  const token = accessToken.trim();
  if (!token) return [];
  try {
    const res = await fetch("/api/extract/pending-review", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      jobId?: string | null;
      places?: ExtractReviewPlace[];
      at?: number | null;
      jobs?: Array<{
        jobId?: string;
        places?: ExtractReviewPlace[];
        at?: number | null;
      }>;
    };

    if (Array.isArray(data.jobs) && data.jobs.length > 0) {
      const out: ExtractReviewPendingJob[] = [];
      for (const row of data.jobs) {
        const jobId = typeof row.jobId === "string" ? row.jobId.trim() : "";
        const places = filterReviewPlaces(row.places);
        if (!jobId || places.length < 1) continue;
        const at =
          typeof row.at === "number" && Number.isFinite(row.at) ? row.at : Date.now();
        if (!isExtractReviewFresh(at)) continue;
        out.push({ jobId, places, at });
      }
      return out;
    }

    const jobId = typeof data.jobId === "string" ? data.jobId.trim() : "";
    const places = filterReviewPlaces(data.places);
    if (!jobId || places.length < 1) return [];
    const at =
      typeof data.at === "number" && Number.isFinite(data.at) ? data.at : Date.now();
    if (!isExtractReviewFresh(at)) return [];
    return [{ jobId, places, at }];
  } catch {
    return [];
  }
}

/** Server: set extract_jobs.reviewed_at (idempotent). */
export async function markExtractReviewReviewedOnServer(
  accessToken: string,
  jobId: string,
): Promise<boolean> {
  const token = accessToken.trim();
  const id = jobId.trim();
  if (!token || !id) return false;
  try {
    const res = await fetch("/api/extract/mark-reviewed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobId: id }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
