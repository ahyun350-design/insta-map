import { NextResponse } from "next/server";
import { Place } from "@/app/api/extract/_shared";
import { createSupabaseServerClient } from "@/lib/supabase-server";

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
    const jobId = new URL(req.url).searchParams.get("jobId")?.trim();
    if (!jobId) return NextResponse.json({ error: "jobId가 필요합니다." }, { status: 400 });

    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const { data, error } = await supabase
      .from("extract_jobs")
      .select("id, status, progress_step, result_places, error_message")
      .eq("id", jobId)
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
