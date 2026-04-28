import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Place } from "@/app/api/extract/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JobStatus = "pending" | "processing" | "completed" | "failed";
type ExtractJobStatusRow = {
  id: string;
  status: JobStatus;
  progress_step: string | null;
  result_places: Place[] | null;
  error_message: string | null;
};

export async function GET(req: Request) {
  try {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId")?.trim();
    const userId = url.searchParams.get("userId")?.trim();
    if (!jobId) return NextResponse.json({ error: "jobId가 필요합니다." }, { status: 400 });
    if (!userId) return NextResponse.json({ error: "userId가 필요합니다." }, { status: 400 });

    const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(userId);
    if (userError || !userData.user) {
      return NextResponse.json({ error: "유효하지 않은 사용자" }, { status: 401 });
    }

    const { data, error } = await adminClient
      .from("extract_jobs")
      .select("id, status, progress_step, result_places, error_message")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle<ExtractJobStatusRow>();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "작업을 찾을 수 없어요." }, { status: 404 });

    return NextResponse.json({
      status: data.status,
      progress_step: data.progress_step ?? "",
      result_places: data.result_places ?? [],
      error_message: data.error_message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "상태 조회 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
