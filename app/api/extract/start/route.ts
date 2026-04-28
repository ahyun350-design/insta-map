import { NextResponse } from "next/server";
import { isValidInstagramPostUrl } from "@/app/api/extract/_shared";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { instagramUrl?: string };
    const instagramUrl = body.instagramUrl?.trim();

    if (!instagramUrl) {
      return NextResponse.json({ error: "instagramUrl이 필요합니다." }, { status: 400 });
    }
    if (!isValidInstagramPostUrl(instagramUrl)) {
      return NextResponse.json({ error: "유효한 Instagram 게시물 URL을 입력해주세요." }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const jobId = crypto.randomUUID();
    const { error: insertError } = await supabase.from("extract_jobs").insert({
      id: jobId,
      user_id: user.id,
      instagram_url: instagramUrl,
      status: "pending",
      progress_step: "대기 중",
    });
    if (insertError) throw insertError;

    const processUrl = new URL("/api/extract/process", req.url).toString();
    void fetch(processUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    }).catch(() => {
      // fire-and-forget
    });

    return NextResponse.json({ jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "작업 시작 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
