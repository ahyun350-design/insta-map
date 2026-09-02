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

    const { data, error } = await admin
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (error) {
      console.error("[username-available]", error);
      return NextResponse.json({ error: "check_failed" }, { status: 500 });
    }

    return NextResponse.json({ available: !data });
  } catch (e) {
    console.error("[username-available] exception", e);
    return NextResponse.json({ error: "check_failed" }, { status: 500 });
  }
}
