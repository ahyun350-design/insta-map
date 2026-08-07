/**
 * 내부 에러(Supabase/네트워크/HTTP)를 사용자 노출용 문구로 변환.
 * Error.message 원문은 절대 반환하지 않는다. 원문은 console.error로만 남긴다.
 */

const DEFAULT_FALLBACK = "잠시 후 다시 시도해 주세요";

function extractCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const o = err as { code?: unknown; status?: unknown; statusCode?: unknown };
  if (o.code != null && String(o.code).trim()) return String(o.code).trim();
  if (o.statusCode != null && String(o.statusCode).trim()) return String(o.statusCode).trim();
  if (o.status != null && String(o.status).trim()) return String(o.status).trim();
  return "";
}

function extractMessage(err: unknown): string {
  if (typeof err === "string") return err.trim();
  if (err instanceof Error) return (err.message || "").trim();
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m.trim();
  }
  return "";
}

function isNetworkFailure(msg: string, code: string): boolean {
  const lower = msg.toLowerCase();
  return (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    /timeout|timed?\s*out|network|failed to fetch|load failed|networkerror|err_network|fetch failed|aborted/i.test(
      lower,
    ) ||
    /네트워크|불안정/.test(msg)
  );
}

function isAuthStatus(msg: string, code: string): boolean {
  if (code === "401" || code === "403") return true;
  if (/\b401\b/.test(msg) || /\b403\b/.test(msg)) return true;
  if (/\[status:401\]|\[status:403\]/i.test(msg)) return true;
  if (/unauthorized|forbidden|jwt|not authorized|permission denied/i.test(msg) && /401|403/.test(msg)) {
    return true;
  }
  return false;
}

function isRlsRelated(msg: string, code: string): boolean {
  if (code === "42501") return true;
  return /row-level security|rls|permission denied|not authorized|new row violates row-level/i.test(msg);
}

/** 기술/내부 누수로 보이는 영문·스택 메시지 */
function looksLikeInternalLeak(msg: string): boolean {
  if (!msg) return false;
  if (/violates|duplicate key|PGRST|postgrest|relation "|column |null value|foreign key|ECONN|ENOTFOUND/i.test(msg)) {
    return true;
  }
  if (/^\[status:\d+\]/.test(msg)) return true;
  if (/stack|at\s+\S+\s+\(/i.test(msg)) return true;
  // 영문 기술 메시지로 보이면 누수로 간주
  if (/[A-Za-z]{6,}/.test(msg) && !/[가-힣]/.test(msg)) return true;
  return false;
}

/**
 * @param err - unknown 에러/코드/앱 내부 한글 문구
 * @param fallback - 매핑 실패 시 문구
 */
export function toUserMessage(err: unknown, fallback?: string): string {
  const fb = (fallback && fallback.trim()) || DEFAULT_FALLBACK;
  const code = extractCode(err);
  const msg = extractMessage(err);

  if (err != null && (code || looksLikeInternalLeak(msg) || err instanceof Error || (typeof err === "object"))) {
    console.error("[toUserMessage]", err);
  }

  if (code === "23505") return "이미 있는 항목이에요";
  if (code === "23503") return "연결된 항목을 찾을 수 없어요";
  if (code === "42501" || isRlsRelated(msg, code)) return "권한이 없어요";

  if (isAuthStatus(msg, code)) return "다시 로그인해 주세요";
  if (isNetworkFailure(msg, code)) {
    return "네트워크가 불안정해요. 잠시 후 다시 시도해 주세요";
  }

  // 문자열만 넘어온 경우: 코드 형태면 매핑
  if (typeof err === "string") {
    const trimmed = err.trim();
    if (trimmed === "23505") return "이미 있는 항목이에요";
    if (trimmed === "23503") return "연결된 항목을 찾을 수 없어요";
    if (trimmed === "42501") return "권한이 없어요";
    if (trimmed === "401" || trimmed === "403") return "다시 로그인해 주세요";
    if (!looksLikeInternalLeak(trimmed) && /[가-힣]/.test(trimmed)) {
      // 코스 validation 등 이미 정제된 앱 문구
      return trimmed;
    }
  }

  return fb;
}
