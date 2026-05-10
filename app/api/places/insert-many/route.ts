import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = new Set(["맛집", "카페", "쇼핑", "숙소", "놀거리", "여행지"]);
const MAX_ROWS = 50;

type InsertRow = {
  id: string;
  user_id: string;
  name: string;
  address: string;
  category: string;
};

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

    const body = (await req.json()) as { rows?: InsertRow[] };
    const rowsRaw = body.rows;
    if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
      return NextResponse.json({ error: "rows 배열이 필요합니다." }, { status: 400 });
    }
    if (rowsRaw.length > MAX_ROWS) {
      return NextResponse.json({ error: `한 번에 최대 ${MAX_ROWS}개까지 저장할 수 있습니다.` }, { status: 400 });
    }

    const rows: InsertRow[] = [];
    for (const r of rowsRaw) {
      if (!r || typeof r !== "object") {
        return NextResponse.json({ error: "잘못된 행 형식입니다." }, { status: 400 });
      }
      const id = typeof r.id === "string" ? r.id.trim() : "";
      const user_id = typeof r.user_id === "string" ? r.user_id.trim() : "";
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const address = typeof r.address === "string" ? r.address.trim() : "";
      const category = typeof r.category === "string" ? r.category.trim() : "";
      if (!id || !user_id || !name || !category) {
        return NextResponse.json({ error: "각 행에 id, user_id, name, category가 필요합니다." }, { status: 400 });
      }
      if (user_id !== authUser.id) {
        return NextResponse.json({ error: "본인 계정의 장소만 저장할 수 있습니다." }, { status: 403 });
      }
      if (
        !CATEGORIES.has(
          category as "맛집" | "카페" | "쇼핑" | "숙소" | "놀거리" | "여행지",
        )
      ) {
        return NextResponse.json({ error: "유효하지 않은 카테고리가 포함되어 있습니다." }, { status: 400 });
      }
      rows.push({ id, user_id, name, address, category });
    }

    let admin;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Supabase 관리 클라이언트를 만들 수 없습니다.";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const { error } = await admin.from("places").insert(rows);
    if (error) {
      console.error("[places/insert-many]", error);
      return NextResponse.json({ error: error.message || "저장에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다.";
    console.error("[places/insert-many] 예외", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
