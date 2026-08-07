/**
 * extract_jobs.error_message 원문을 사용자 노출용 문구로 변환.
 * DB에는 원문을 유지하고, 화면/토스트에는 이 결과만 쓴다.
 */
export function mapExtractErrorToUserMessage(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  const lower = msg.toLowerCase();

  if (
    msg === "timeout" ||
    msg === "process_trigger_failed" ||
    /^timeout\b/i.test(msg) ||
    /시간이 오래 걸려/i.test(msg)
  ) {
    return "시간이 오래 걸려 중단됐어요. 다시 시도해 주세요";
  }

  if (
    /claude/i.test(msg) ||
    /anthropic/i.test(msg) ||
    /credit balance/i.test(msg) ||
    /insufficient.?credits?/i.test(msg) ||
    /api 오류/i.test(msg) ||
    /api error/i.test(lower)
  ) {
    return "일시적인 오류예요. 잠시 후 다시 시도해 주세요";
  }

  if (
    /apify/i.test(msg) ||
    /instagram/i.test(msg) ||
    /인스타/i.test(msg) ||
    /불러올 수 없/i.test(msg) ||
    /게시물을 가져올 수 없/i.test(msg)
  ) {
    return "이 릴스는 지금 불러올 수 없어요. 다른 링크로 시도해 주세요";
  }

  if (
    msg === "no_places_in_caption" ||
    msg.startsWith("no_places_in_caption|") ||
    msg.includes("캡션을 찾을 수 없습니다")
  ) {
    if (msg.includes("캡션을 찾을 수 없습니다")) {
      return "이 게시물에는 장소 정보가 없어요";
    }
    return "이 게시물에는 가게 이름이 없어요. 영상 속 장소는 아직 읽지 못해요";
  }

  if (msg === "overseas_unsupported" || msg.startsWith("overseas_unsupported|")) {
    return "해외 장소는 아직 지도에 담을 수 없어요";
  }

  if (msg === "kakao_unresolved" || msg.startsWith("kakao_unresolved|")) {
    return "지도에서 가게를 찾지 못했어요. 다른 릴스로 시도해 주세요";
  }

  if (msg.includes("장소 추출에 실패했습니다")) {
    return "장소를 찾지 못했어요. 다른 릴스로 시도해 주세요";
  }

  return "잠시 후 다시 시도해 주세요";
}
