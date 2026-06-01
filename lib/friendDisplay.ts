const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** 채팅·공유 UI용 표시 이름 — UUID/빈 username은 "이름 미설정" */
export function getDisplayFriendName(
  username: string | null | undefined,
  userId?: string,
): string {
  const raw = (username ?? "").trim();
  if (!raw) return "이름 미설정";
  if (userId && raw === userId) return "이름 미설정";
  if (isUuidLike(raw)) return "이름 미설정";
  return raw;
}
