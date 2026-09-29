import { NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";

/** Require Authorization: Bearer <jwt>. Returns the authenticated user or an error response. */
export async function requireBearerUser(
  req: Request,
): Promise<{ user: User } | { error: NextResponse }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    return {
      error: NextResponse.json(
        { error: "서버 환경변수가 설정되지 않았습니다." },
        { status: 500 },
      ),
    };
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return { error: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }
  const jwt = authHeader.slice(7).trim();
  if (!jwt) {
    return { error: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await userClient.auth.getUser(jwt);
  if (error || !data?.user) {
    return {
      error: NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 401 }),
    };
  }
  return { user: data.user };
}
