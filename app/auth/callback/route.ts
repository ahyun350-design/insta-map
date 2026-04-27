import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

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
                cookieStore.set(name, value, options)
              );
            } catch {
              // Server Component에서 호출시 무시
            }
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // 카카오로 처음 가입한 경우 users 테이블에 자동 등록
      const username =
        data.user.user_metadata?.preferred_username ||
        data.user.user_metadata?.name ||
        data.user.user_metadata?.username ||
        `user_${data.user.id.slice(0, 8)}`;

      await supabase.from("users").upsert({
        id: data.user.id,
        username,
      });

      return NextResponse.redirect(`${origin}/`);
    }
  }

  // 에러 발생시 로그인 페이지로
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}