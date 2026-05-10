import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/pjpeg"]);

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: "서버 환경변수(NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)가 설정되지 않았습니다." },
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
    const user = userData?.user;
    if (userErr || !user) {
      console.error("[upload/image] getUser failed", userErr);
      return NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 401 });
    }

    let admin;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Supabase 관리 클라이언트를 만들 수 없습니다.";
      console.error("[upload/image] admin client", msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file 필드가 필요합니다." }, { status: 400 });
    }

    const type = (file as File).type?.toLowerCase() || "";
    if (type && !ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ error: "JPEG 이미지만 업로드할 수 있어요." }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "파일 크기는 10MB 이하여야 해요." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "빈 파일은 업로드할 수 없어요." }, { status: 400 });
    }

    const fileNameField = form.get("fileName");
    const fileName =
      typeof fileNameField === "string" && fileNameField.trim().length > 0
        ? fileNameField.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200)
        : `${Date.now()}-${Math.random().toString(36).substring(2, 11)}.jpg`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage.from("post-images").upload(fileName, buffer, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: false,
    });

    if (uploadError) {
      console.error("[upload/image] storage upload", uploadError);
      return NextResponse.json({ error: uploadError.message || "스토리지 업로드에 실패했습니다." }, { status: 500 });
    }

    const { data: urlData } = admin.storage.from("post-images").getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;
    return NextResponse.json({ publicUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "업로드 처리 중 오류가 발생했습니다.";
    console.error("[upload/image] 예외", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
