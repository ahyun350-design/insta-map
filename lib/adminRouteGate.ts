/**
 * Admin-only API gate: the admin's Supabase JWT, or the Playwright e2e token
 * (same server-secret token that opens /map-preview).
 */
import { createClient } from "@supabase/supabase-js";
import { isMapPreviewE2eTokenValid } from "@/lib/mapPreviewAccess";

export const ADMIN_USER_ID = "63772749-e01b-4396-a41c-c17a4d3acfe6";

export async function requireAdmin(req: Request): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string }
> {
  if (isMapPreviewE2eTokenValid(req.headers.get("x-pindmap-e2e"))) return { ok: true };
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: "server_misconfigured" };
  }
  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const jwt = authHeader.slice(7).trim();
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (userData.user.id !== ADMIN_USER_ID) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true };
}
