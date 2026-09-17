import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildKakaoQueryFallbacks,
  extractPlacesByClaude,
  formatKakaoUnresolvedErrorMessage,
  normalizeCategory,
  Place,
  RawPlace,
  scrapeInstagramCaption,
  searchKakaoPlaceWithDiag,
} from "@/app/api/extract/_shared";
import { resolveExtractPlaceCategory } from "@/lib/kakaoCategory";
import { maskCaption } from "@/lib/maskCaption";
import {
  classifyCaption,
  kakaoBranchTagAcceptable,
  preparePlaceCandidatesForKakao,
} from "@/lib/extractPlaceFilters";
import {
  readKakaoMissCache,
  writeKakaoMissCache,
} from "@/lib/kakaoMissCache";
import {
  isNegativeCacheableError,
  isNoCaptionScrapeError,
  readReelCache,
  reelCacheFailToErrorMessage,
  writeReelCache,
} from "@/lib/reelCache";
import {
  decidePoiAdoption,
  formatPoiLowconfLog,
  formatPoiResolvedLog,
  searchPoi,
  toPoiSearchResult,
  type PoiSearchHit,
} from "@/lib/poiSearch";
import { formatPlaceSourceLog } from "@/lib/poiMatch";
import {
  formatPlacePendingLog,
  formatPoiReresolveMissLog,
  resolvePlaceViaPoi,
} from "@/lib/resolvePlaceViaPoi";

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

/** 진단용: 식별정보 마스킹 후 길이 제한 */
function toDiagCaption(raw: string): string {
  return truncateCaption(maskCaption(raw));
}

type PendingPlaceJson = {
  name: string;
  region: string | null;
  hint: string;
  category: Place["category"];
  reason: "c" | "d";
  top_score: number | null;
  candidates: ReturnType<typeof toPoiSearchResult>[];
};

/** 진단 컬럼만 갱신 (status 변경 없음) — 중간 실패에도 부분 기록 유지 */
async function saveJobDiagnostics(
  jobId: string,
  patch: {
    caption?: string | null;
    claude_places?: RawPlace[] | PlaceCandidateJson[] | null;
    kakao_misses?: string[] | null;
    pending_places?: PendingPlaceJson[] | null;
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
  region: string | null;
  category: Place["category"];
};

function parseRegion(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
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
  source: "kakao" | "poi";
  poi_id?: number | null;
};

/** resolved === 0 원인 코드 (카카오 미스 장소명 + 시도 stage 진단) */
function buildZeroResolvedErrorMessage(
  misses: ReadonlyArray<{ name: string; tried: number; stages: string[] }>,
  opts?: { allOverseas?: boolean },
): string {
  if (opts?.allOverseas && misses.length > 0) {
    const names = misses
      .map((m) => m.name.trim())
      .filter(Boolean)
      .slice(0, 5)
      .join(",");
    return names ? `overseas_unsupported|${names}` : "overseas_unsupported";
  }
  if (misses.length === 0) {
    return "no_places_in_caption";
  }
  return formatKakaoUnresolvedErrorMessage(misses);
}

function cacheNegativeFailure(
  supabase: ReturnType<typeof createServiceSupabase>,
  instagramUrl: string,
  message: string,
  claudePlaces: RawPlace[] | null,
): void {
  const code = isNegativeCacheableError(message);
  if (!code) return;
  let status: "failed" | "no_places" | "no_caption" = "failed";
  if (code === "no_places_in_caption" || code === "only_account_handles") {
    status = "no_places";
  } else if (code === "caption_empty" || code === "caption_too_short") {
    status = "failed";
  }
  void writeReelCache(supabase, instagramUrl, {
    status,
    claudePlaces,
    errorCode: code,
  });
}

function buildPlaces(resolved: ResolvedPlace[]): Place[] {
  return resolved.map((p) => ({ name: p.name, category: p.category, address: p.address }));
}

function averageOrigin(
  places: ReadonlyArray<{ lat: number; lng: number }>,
): { lat: number; lng: number } | null {
  if (places.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const p of places) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / places.length, lng: lng / places.length };
}

async function fetchPoiRawCategory(
  supabase: ReturnType<typeof createServiceSupabase>,
  poiId: number,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("poi")
    .select("raw_category")
    .eq("id", poiId)
    .maybeSingle();
  if (error || !data) return null;
  const raw = (data as { raw_category?: string | null }).raw_category;
  if (typeof raw === "string") return raw;
  if (raw == null) return null;
  return String(raw);
}

export async function POST(req: Request) {
  const routeT0 = Date.now();
  let jobId = "";
  /** 성공/실패 최종 UPDATE에도 포함 */
  let diagCaption: string | null = null;
  let diagClaudePlaces: RawPlace[] | PlaceCandidateJson[] | null = null;
  let diagKakaoMisses: string[] | null = null;
  let diagPendingPlaces: PendingPlaceJson[] | null = null;

  try {
    const body = (await req.json()) as { jobId?: string; bypassCache?: boolean };
    jobId = body.jobId?.trim() ?? "";
    const bypassCache = body.bypassCache === true;
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

    const cached = await readReelCache(supabase, job.instagram_url, { bypassCache });
    let caption: string;
    let rawPlaces: RawPlace[];
    /** Caption text available for overseas city hints (empty on ok-cache hit) */
    let captionForHints: string | null = null;

    if (
      cached &&
      (cached.status === "no_places" ||
        cached.status === "no_caption" ||
        cached.status === "failed")
    ) {
      console.log("[extract] reel_cache fail hit", {
        jobId,
        host: "instagram.com",
        status: cached.status,
        error_code: cached.error_code,
      });
      diagCaption = null;
      diagClaudePlaces = cached.claude_places;
      await saveJobDiagnostics(jobId, {
        caption: diagCaption,
        claude_places: diagClaudePlaces,
      });
      throw new Error(reelCacheFailToErrorMessage(cached));
    }

    if (cached?.status === "ok" && cached.claude_places) {
      console.log("[extract] reel_cache hit", {
        jobId,
        host: "instagram.com",
        status: cached.status,
        rule_version: cached.rule_version,
      });
      caption = "";
      captionForHints = null;
      rawPlaces = cached.claude_places;
      diagCaption = null;
      diagClaudePlaces = rawPlaces;
      await saveJobDiagnostics(jobId, {
        caption: diagCaption,
        claude_places: diagClaudePlaces,
      });
    } else {
      await waitForApifyConcurrencySlot(supabase, jobId);
      await updateJobProgress(jobId, "인스타 캡션 가져오는 중");
      const scrapeT0 = Date.now();
      try {
        caption = await scrapeInstagramCaption(job.instagram_url);
      } catch (scrapeErr) {
        const scrapeMsg =
          scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
        if (isNoCaptionScrapeError(scrapeMsg)) {
          void writeReelCache(supabase, job.instagram_url, {
            status: "failed",
            claudePlaces: null,
            errorCode: "caption_empty",
          });
          throw new Error("caption_empty");
        }
        throw scrapeErr;
      }
      console.log(`[PindMap:perf] extract.process.scrape ${Date.now() - scrapeT0}ms`);

      const captionClass = classifyCaption(caption);
      if (captionClass === "empty") {
        void writeReelCache(supabase, job.instagram_url, {
          status: "failed",
          claudePlaces: null,
          errorCode: "caption_empty",
        });
        throw new Error("caption_empty");
      }
      if (captionClass === "too_short") {
        void writeReelCache(supabase, job.instagram_url, {
          status: "failed",
          claudePlaces: null,
          errorCode: "caption_too_short",
        });
        throw new Error("caption_too_short");
      }

      captionForHints = caption;
      diagCaption = toDiagCaption(caption);
      await saveJobDiagnostics(jobId, { caption: diagCaption });

      await updateJobProgress(jobId, "AI가 장소 분석하는 중");
      const aiT0 = Date.now();
      rawPlaces = await extractPlacesByClaude(caption);
      console.log(`[PindMap:perf] extract.process.ai ${Date.now() - aiT0}ms`);
      diagClaudePlaces = rawPlaces;
      await saveJobDiagnostics(jobId, { claude_places: diagClaudePlaces });
    }

    type PlaceCandidate = {
      name: string;
      hint: string;
      region: string | null;
      category: Place["category"];
    };
    const parsedCandidates: PlaceCandidate[] = [];
    for (const item of rawPlaces) {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const hint = typeof item.hint === "string" ? item.hint.trim() : "";
      const region = parseRegion(item.region);
      const category = normalizeCategory(item.category);
      if (!name || !category) continue;
      parsedCandidates.push({ name, hint, region, category });
    }

    // Single gate before Kakao — cache hit and fresh Claude share this path
    const prepared = preparePlaceCandidatesForKakao(parsedCandidates, {
      caption: captionForHints,
    });
    if (prepared.onlyAccountHandles || prepared.candidates.length + prepared.hardOverseas.length === 0) {
      if (prepared.onlyAccountHandles || prepared.droppedHandles.length > 0) {
        void writeReelCache(supabase, job.instagram_url, {
          status: "no_places",
          claudePlaces: rawPlaces,
          errorCode: "only_account_handles",
        });
        throw new Error("only_account_handles");
      }
      void writeReelCache(supabase, job.instagram_url, {
        status: "no_places",
        claudePlaces: rawPlaces,
        errorCode: "no_places_in_caption",
      });
      throw new Error("no_places_in_caption");
    }

    const candidates = prepared.candidates;
    const candidateNames = [
      ...candidates.map((c) => c.name),
      ...prepared.hardOverseas.map((c) => c.name),
    ];

    // All hard-overseas, nothing to resolve domestically
    if (candidates.length === 0 && prepared.hardOverseas.length > 0) {
      void writeReelCache(supabase, job.instagram_url, {
        status: "failed",
        claudePlaces: rawPlaces,
        errorCode: "overseas_unsupported",
      });
      throw new Error(
        buildZeroResolvedErrorMessage(
          prepared.hardOverseas.map((c) => ({
            name: c.name,
            tried: 0,
            stages: ["overseas_hard"],
          })),
          { allOverseas: true },
        ),
      );
    }

    // 성공 경로 — Apify+Claude 결과 캐시 (캐시 히트로 온 경우에도 TTL 갱신)
    void writeReelCache(supabase, job.instagram_url, {
      status: "ok",
      claudePlaces: rawPlaces,
    });

    // 카카오 장소별 병렬 검색 → 성공 시 좌표를 origin 으로 poi 재해결
    await updateJobProgress(jobId, "카카오맵에서 좌표 찾는 중");
    const kakaoT0 = Date.now();
    const resolved: ResolvedPlace[] = [];
    const kakaoMissDiags: {
      name: string;
      tried: number;
      stages: string[];
      candidate: PlaceCandidate;
      overseas?: boolean;
    }[] = [];

    // Hard overseas: no Kakao
    for (const item of prepared.hardOverseas) {
      kakaoMissDiags.push({
        name: item.name,
        tried: 0,
        stages: ["overseas_hard"],
        candidate: item,
        overseas: true,
      });
    }

    await Promise.all(
      candidates.map(async (item) => {
        const soft = prepared.softOverseasNames.has(item.name);
        const kakaoQuery = item.kakaoQueryName || item.name;
        if (!soft) {
          const cachedMiss = await readKakaoMissCache(supabase, item.name);
          if (cachedMiss) {
            console.log("[extract] kakao_miss_cache hit", { name: item.name });
            kakaoMissDiags.push({
              name: item.name,
              tried: 0,
              stages: ["miss_cache"],
              candidate: item,
            });
            return;
          }
        }

        const { lookup: kakaoResult, tried, stages } = await searchKakaoPlaceWithDiag(
          kakaoQuery,
          item.hint,
          undefined,
          "",
          soft
            ? { maxAttempts: 1, branchMatchName: item.name }
            : { branchMatchName: item.name },
        );
        if (!kakaoResult) {
          if (soft) {
            kakaoMissDiags.push({
              name: item.name,
              tried,
              stages: [...stages, "overseas_soft"],
              candidate: item,
              overseas: true,
            });
            return;
          }
          void writeKakaoMissCache(supabase, item.name);
          kakaoMissDiags.push({ name: item.name, tried, stages, candidate: item });
          return;
        }

        // Branch-tag guard: other branch on place_name → reject;
        // no branch → address/alias check (unknown stems allowed).
        const kakaoAddr =
          kakaoResult.roadAddress || kakaoResult.address || "";
        if (!kakaoBranchTagAcceptable(item.name, kakaoResult.placeName, kakaoAddr)) {
          console.log("[extract] kakao branch_tag reject", {
            name: item.name,
          });
          void writeKakaoMissCache(supabase, item.name);
          kakaoMissDiags.push({
            name: item.name,
            tried,
            stages: [...stages, "branch_tag_reject"],
            candidate: item,
          });
          return;
        }

        // 이름은 항상 Claude 추출명 유지. 카카오 좌표는 origin 으로만 사용.
        const poiResolved = await resolvePlaceViaPoi(supabase, {
          placeName: item.name,
          originLat: kakaoResult.lat,
          originLng: kakaoResult.lng,
        });
        let poiRaw: string | null = null;
        if (poiResolved.ok) {
          poiRaw = await fetchPoiRawCategory(supabase, poiResolved.poiId);
        }
        const category = resolveExtractPlaceCategory({
          groupCode: kakaoResult.category_group_code,
          categoryName: kakaoResult.category_name,
          claudeCategory: item.category,
          poiRawCategory: poiRaw,
        });
        if (poiResolved.ok) {
          console.log(formatPlaceSourceLog("poi", item.name));
          resolved.push({
            name: item.name,
            category,
            address: poiResolved.address,
            lat: poiResolved.lat,
            lng: poiResolved.lng,
            source: "poi",
            poi_id: poiResolved.poiId,
          });
          return;
        }

        // B: 카카오 성공 → poi 재해결 실패 → kakao 좌표 유지
        console.log(
          formatPoiReresolveMissLog(
            item.name,
            poiResolved.reason,
            poiResolved.excluded,
          ),
        );
        console.log(formatPlaceSourceLog("kakao", item.name));
        resolved.push({
          name: item.name,
          category,
          address: kakaoResult.roadAddress || kakaoResult.address,
          lat: kakaoResult.lat,
          lng: kakaoResult.lng,
          source: "kakao",
          poi_id: null,
        });
      }),
    );

    console.log(`[PindMap:perf] extract.process.kakao ${Date.now() - kakaoT0}ms`, {
      candidates: candidates.length,
      resolved: resolved.length,
      misses: kakaoMissDiags.length,
      poiAdopted: resolved.filter((r) => r.source === "poi").length,
      kakaoKept: resolved.filter((r) => r.source === "kakao").length,
    });

    // 카카오 실패 → POI 검색 폴백
    const pendingPlaces: PendingPlaceJson[] = [];
    const unresolvedAfterPoi: { name: string; tried: number; stages: string[] }[] = [];

    if (kakaoMissDiags.length > 0) {
      await updateJobProgress(jobId, "내부 장소 DB에서 찾는 중");
      const poiT0 = Date.now();
      const origin = averageOrigin(resolved);

      await Promise.all(
        kakaoMissDiags.map(async (miss) => {
          if (miss.overseas) {
            unresolvedAfterPoi.push({
              name: miss.name,
              tried: miss.tried,
              stages: miss.stages,
            });
            return;
          }
          const item = miss.candidate;
          const hintRegion = item.region || item.hint || null;
          const hits: PoiSearchHit[] = await searchPoi(supabase, {
            q: item.name,
            hint_region: hintRegion,
            origin_lat: origin?.lat ?? null,
            origin_lng: origin?.lng ?? null,
            max_results: 5,
          });
          const decision = decidePoiAdoption(hits, {
            hintRegion,
            originLat: origin?.lat ?? null,
            originLng: origin?.lng ?? null,
          });

          if (decision.kind === "adopt") {
            const hit = decision.hit;
            const address =
              (hit.road_address || hit.jibun_address || "").trim() || item.name;
            if (hit.lat == null || hit.lng == null) {
              console.log(formatPoiLowconfLog(item.name, hit.score, "e"));
              unresolvedAfterPoi.push({
                name: miss.name,
                tried: miss.tried,
                stages: [...miss.stages, "poi"],
              });
              return;
            }
            console.log(formatPoiResolvedLog(item.name, hit.score, decision.rule));
            console.log(formatPlaceSourceLog("poi", item.name));
            resolved.push({
              name: item.name,
              category: resolveExtractPlaceCategory({
                claudeCategory: item.category,
                poiRawCategory: hit.raw_category ?? null,
              }),
              address,
              lat: hit.lat,
              lng: hit.lng,
              source: "poi",
              poi_id: hit.id,
            });
            return;
          }

          if (decision.kind === "needs_confirm") {
            console.log(
              formatPoiLowconfLog(item.name, decision.top?.score ?? null, decision.reason),
            );
            console.log(formatPlacePendingLog(item.name, "poi_confirm"));
            pendingPlaces.push({
              name: item.name,
              region: item.region,
              hint: item.hint,
              category: item.category,
              reason: decision.reason,
              top_score: decision.top?.score ?? null,
              candidates: decision.hits.map(toPoiSearchResult),
            });
            unresolvedAfterPoi.push({
              name: miss.name,
              tried: miss.tried,
              stages: [...miss.stages, "poi_confirm"],
            });
            return;
          }

          console.log(
            formatPoiLowconfLog(item.name, decision.top?.score ?? null, decision.reason),
          );
          console.log(formatPlacePendingLog(item.name, "poi_miss"));
          unresolvedAfterPoi.push({
            name: miss.name,
            tried: miss.tried,
            stages: [...miss.stages, "poi_miss"],
          });
        }),
      );

      console.log(`[PindMap:perf] extract.process.poi ${Date.now() - poiT0}ms`, {
        misses: kakaoMissDiags.length,
        pending: pendingPlaces.length,
        resolvedTotal: resolved.length,
      });
    }

    diagPendingPlaces = pendingPlaces;
    const resolvedNames = new Set(resolved.map((r) => r.name));
    diagKakaoMisses = candidateNames.filter((n) => !resolvedNames.has(n));
    await saveJobDiagnostics(jobId, {
      kakao_misses: diagKakaoMisses,
      pending_places: diagPendingPlaces,
    });

    if (resolved.length === 0) {
      const missList =
        unresolvedAfterPoi.length > 0
          ? unresolvedAfterPoi
          : kakaoMissDiags.map(({ name, tried, stages }) => ({ name, tried, stages }));
      const allOverseas =
        kakaoMissDiags.length > 0 && kakaoMissDiags.every((m) => m.overseas);
      throw new Error(
        buildZeroResolvedErrorMessage(missList, { allOverseas }),
      );
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
          pending_places: diagPendingPlaces,
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
      throw new Error(
        buildZeroResolvedErrorMessage(
          unresolvedAfterPoi.length > 0
            ? unresolvedAfterPoi
            : kakaoMissDiags.length > 0
              ? kakaoMissDiags.map(({ name, tried, stages }) => ({ name, tried, stages }))
              : candidateNames.map((name) => {
                  const planned = buildKakaoQueryFallbacks(name);
                  return {
                    name,
                    tried: planned.length,
                    stages: planned.map((q) => q.stage),
                  };
                }),
        ),
      );
    }

    const rows = uniqueResolved.map((p) => ({
      id:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user_id: job.user_id,
      name: p.name,
      address: p.address,
      category: p.category,
      lat: p.lat,
      lng: p.lng,
      source: p.source,
      poi_id: p.poi_id ?? null,
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
      source: r.source,
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
        pending_places: diagPendingPlaces,
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
    console.error("[extract] process route failed", {
      jobId,
      message: message.split("|")[0],
    });
    console.log(`[PindMap:perf] extract.process.failed ${Date.now() - routeT0}ms`);
    if (jobId) {
      try {
        const supabase = createServiceSupabase();
        const { data: jobRow } = await supabase
          .from("extract_jobs")
          .select("instagram_url")
          .eq("id", jobId)
          .maybeSingle();
        if (jobRow?.instagram_url) {
          cacheNegativeFailure(
            supabase,
            jobRow.instagram_url,
            message,
            Array.isArray(diagClaudePlaces)
              ? (diagClaudePlaces as RawPlace[])
              : null,
          );
        }
        await supabase
          .from("extract_jobs")
          .update({
            status: "failed",
            error_message: message,
            progress_step: "실패",
            caption: diagCaption,
            claude_places: diagClaudePlaces,
            kakao_misses: diagKakaoMisses,
            pending_places: diagPendingPlaces,
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
