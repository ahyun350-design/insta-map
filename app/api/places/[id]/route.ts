import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { FEED_POST_CATEGORIES } from "@/lib/feedPost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const CATEGORIES = new Set<string>(FEED_POST_CATEGORIES);

async function authenticateBearer(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    return { error: NextResponse.json({ error: "서버 환경변수가 설정되지 않았습니다." }, { status: 500 }) };
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return { error: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }
  const jwt = authHeader.slice(7).trim();

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  const authUser = userData?.user;
  if (userErr || !authUser) {
    return { error: NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 401 }) };
  }
  return { authUser };
}

/** places.category only — never touch name/address/lat/lng/poi_id/source */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id: rawId } = await context.params;
    const placeId = typeof rawId === "string" ? rawId.trim() : "";
    if (!placeId) {
      return NextResponse.json({ error: "장소 id가 필요합니다." }, { status: 400 });
    }

    const auth = await authenticateBearer(req);
    if ("error" in auth && auth.error) return auth.error;
    const authUser = auth.authUser!;

    const body = (await req.json()) as { category?: unknown };
    const category = typeof body.category === "string" ? body.category.trim() : "";
    if (!CATEGORIES.has(category)) {
      return NextResponse.json({ error: "유효하지 않은 카테고리입니다." }, { status: 400 });
    }

    let admin;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      console.error("[places/patch-category] admin client", e);
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const { data: row, error: fetchErr } = await admin
      .from("places")
      .select("id, user_id, name, category, source, poi_id")
      .eq("id", placeId)
      .maybeSingle();

    if (fetchErr) {
      console.error("[places/patch-category] select", fetchErr);
      return NextResponse.json(
        { error: "fetch_failed", code: fetchErr.code ?? null },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json({ error: "장소를 찾을 수 없습니다." }, { status: 404 });
    }
    if (row.user_id !== authUser.id) {
      // Do not reveal existence of another user's place
      return NextResponse.json({ error: "장소를 찾을 수 없습니다." }, { status: 404 });
    }

    const prevCategory = typeof row.category === "string" ? row.category : "";
    if (prevCategory === category) {
      return NextResponse.json({ success: true, category, unchanged: true });
    }

    const { error: updErr } = await admin
      .from("places")
      .update({
        category,
        category_edited_by_user: true,
      })
      .eq("id", placeId)
      .eq("user_id", authUser.id);

    if (updErr) {
      console.error("[places/patch-category] update", updErr);
      return NextResponse.json(
        { error: "update_failed", code: updErr.code ?? null },
        { status: 500 },
      );
    }

    // History for classification tuning — no caption/URL/PII
    const { error: evErr } = await admin.from("user_events").insert({
      user_id: authUser.id,
      event: "place_category_change",
      meta: {
        placeName: typeof row.name === "string" ? row.name : null,
        fromCategory: prevCategory || null,
        toCategory: category,
        source: typeof row.source === "string" ? row.source : null,
        poi_id: row.poi_id ?? null,
      },
    });
    if (evErr) {
      console.warn("[places/patch-category] user_events", evErr.message);
    }

    return NextResponse.json({ success: true, category });
  } catch (error) {
    console.error("[places/patch-category] 예외", error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  try {
    const { id: rawId } = await context.params;
    const placeId = typeof rawId === "string" ? rawId.trim() : "";
    if (!placeId) {
      return NextResponse.json({ error: "장소 id가 필요합니다." }, { status: 400 });
    }

    const auth = await authenticateBearer(req);
    if ("error" in auth && auth.error) return auth.error;
    const authUser = auth.authUser!;

    let admin;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      console.error("[places/delete] admin client", e);
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const { data: row, error: fetchErr } = await admin
      .from("places")
      .select("id, user_id")
      .eq("id", placeId)
      .maybeSingle();

    if (fetchErr) {
      console.error("[places/delete] select", fetchErr);
      return NextResponse.json(
        { error: "fetch_failed", code: fetchErr.code ?? null },
        { status: 500 },
      );
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
      return NextResponse.json(
        { error: "delete_failed", code: delErr.code ?? null },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[places/delete] 예외", error);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
}
