import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  extractPlacesByClaude,
  normalizeCategory,
  Place,
  RawPlace,
  scrapeInstagramCaption,
  searchKakaoPlace,
} from "@/app/api/extract/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExtractJobRow = {
  id: string;
  user_id: string;
  instagram_url: string;
  status: "pending" | "processing" | "completed" | "failed";
};

function createServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const missingEnv: string[] = [];
  if (!supabaseUrl) missingEnv.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`서버 환경변수 미설정: ${missingEnv.join(", ")}`);
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function updateJobProgress(jobId: string, progressStep: string) {
  const supabase = createServiceSupabase();
  await supabase
    .from("extract_jobs")
    .update({
      status: "processing",
      progress_step: progressStep,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

function buildPlaces(resolved: Array<{ name: string; category: Place["category"]; address: string }>): Place[] {
  return resolved.map((p) => ({ name: p.name, category: p.category, address: p.address }));
}

export async function POST(req: Request) {
  let jobId = "";
  try {
    const body = await req.json() as { jobId?: string };
    jobId = body.jobId?.trim() ?? "";
    if (!jobId) return NextResponse.json({ error: "jobId가 필요합니다." }, { status: 400 });

    const supabase = createServiceSupabase();
    const { data: job, error: jobError } = await supabase
      .from("extract_jobs")
      .select("id, user_id, instagram_url, status")
      .eq("id", jobId)
      .maybeSingle<ExtractJobRow>();

    if (jobError) throw jobError;
    if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
    if (!job.user_id?.trim()) {
      throw new Error("작업에 사용자 정보가 없습니다.");
    }
    if (job.status === "completed") return NextResponse.json({ ok: true, skipped: true });
    await updateJobProgress(jobId, "인스타 캡션 가져오는 중");
    const caption = await scrapeInstagramCaption(job.instagram_url);

    await updateJobProgress(jobId, "AI가 장소 분석하는 중");
    const rawPlaces = await extractPlacesByClaude(caption);

    await updateJobProgress(jobId, "카카오맵에서 좌표 찾는 중");
    const resolved: Array<{ name: string; category: Place["category"]; address: string }> = [];
    for (const item of rawPlaces) {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const hint = typeof item.hint === "string" ? item.hint.trim() : "";
      const category = normalizeCategory(item.category);
      if (!name || !category) continue;
      const kakaoResult = await searchKakaoPlace(name, hint);
      if (kakaoResult) {
        resolved.push({ name, category, address: kakaoResult.roadAddress || kakaoResult.address });
      }
    }

    if (resolved.length === 0) throw new Error("장소 추출에 실패했습니다.");

    const { data: existingRows, error: existingErr } = await supabase
      .from("places")
      .select("name, address")
      .eq("user_id", job.user_id);
    if (existingErr) throw existingErr;
    const existingSet = new Set(
      (existingRows ?? []).map((r: { name: string; address: string }) =>
        `${String(r.name).trim()}::${String(r.address).trim()}`,
      ),
    );
    const uniqueResolved = resolved.filter((p) => {
      const key = `${p.name.trim()}::${p.address.trim()}`;
      if (existingSet.has(key)) return false;
      existingSet.add(key);
      return true;
    });

    const places = buildPlaces(uniqueResolved);

    if (places.length === 0 && resolved.length > 0) {
      const { error: dupDoneError } = await supabase
        .from("extract_jobs")
        .update({
          status: "completed",
          progress_step: "완료|all_saved_already",
          result_places: [],
          error_message: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      if (dupDoneError) throw dupDoneError;
      return NextResponse.json({ ok: true, inserted: 0 });
    }

    if (places.length === 0) throw new Error("장소 추출에 실패했습니다.");

    const rows = places.map((p) => ({
      id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user_id: job.user_id,
      name: p.name,
      address: p.address,
      category: p.category,
    }));

    const { error: insertErr } = await supabase.from("places").insert(rows);
    if (insertErr) throw insertErr;

    const resultPlacesWithIds = rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      category: r.category,
    }));

    const { error: doneError } = await supabase
      .from("extract_jobs")
      .update({
        status: "completed",
        progress_step: "완료",
        result_places: resultPlacesWithIds,
        error_message: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (doneError) throw doneError;
    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "작업 처리 중 오류가 발생했습니다.";
    console.error("[extract] process route failed", { jobId, message });
    if (jobId) {
      try {
        const supabase = createServiceSupabase();
        await supabase
          .from("extract_jobs")
          .update({
            status: "failed",
            error_message: message,
            progress_step: "실패",
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      } catch {
        // noop
      }
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
