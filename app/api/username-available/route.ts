import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 가입 전 닉네임 중복 확인 (anon이 users를 못 읽는 경우 대비) */
export async function GET(req: Request) {
  try {
    const username = new URL(req.url).searchParams.get("username")?.trim() ?? "";
    if (username.length < 2) {
      return NextResponse.json({ available: false, reason: "too_short" });
    }

    let admin: ReturnType<typeof getSupabaseAdmin>;
    try {
      admin = getSupabaseAdmin();
    } catch {
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    // head+count — maybeSingle보다 중복 판정이 단순하고 안정적
    const { count, error } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("username", username);

    if (error) {
      console.error("[username-available]", error);
      return NextResponse.json({ error: "check_failed" }, { status: 500 });
    }

    return NextResponse.json({
      available: (count ?? 0) === 0,
      // 디버그·클라이언트 가드용 (민감정보 아님)
      checked: username,
    });
  } catch (e) {
    console.error("[username-available] exception", e);
    return NextResponse.json({ error: "check_failed" }, { status: 500 });
  }
}
