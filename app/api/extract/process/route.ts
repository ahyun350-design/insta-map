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
import { resolvePlaceCategoryFromKakao } from "@/lib/kakaoCategory";
import { readReelCache, writeReelCache } from "@/lib/reelCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAPTION_MAX_CHARS = 2000;
/** Apify Starter 동시 32한도 — 여유 두고 soft limit (env로 조정 가능) */
const APIFY_MAX_CONCURRENT = (() => {
  const raw = process.env.APIFY_MAX_CONCURRENT?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 28;
  return Number.isFinite(n) && n > 0 ? n : 28;
})();
const APIFY_QUEUE_WAIT_MS = 5000;
const APIFY_QUEUE_MAX_ATTEMPTS = 6;

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

function truncateCaption(caption: string): string {
  if (caption.length <= CAPTION_MAX_CHARS) return caption;
  return caption.slice(0, CAPTION_MAX_CHARS);
}

/** 진단 컬럼만 갱신 (status 변경 없음) — 중간 실패에도 부분 기록 유지 */
async function saveJobDiagnostics(
  jobId: string,
  patch: {
    caption?: string | null;
    claude_places?: RawPlace[] | PlaceCandidateJson[] | null;
    kakao_misses?: string[] | null;
  },
): Promise<void> {
  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("extract_jobs")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (error) {
      console.error("[extract] saveJobDiagnostics failed", { jobId, error });
    }
  } catch (e) {
    console.error("[extract] saveJobDiagnostics threw", { jobId, e });
  }
}

type PlaceCandidateJson = {
  name: string;
  hint: string;
  category: Place["category"];
};

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

async function countProcessingExtractJobs(
  supabase: ReturnType<typeof createServiceSupabase>,
): Promise<number> {
  const { count, error } = await supabase
    .from("extract_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing");
  if (error) throw error;
  return count ?? 0;
}

/** processing < APIFY_MAX_CONCURRENT 될 때까지 pending으로 대기. 최대 30초. */
async function waitForApifyConcurrencySlot(
  supabase: ReturnType<typeof createServiceSupabase>,
  jobId: string,
): Promise<void> {
  for (let attempt = 0; attempt < APIFY_QUEUE_MAX_ATTEMPTS; attempt++) {
    const processingCount = await countProcessingExtractJobs(supabase);
    if (processingCount < APIFY_MAX_CONCURRENT) return;

    const { error } = await supabase
      .from("extract_jobs")
      .update({
        status: "pending",
        progress_step: "순서를 기다리는 중이에요",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (error) throw error;

    console.log("[extract] apify concurrency wait", {
      jobId,
      processingCount,
      attempt: attempt + 1,
    });
    await new Promise((r) => setTimeout(r, APIFY_QUEUE_WAIT_MS));
  }
  throw new Error("concurrent-runs-limit-exceeded");
}

type ResolvedPlace = {
  name: string;
  category: Place["category"];
  address: string;
  lat: number;
  lng: number;
};

function formatExtractFailCode(code: string, names: string[]): string {
  const joined = names.slice(0, 8).join(",");
  return joined ? `${code}|${joined}` : code;
}

/** resolved === 0 원인 코드 (카카오 미스 장소명 포함) */
function buildZeroResolvedErrorMessage(candidateNames: string[]): string {
  if (candidateNames.length === 0) {
    return "no_places_in_caption";
  }
  return formatExtractFailCode("kakao_unresolved", candidateNames);
}

function buildPlaces(resolved: ResolvedPlace[]): Place[] {
  return resolved.map((p) => ({ name: p.name, category: p.category, address: p.address }));
}

export async function POST(req: Request) {
  const routeT0 = Date.now();
  let jobId = "";
  /** 성공/실패 최종 UPDATE에도 포함 */
  let diagCaption: string | null = null;
  let diagClaudePlaces: RawPlace[] | PlaceCandidateJson[] | null = null;
  let diagKakaoMisses: string[] | null = null;

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

    const cached = await readReelCache(supabase, job.instagram_url);
    let caption: string;
    let rawPlaces: RawPlace[];

    if (cached?.caption && cached.claude_places) {
      console.log("[extract] reel_cache hit", { jobId, url: cached.instagram_url });
      caption = cached.caption;
      rawPlaces = cached.claude_places;
      diagCaption = truncateCaption(caption);
      diagClaudePlaces = rawPlaces;
      await saveJobDiagnostics(jobId, {
        caption: diagCaption,
        claude_places: diagClaudePlaces,
      });
    } else {
      await waitForApifyConcurrencySlot(supabase, jobId);
      await updateJobProgress(jobId, "인스타 캡션 가져오는 중");
      const scrapeT0 = Date.now();
      caption = await scrapeInstagramCaption(job.instagram_url);
      console.log(`[PindMap:perf] extract.process.scrape ${Date.now() - scrapeT0}ms`);
      diagCaption = truncateCaption(caption);
      await saveJobDiagnostics(jobId, { caption: diagCaption });

      await updateJobProgress(jobId, "AI가 장소 분석하는 중");
      const aiT0 = Date.now();
      rawPlaces = await extractPlacesByClaude(caption);
      console.log(`[PindMap:perf] extract.process.ai ${Date.now() - aiT0}ms`);
      diagClaudePlaces = rawPlaces;
      await saveJobDiagnostics(jobId, { claude_places: diagClaudePlaces });

      void writeReelCache(supabase, job.instagram_url, diagCaption, rawPlaces);
    }

    type PlaceCandidate = {
      name: string;
      hint: string;
      category: Place["category"];
    };
    const candidates: PlaceCandidate[] = [];
    for (const item of rawPlaces) {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const hint = typeof item.hint === "string" ? item.hint.trim() : "";
      const category = normalizeCategory(item.category);
      if (!name || !category) continue;
      candidates.push({ name, hint, category });
    }
    const candidateNames = candidates.map((c) => c.name);

    if (candidates.length === 0) {
      throw new Error("no_places_in_caption");
    }

    // 카카오 장소별 병렬 검색 (폴백은 장소 내부 순차, 검증 없이 첫 결과 채택)
    await updateJobProgress(jobId, "카카오맵에서 좌표 찾는 중");
    const kakaoT0 = Date.now();
    const resolved: ResolvedPlace[] = [];

    await Promise.all(
      candidates.map(async (item) => {
        const kakaoResult = await searchKakaoPlace(item.name, item.hint, undefined, caption);
        if (!kakaoResult) return;
        resolved.push({
          name: item.name,
          category: resolvePlaceCategoryFromKakao(
            kakaoResult.category_group_code,
            kakaoResult.category_name,
            item.category,
          ),
          address: kakaoResult.roadAddress || kakaoResult.address,
          lat: kakaoResult.lat,
          lng: kakaoResult.lng,
        });
      }),
    );

    console.log(`[PindMap:perf] extract.process.kakao ${Date.now() - kakaoT0}ms`, {
      candidates: candidates.length,
      resolved: resolved.length,
    });

    const resolvedNames = new Set(resolved.map((r) => r.name));
    diagKakaoMisses = candidateNames.filter((n) => !resolvedNames.has(n));
    await saveJobDiagnostics(jobId, { kakao_misses: diagKakaoMisses });

    if (resolved.length === 0) {
      throw new Error(buildZeroResolvedErrorMessage(candidateNames));
    }

    const dbT0 = Date.now();
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
          caption: diagCaption,
          claude_places: diagClaudePlaces,
          kakao_misses: diagKakaoMisses,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      if (dupDoneError) throw dupDoneError;
      console.log(`[PindMap:perf] extract.process.db ${Date.now() - dbT0}ms`);
      console.log(`[PindMap:perf] extract.process.total ${Date.now() - routeT0}ms`);
      return NextResponse.json({ ok: true, inserted: 0 });
    }

    if (places.length === 0) {
      throw new Error(buildZeroResolvedErrorMessage(candidateNames));
    }

    const rows = uniqueResolved.map((p) => ({
      id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user_id: job.user_id,
      name: p.name,
      address: p.address,
      category: p.category,
      lat: p.lat,
      lng: p.lng,
    }));

    const { error: insertErr } = await supabase.from("places").insert(rows);
    if (insertErr) throw insertErr;

    const resultPlacesWithIds = rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      category: r.category,
      lat: r.lat,
      lng: r.lng,
    }));

    const { error: doneError } = await supabase
      .from("extract_jobs")
      .update({
        status: "completed",
        progress_step: "완료",
        result_places: resultPlacesWithIds,
        error_message: null,
        caption: diagCaption,
        claude_places: diagClaudePlaces,
        kakao_misses: diagKakaoMisses,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (doneError) throw doneError;
    console.log(`[PindMap:perf] extract.process.db ${Date.now() - dbT0}ms`);
    console.log(`[PindMap:perf] extract.process.total ${Date.now() - routeT0}ms`);
    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "작업 처리 중 오류가 발생했습니다.";
    console.error("[extract] process route failed", { jobId, message });
    console.log(`[PindMap:perf] extract.process.failed ${Date.now() - routeT0}ms`);
    if (jobId) {
      try {
        const supabase = createServiceSupabase();
        await supabase
          .from("extract_jobs")
          .update({
            status: "failed",
            error_message: message,
            progress_step: "실패",
            caption: diagCaption,
            claude_places: diagClaudePlaces,
            kakao_misses: diagKakaoMisses,
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
