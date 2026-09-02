import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { upsertUserRowWithUniqueUsername } from "@/lib/ensureUserProfile";

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options),
              );
            } catch {
              // Server Component에서 호출시 무시
            }
          },
        },
      },
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const meta = data.user.user_metadata;
      const preferred =
        (typeof meta?.username === "string" && meta.username) ||
        (typeof meta?.preferred_username === "string" && meta.preferred_username) ||
        (typeof meta?.name === "string" && meta.name) ||
        undefined;

      const ensured = await upsertUserRowWithUniqueUsername(
        supabase,
        data.user.id,
        data.user.email,
        preferred || undefined,
      );
      if ("error" in ensured) {
        console.error("[auth/callback] users upsert failed:", ensured.error, {
          userId: data.user.id,
        });
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // 에러 발생시 로그인 페이지로
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
