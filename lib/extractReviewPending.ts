/** Pending extract complete review (2+ newly inserted places). Client-only. */

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
