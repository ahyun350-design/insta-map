import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PLACES_BULK_DELETE_MAX } from "@/lib/placesBulkDelete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/places/bulk-delete
 * body: { ids: string[] } — max PLACES_BULK_DELETE_MAX
 * Deletes only rows owned by the authenticated user (others skipped silently).
 */
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

    const body = (await req.json()) as { ids?: unknown };
    if (!Array.isArray(body.ids)) {
      return NextResponse.json({ error: "ids 배열이 필요합니다." }, { status: 400 });
    }

    const uniqueIds: string[] = [];
    const seen = new Set<string>();
    for (const raw of body.ids) {
      if (typeof raw !== "string") continue;
      const id = raw.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      uniqueIds.push(id);
    }

    if (uniqueIds.length === 0) {
      return NextResponse.json({ error: "삭제할 id가 없습니다." }, { status: 400 });
    }
    if (uniqueIds.length > PLACES_BULK_DELETE_MAX) {
      return NextResponse.json(
        { error: `한 번에 최대 ${PLACES_BULK_DELETE_MAX}개까지 삭제할 수 있습니다.` },
        { status: 400 },
      );
    }

    let admin;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      console.error("[places/bulk-delete] admin client", e);
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    // Own rows only — non-owned ids are skipped (no 403 leak)
    const { data: ownedRows, error: selectErr } = await admin
      .from("places")
      .select("id")
      .eq("user_id", authUser.id)
      .in("id", uniqueIds);

    if (selectErr) {
      console.error("[places/bulk-delete] select", selectErr);
      return NextResponse.json(
        { error: "fetch_failed", code: selectErr.code ?? null },
        { status: 500 },
      );
    }

    const ownedIds = (ownedRows ?? [])
      .map((r) => (typeof r.id === "string" ? r.id : ""))
      .filter(Boolean);

    if (ownedIds.length === 0) {
      return NextResponse.json({
        success: true,
        deleted: 0,
        deletedIds: [] as string[],
        requested: uniqueIds.length,
        skipped: uniqueIds.length,
      });
    }

    const { data: deletedRows, error: delErr } = await admin
      .from("places")
      .delete()
      .eq("user_id", authUser.id)
      .in("id", ownedIds)
      .select("id");

    if (delErr) {
      console.error("[places/bulk-delete] delete", delErr);
      return NextResponse.json(
        { error: "delete_failed", code: delErr.code ?? null },
        { status: 500 },
      );
    }

    const deletedIds = (deletedRows ?? [])
      .map((r) => (typeof r.id === "string" ? r.id : ""))
      .filter(Boolean);

    return NextResponse.json({
      success: true,
      deleted: deletedIds.length,
      deletedIds,
      requested: uniqueIds.length,
      skipped: uniqueIds.length - deletedIds.length,
    });
  } catch (error) {
    console.error("[places/bulk-delete] 예외", error);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
}
