import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractPostImagePath(publicUrl: string): string | null {
  try {
    const u = new URL(publicUrl);
    const marker = "/post-images/";
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(u.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
}

/** 알 수 없는 테이블/스키마 오류는 스킵 (프로젝트마다 존재 여부가 다를 수 있음) */
function isMissingTableError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || "").toLowerCase();
  const code = err.code || "";
  if (code === "42P01") return true;
  if (msg.includes("does not exist") || msg.includes("schema cache")) return true;
  return false;
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 미설정" },
        { status: 500 },
      );
    }
    if (!serviceKey) {
      return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY 미설정" }, { status: 500 });
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
    const user = userData?.user;
    if (userErr || !user) {
      console.error("[account/delete] getUser failed", userErr);
      return NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 401 });
    }

    const userId = user.id;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    console.log("[account/delete] 시작", { userId });

    // --- 선택적 테이블 (스키마에 있을 수 있음: pins / courses 는 user_id, profiles 는 보통 id = auth user) ---
    for (const table of ["pins", "courses"] as const) {
      const { error } = await admin.from(table).delete().eq("user_id", userId);
      if (error && !isMissingTableError(error)) {
        console.warn(`[account/delete] ${table} 삭제 경고`, error);
      }
    }
    {
      const { error } = await admin.from("profiles").delete().eq("id", userId);
      if (error && !isMissingTableError(error)) {
        console.warn("[account/delete] profiles 삭제 경고", error);
      }
    }

    const { data: postRows } = await admin.from("feed_posts").select("id, images").eq("user_id", userId);

    const imagePaths: string[] = [];
    for (const row of postRows ?? []) {
      const imgs = (row as { images?: string[] }).images ?? [];
      for (const url of imgs) {
        const p = extractPostImagePath(url);
        if (p) imagePaths.push(p);
      }
    }
    if (imagePaths.length > 0) {
      const { error: rmErr } = await admin.storage.from("post-images").remove(imagePaths);
      if (rmErr) console.warn("[account/delete] storage remove", rmErr);
    }

    const postIds = (postRows ?? []).map((r) => (r as { id: string }).id).filter(Boolean);

    await admin.from("notifications").delete().or(`user_id.eq.${userId},actor_id.eq.${userId}`);

    await admin.from("comments").delete().eq("user_id", userId);
    if (postIds.length > 0) {
      await admin.from("comments").delete().in("post_id", postIds);
    }

    await admin.from("feed_posts").delete().eq("user_id", userId);

    await admin.from("places").delete().eq("user_id", userId);

    await admin.from("follows").delete().or(`follower_id.eq.${userId},following_id.eq.${userId}`);

    await admin.from("extract_jobs").delete().eq("user_id", userId);

    const { data: rooms } = await admin
      .from("chat_rooms")
      .select("id")
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

    const roomIds = (rooms ?? []).map((r) => (r as { id: string }).id).filter(Boolean);
    if (roomIds.length > 0) {
      await admin.from("messages").delete().in("room_id", roomIds);
      await admin.from("chat_rooms").delete().or(`user1_id.eq.${userId},user2_id.eq.${userId}`);
    }

    const { error: delUserRowErr } = await admin.from("users").delete().eq("id", userId);
    if (delUserRowErr) {
      console.error("[account/delete] users 삭제 실패", delUserRowErr);
      return NextResponse.json({ error: "사용자 데이터 삭제에 실패했습니다." }, { status: 500 });
    }

    const { error: delAuthErr } = await admin.auth.admin.deleteUser(userId);
    if (delAuthErr) {
      console.error("[account/delete] auth deleteUser 실패", delAuthErr);
      return NextResponse.json({ error: "인증 계정 삭제에 실패했습니다." }, { status: 500 });
    }

    console.log("[account/delete] 완료", { userId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[account/delete] 예외", e);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
