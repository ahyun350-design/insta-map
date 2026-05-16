/** 주소에서 시/구 단위 지역만 추출 (예: "서울 마포구 동교로 262-11" → "마포구") */
export function extractRegion(address: string | undefined | null): string {
  const trimmed = (address ?? "").trim();
  if (!trimmed) return "";

  const guMatch = trimmed.match(/(?:[가-힣]+시\s+)?([가-힣]+구)/);
  if (guMatch?.[1]) return guMatch[1];

  const siMatch = trimmed.match(/([가-힣]+시)/);
  if (siMatch?.[1]) return siMatch[1];

  const countyMatch = trimmed.match(/([가-힣]+군)/);
  if (countyMatch?.[1]) return countyMatch[1];

  return trimmed.split(/[\s,]/)[0]?.slice(0, 12) ?? "";
}
