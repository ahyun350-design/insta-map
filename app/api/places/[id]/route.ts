import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, context: RouteContext) {
  try {
    const { id: rawId } = await context.params;
    const placeId = typeof rawId === "string" ? rawId.trim() : "";
    if (!placeId) {
      return NextResponse.json({ error: "장소 id가 필요합니다." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: "서버 환경변수가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const jwt = authHeader.slice(7).trim();

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    const authUser = userData?.user;
    if (userErr || !authUser) {
      return NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 401 });
    }

    let admin;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Supabase 관리 클라이언트를 만들 수 없습니다.";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const { data: row, error: fetchErr } = await admin
      .from("places")
      .select("id, user_id")
      .eq("id", placeId)
      .maybeSingle();

    if (fetchErr) {
      console.error("[places/delete] select", fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "장소를 찾을 수 없습니다." }, { status: 404 });
    }
    if (row.user_id !== authUser.id) {
      return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });
    }

    const { error: delErr } = await admin.from("places").delete().eq("id", placeId);
    if (delErr) {
      console.error("[places/delete]", delErr);
      return NextResponse.json({ error: delErr.message || "삭제에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다.";
    console.error("[places/delete] 예외", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
