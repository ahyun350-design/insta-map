/**
 * Map Anthropic/Claude API failure text → short fail_code for user_events.meta.
 * Never put request_id / raw body into the returned code.
 */

export type ClaudeFailCode =
  | "claude_credit"
  | "claude_auth"
  | "claude_rate"
  | "claude_overloaded"
  | "claude_other";

const CLAUDE_FAIL_CODES: ReadonlySet<string> = new Set([
  "claude_credit",
  "claude_auth",
  "claude_rate",
  "claude_overloaded",
  "claude_other",
]);

export function isClaudeFailCode(code: string | null | undefined): code is ClaudeFailCode {
  return !!code && CLAUDE_FAIL_CODES.has(code);
}

/** Korean label for admin status banner (not user-facing extract toast). */
export function claudeFailCodeAdminLabel(code: string): string {
  switch (code) {
    case "claude_credit":
      return "Anthropic 크레딧 부족";
    case "claude_auth":
      return "Anthropic API 키 오류";
    case "claude_rate":
      return "Anthropic 요청 한도";
    case "claude_overloaded":
      return "Anthropic 과부하";
    case "claude_other":
      return "Anthropic API 오류";
    default:
      return code;
  }
}

/**
 * Classify Claude/Anthropic errors. Returns null if unrelated.
 * Accepts raw `Claude API 오류: …` bodies or already-normalized codes.
 */
export function classifyClaudeFailCode(raw: string | null | undefined): ClaudeFailCode | null {
  const m = String(raw ?? "").trim();
  if (!m) return null;

  const head = m.split("|")[0]?.trim() || m;
  if (isClaudeFailCode(head)) return head;

  const lower = m.toLowerCase();
  const looksClaude =
    /claude/i.test(m) ||
    /anthropic/i.test(m) ||
    /credit balance is too low/i.test(m) ||
    (/invalid_request_error/i.test(m) && /credit/i.test(m));

  if (!looksClaude) return null;

  if (
    /credit balance is too low/i.test(m) ||
    (/invalid_request_error/i.test(m) && /credit/i.test(m)) ||
    /insufficient.?credits?/i.test(m)
  ) {
    return "claude_credit";
  }

  if (
    /authentication_error/i.test(m) ||
    /invalid.?x-api-key/i.test(m) ||
    /invalid.?api.?key/i.test(m) ||
    (/unauthorized/i.test(lower) && /api.?key|anthropic|claude/i.test(m)) ||
    (/"type"\s*:\s*"authentication_error"/i.test(m) && /Claude API 오류|anthropic/i.test(m))
  ) {
    return "claude_auth";
  }

  if (/\b429\b/.test(m) || /rate.?limit/i.test(lower) || /too many requests/i.test(lower)) {
    return "claude_rate";
  }

  if (/\b529\b/.test(m) || /overloaded_error/i.test(m) || /overloaded/i.test(lower)) {
    return "claude_overloaded";
  }

  return "claude_other";
}
