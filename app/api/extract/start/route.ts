import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isValidInstagramPostUrl } from "@/app/api/extract/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "서버 환경변수 미설정: NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
    }

    const adminClient = createClient(
      supabaseUrl,
      serviceKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = await req.json() as { instagramUrl?: string; userId?: string };
    const instagramUrl = body.instagramUrl?.trim();
    const userId = body.userId?.trim();

    if (!instagramUrl) {
      return NextResponse.json({ error: "instagramUrl이 필요합니다." }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "userId가 필요합니다." }, { status: 400 });
    }
    if (!isValidInstagramPostUrl(instagramUrl)) {
      return NextResponse.json({ error: "유효한 Instagram 게시물 URL을 입력해주세요." }, { status: 400 });
    }

    const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(userId);
    if (userError || !userData.user) {
      return NextResponse.json({ error: "유효하지 않은 사용자" }, { status: 401 });
    }

    const jobId = crypto.randomUUID();
    const { error: insertError } = await adminClient.from("extract_jobs").insert({
      id: jobId,
      user_id: userId,
      instagram_url: instagramUrl,
      status: "pending",
      progress_step: "대기 중",
    });
    if (insertError) throw insertError;

    const baseUrl = req.headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(req.url).origin;
    if (!baseUrl) {
      return NextResponse.json({ error: "서버 base URL을 확인할 수 없습니다." }, { status: 500 });
    }
    const processUrl = new URL("/api/extract/process", baseUrl).toString();

    const triggerProcess = async () => {
      const res = await fetch(processUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`process 호출 실패(${res.status}): ${text}`);
      }
    };

    void (async () => {
      try {
        await triggerProcess();
      } catch (firstErr) {
        console.error("[extract] process trigger first attempt failed", firstErr);
        try {
          await triggerProcess();
        } catch (secondErr) {
          console.error("[extract] process trigger second attempt failed", secondErr);
        }
      }
    })();

    return NextResponse.json({ jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "작업 시작 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
