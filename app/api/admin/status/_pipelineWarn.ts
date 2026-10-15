import {
  claudeFailCodeAdminLabel,
  isClaudeFailCode,
} from "@/app/api/extract/_claudeFailCode";

export type PipelineWarn = {
  active: boolean;
  /** Short code e.g. claude_credit — null when inactive */
  code: string | null;
  /** Korean reason for banner */
  reason: string | null;
};

/** Top fail codes among recent failures (content + system), for the admin panel line. */
export type FailCodeTopEntry = { code: string; count: number };

/**
 * System / infra failures — eligible for the ≥7/10 same-code warn.
 * Content outcomes (no places, overseas, already saved, kakao unresolved, …) are excluded.
 */
export const SYSTEM_FAIL_CODES: ReadonlySet<string> = new Set([
  "claude_credit",
  "claude_auth",
  "claude_rate",
  "claude_overloaded",
  "claude_other",
  "kakao_429",
  "kakao_5xx",
  "kakao_timeout",
  "kakao_net",
  "apify_failed",
  "apify_timeout",
  "apify_status_failed",
  "concurrent-runs-limit-exceeded",
  "server_error",
  "unknown",
]);

/** Explicit content / user-data outcomes — never trigger the concentration warn. */
export const CONTENT_FAIL_CODES: ReadonlySet<string> = new Set([
  "no_places_in_caption",
  "only_account_handles",
  "overseas_unsupported",
  "all_saved_already",
  "kakao_unresolved",
  "caption_empty",
  "caption_too_short",
]);

export function normalizeFailCodeHead(code: string | null | undefined): string {
  return String(code ?? "").split("|")[0]?.trim() || "unknown";
}

export function isSystemFailCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const head = normalizeFailCodeHead(code);
  if (CONTENT_FAIL_CODES.has(head)) return false;
  if (SYSTEM_FAIL_CODES.has(head)) return true;
  if (/^Apify/i.test(head)) return true;
  if (/^서버 환경변수/i.test(head)) return true;
  if (/concurrent-runs/i.test(head)) return true;
  return false;
}

export function topFailCodes(
  codes: string[],
  limit = 3,
): FailCodeTopEntry[] {
  const counts = new Map<string, number>();
  for (const raw of codes) {
    const head = normalizeFailCodeHead(raw);
    if (!head) continue;
    counts.set(head, (counts.get(head) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([code, count]) => ({ code, count }));
}

/** Pure helper — exported for unit tests. */
export function computePipelineWarn(input: {
  /** Fail codes from jobs updated in last 30 minutes (newest first ok) */
  failCodesLast30m: string[];
  /** Fail codes from the 10 most recent failed jobs (newest first) */
  failCodesLast10: string[];
}): PipelineWarn {
  const inactive: PipelineWarn = { active: false, code: null, reason: null };
  for (const code of input.failCodesLast30m) {
    const head = normalizeFailCodeHead(code);
    if (head === "claude_credit" || head === "claude_auth") {
      return {
        active: true,
        code: head,
        reason: claudeFailCodeAdminLabel(head),
      };
    }
  }

  const fullCounts = new Map<string, number>();
  for (const raw of input.failCodesLast10) {
    const head = normalizeFailCodeHead(raw);
    if (!isSystemFailCode(head)) continue;
    fullCounts.set(head, (fullCounts.get(head) || 0) + 1);
  }
  let topCode = "";
  let topN = 0;
  for (const [c, n] of fullCounts) {
    if (n > topN) {
      topCode = c;
      topN = n;
    }
  }
  if (topN >= 7 && topCode) {
    const reason = isClaudeFailCode(topCode)
      ? claudeFailCodeAdminLabel(topCode)
      : `동일 시스템 실패 집중 (${topCode})`;
    return { active: true, code: topCode, reason };
  }
  return inactive;
}
