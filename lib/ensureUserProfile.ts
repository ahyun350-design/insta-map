import type { SupabaseClient } from "@supabase/supabase-js";

export function resolveUsernameForEnsure(
  userId: string,
  email?: string,
  preferredUsername?: string,
): string {
  const preferred =
    typeof preferredUsername === "string" ? preferredUsername.trim() : "";
  if (preferred) return preferred;
  const emailLocal = email?.split("@")[0]?.trim();
  if (emailLocal) return emailLocal;
  return `user_${userId.slice(0, 8)}`;
}

function isUsernameUniqueViolation(error: unknown): boolean {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  const msg =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: string }).message ?? "")
      : "";
  return code === "23505" || /users_username_key|duplicate key.*username/i.test(msg);
}

/**
 * users 행이 없을 때 id 기준 upsert. username 충돌이면 suffix(2,3,…) 후
 * `user_{id8}` 로 최종 시도. 인증 워치독/세션 로직은 건드리지 않음.
 */
export async function upsertUserRowWithUniqueUsername(
  client: SupabaseClient,
  userId: string,
  email?: string,
  preferredUsername?: string,
): Promise<{ username: string } | { error: unknown }> {
  const baseUsername = resolveUsernameForEnsure(userId, email, preferredUsername);
  const candidates: string[] = [baseUsername];
  for (let n = 2; n <= 30; n += 1) {
    candidates.push(`${baseUsername}${n}`);
  }
  const fallback = `user_${userId.slice(0, 8)}`;
  if (!candidates.includes(fallback)) candidates.push(fallback);

  let lastError: unknown = null;
  for (const username of candidates) {
    const { error } = await client
      .from("users")
      .upsert({ id: userId, username }, { onConflict: "id" });
    if (!error) return { username };
    lastError = error;
    if (!isUsernameUniqueViolation(error)) {
      return { error };
    }
  }
  return { error: lastError };
}
