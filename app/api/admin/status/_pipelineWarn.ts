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

/** Pure helper — exported for unit tests. */
export function computePipelineWarn(input: {
  /** Fail codes from jobs updated in last 30 minutes (newest first ok) */
  failCodesLast30m: string[];
  /** Fail codes from the 10 most recent failed jobs (newest first) */
  failCodesLast10: string[];
}): PipelineWarn {
  const inactive: PipelineWarn = { active: false, code: null, reason: null };
  for (const code of input.failCodesLast30m) {
    if (code === "claude_credit" || code === "claude_auth") {
      return {
        active: true,
        code,
        reason: claudeFailCodeAdminLabel(code),
      };
    }
  }
  if (input.failCodesLast10.length >= 7) {
    const counts = new Map<string, number>();
    for (const c of input.failCodesLast10) {
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    let topCode = "";
    let topN = 0;
    for (const [c, n] of counts) {
      if (n > topN) {
        topCode = c;
        topN = n;
      }
    }
    if (topN >= 7 && topCode) {
      const reason = isClaudeFailCode(topCode)
        ? claudeFailCodeAdminLabel(topCode)
        : `동일 실패 집중 (${topCode})`;
      return { active: true, code: topCode, reason };
    }
  }
  return inactive;
}
