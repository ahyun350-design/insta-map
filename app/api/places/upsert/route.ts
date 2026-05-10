import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = new Set(["맛집", "카페", "쇼핑", "숙소"]);

export async function POST(req: Request) {
  try {
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

    const body = (await req.json()) as {
      id?: string;
      name?: string;
      address?: string;
      category?: string;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    if (!id || !name || !category) {
      return NextResponse.json({ error: "id, name, category는 필수입니다." }, { status: 400 });
    }
    if (!CATEGORIES.has(category as "맛집" | "카페" | "쇼핑" | "숙소")) {
      return NextResponse.json({ error: "유효하지 않은 카테고리입니다." }, { status: 400 });
    }

    let admin;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Supabase 관리 클라이언트를 만들 수 없습니다.";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const { error } = await admin.from("places").upsert({
      id,
      user_id: authUser.id,
      name,
      address,
      category,
    });

    if (error) {
      console.error("[places/upsert]", error);
      return NextResponse.json({ error: error.message || "저장에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다.";
    console.error("[places/upsert] 예외", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
