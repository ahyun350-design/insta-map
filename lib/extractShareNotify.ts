/**
 * Share Extension extract outcome notifications (quiet-result fix).
 * Pure helpers — no I/O. Server inserts notifications; client formats UI.
 */

export const EXTRACT_SHARE_OUTCOME_TYPE = "extract_share_outcome" as const;

export type ExtractShareOutcomeKind =
  | "all_saved"
  | "no_places"
  | "kakao_unresolved"
  | "overseas"
  | "failed";

export type ExtractShareNotifyDecision =
  | { notify: false }
  | { notify: true; kind: ExtractShareOutcomeKind; message: string };

/** Dedupe window for same user + kind */
export const EXTRACT_SHARE_NOTIFY_DEDUPE_MS = 60_000;

export function messageForExtractShareKind(
  kind: ExtractShareOutcomeKind,
): string {
  switch (kind) {
    case "all_saved":
      return "이미 저장한 장소예요";
    case "no_places":
      return "이 릴스에서 장소를 찾지 못했어요";
    case "kakao_unresolved":
      return "장소 위치를 찾지 못했어요";
    case "overseas":
      return "해외 장소는 아직 지원하지 않아요";
    case "failed":
      return "추출에 실패했어요. 다시 시도해 주세요";
  }
}

/** Map extract_jobs error_message code → share outcome kind. */
export function kindFromExtractFailCode(
  raw: string | null | undefined,
): ExtractShareOutcomeKind {
  const code = String(raw ?? "")
    .split("|")[0]
    .trim();
  if (code === "no_places_in_caption" || code === "caption_empty") {
    return "no_places";
  }
  if (code === "kakao_unresolved") return "kakao_unresolved";
  if (code === "overseas_unsupported") return "overseas";
  // timeout and everything else
  return "failed";
}

/**
 * Decide whether to insert a share-outcome notification.
 * Only entry=share; never for successful new-place saves (extract_complete).
 */
export function decideExtractShareNotify(input: {
  entry: string | null | undefined;
  outcome: "all_saved" | "failed";
  failCode?: string | null;
}): ExtractShareNotifyDecision {
  if (input.entry !== "share") return { notify: false };
  if (input.outcome === "all_saved") {
    return {
      notify: true,
      kind: "all_saved",
      message: messageForExtractShareKind("all_saved"),
    };
  }
  const kind = kindFromExtractFailCode(input.failCode);
  return {
    notify: true,
    kind,
    message: messageForExtractShareKind(kind),
  };
}
