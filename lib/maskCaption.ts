/**
 * 진단용 캡션 마스킹 — 제3자 식별정보만 제거, 장소명 등 일반 텍스트는 유지.
 */
export function maskCaption(text: string): string {
  if (!text) return text;

  let out = text;

  // 이메일 먼저 (@멘션보다 우선)
  out = out.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    "***@***",
  );

  // @계정 멘션 (이메일에 남은 @는 이미 치환됨)
  out = out.replace(/@[A-Za-z0-9._]+/g, "@***");

  // 전화번호: 01X… / 0X-… (하이픈 유무)
  out = out.replace(/01[016789]-?\d{3,4}-?\d{4}/g, "***-****-****");
  out = out.replace(/0\d{1,2}-\d{3,4}-\d{4}/g, "***-****-****");
  out = out.replace(/0\d{1,2}\d{7,8}(?!\d)/g, "***-****-****");

  return out;
}
