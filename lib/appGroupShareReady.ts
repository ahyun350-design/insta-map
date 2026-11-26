/**
 * Gate for App Group pending-share consume.
 * Require user id + usable access token before clearing the native key.
 */

export function canConsumeAppGroupShare(input: {
  userId: string | null | undefined;
  accessToken: string | null | undefined;
}): boolean {
  const uid = typeof input.userId === "string" ? input.userId.trim() : "";
  const token =
    typeof input.accessToken === "string" ? input.accessToken.trim() : "";
  return uid.length > 0 && token.length > 0;
}
