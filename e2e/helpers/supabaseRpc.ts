import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireE2ECredentials } from "./env";

loadEnvLocal();

/** Authenticated Supabase client for E2E RPC checks (simulates any viewer of public lists). */
export async function createE2ESupabase() {
  requireE2ECredentials();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anon) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing");
  }
  const { email, password } = requireE2ECredentials();
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(`E2E supabase login failed: ${error?.message ?? "no user"}`);
  }
  return { client, userId: data.user.id };
}

export async function fetchPublicListsViaRpc(
  ownerId: string,
): Promise<{ id: string; title: string }[]> {
  const { client } = await createE2ESupabase();
  try {
    const { data, error } = await client.rpc("get_public_place_lists", {
      p_owner_id: ownerId,
    });
    if (error) throw new Error(`get_public_place_lists: ${error.message}`);
    const rows = Array.isArray(data) ? data : [];
    return rows.map((r) => {
      const row = r as { id?: unknown; title?: unknown };
      return { id: String(row.id ?? ""), title: String(row.title ?? "") };
    });
  } finally {
    await client.auth.signOut().catch(() => null);
  }
}

export async function fetchE2EUsername(): Promise<{ userId: string; username: string }> {
  const { client, userId } = await createE2ESupabase();
  try {
    const { data, error } = await client
      .from("users")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data?.username) {
      throw new Error(`E2E username lookup failed: ${error?.message ?? "empty"}`);
    }
    return { userId, username: String(data.username) };
  } finally {
    await client.auth.signOut().catch(() => null);
  }
}
