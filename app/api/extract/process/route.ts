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

const CAPTION_MAX_CHARS = 2000;

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

type ResolvedPlace = {
  name: string;
  category: Place["category"];
  address: string;
  lat: number;
  lng: number;
};


const OVERSEAS_KR_PLACES = [
  "도쿄",
  "오사카",
  "교토",
  "후쿠오카",
  "삿포로",
  "나고야",
  "요코하마",
  "오키나와",
  "일본",
  "방콕",
  "치앙마이",
  "태국",
  "다낭",
  "하노이",
  "호치민",
  "베트남",
  "싱가포르",
  "타이베이",
  "대만",
  "상하이",
  "베이징",
  "홍콩",
  "마카오",
  "중국",
  "파리",
  "프랑스",
  "런던",
  "영국",
  "뉴욕",
  "미국",
  "로마",
  "이탈리아",
  "바르셀로나",
  "스페인",
  "로스앤젤레스",
] as const;

/** 영문 지명 — 단독 매칭 금지(상호 USA 등 오탐). 해시태그·여행 문맥만 */
const OVERSEAS_EN_PLACES = [
  "Tokyo",
  "Osaka",
  "Kyoto",
  "Fukuoka",
  "Sapporo",
  "Nagoya",
  "Yokohama",
  "Okinawa",
  "Japan",
  "Bangkok",
  "Chiang Mai",
  "Thailand",
  "Danang",
  "Da Nang",
  "Hanoi",
  "Ho Chi Minh",
  "Vietnam",
  "Singapore",
  "Taipei",
  "Taiwan",
  "Shanghai",
  "Beijing",
  "Hong Kong",
  "Macau",
  "China",
  "Paris",
  "France",
  "London",
  "England",
  "New York",
  "USA",
  "America",
  "Rome",
  "Italy",
  "Barcelona",
  "Spain",
  "Los Angeles",
] as const;

/** 국내 시·구·동·핫플 — 하나라도 있으면 해외 판정 금지 */
const DOMESTIC_REGION_HINTS = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "제주",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "성수",
  "성수동",
  "홍대",
  "연남",
  "합정",
  "망원",
  "이태원",
  "한남",
  "잠실",
  "여의도",
  "판교",
  "해운대",
  "광안리",
  "서면",
  "강남",
  "역삼",
  "선릉",
  "삼성",
  "청담",
  "압구정",
  "신사",
  "명동",
  "을지로",
  "종로",
  "인사동",
  "삼청",
  "북촌",
  "서촌",
  "건대",
  "신촌",
  "마포",
  "영등포",
  "노량진",
  "혜화",
  "속초",
  "강릉",
  "여수",
  "경주",
  "전주",
  "수원",
  "북한산",
  "북한강",
] as const;

const KR_TRAVEL_CONTEXT = "여행|관광|출장|에서|갔다|다녀|맛집|휴가|비행|공항";
const EN_TRAVEL_CONTEXT = "trip|travel|tour|vacation|visited|visiting|airport|flight";

function hasKana(text: string): boolean {
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 캡션에 국내 지역 신호가 있으면 true — 있으면 해외로 보지 않음 */
function hasDomesticRegionInCaption(caption: string): boolean {
  const t = caption.trim();
  if (!t) return false;
  for (const a of DOMESTIC_REGION_HINTS) {
    if (t.includes(a)) return true;
  }
  if (/[가-힣]{1,12}(?:특별시|광역시|특별자치시|특별자치도)/.test(t)) return true;
  if (/[가-힣]{2,12}(?:시|군|구|동|읍|면)/.test(t)) return true;
  return false;
}

/**
 * 캡션만 본다(상호명 목록 제외).
 * 해시태그·여행 문맥·가나/일본 주소형만 신호. 확 아니면 신호 없음.
 * 북한·단독 USA/LA 등 오탐 유발 패턴 제외.
 */
function collectOverseasCaptionSignals(caption: string): string[] {
  const t = caption.trim();
  if (!t) return [];
  const found: string[] = [];

  for (const m of t.matchAll(/#([^\s#]+)/g)) {
    const tag = m[1] ?? "";
    for (const city of OVERSEAS_KR_PLACES) {
      if (tag.includes(city)) {
        found.push(`hashtag:${tag}`);
        break;
      }
    }
    for (const city of OVERSEAS_EN_PLACES) {
      if (new RegExp(escapeRegExp(city).replace(/ /g, "\\s*"), "i").test(tag)) {
        found.push(`hashtag:${tag}`);
        break;
      }
    }
  }

  for (const city of OVERSEAS_KR_PLACES) {
    const c = escapeRegExp(city);
    const forward = new RegExp(`${c}.{0,14}(?:${KR_TRAVEL_CONTEXT})`);
    const backward = new RegExp(`(?:${KR_TRAVEL_CONTEXT}).{0,14}${c}`);
    if (forward.test(t) || backward.test(t)) found.push(`kr_ctx:${city}`);
  }

  for (const city of OVERSEAS_EN_PLACES) {
    const c = escapeRegExp(city).replace(/ /g, "\\s+");
    const word = new RegExp(`\\b${c}\\b`, "i");
    if (!word.test(t)) continue;
    const forward = new RegExp(`\\b${c}\\b.{0,16}(?:${EN_TRAVEL_CONTEXT}|여행|관광|출장)`, "i");
    const backward = new RegExp(`(?:${EN_TRAVEL_CONTEXT}|in|at|to|from|여행|관광|출장).{0,16}\\b${c}\\b`, "i");
    if (forward.test(t) || backward.test(t)) found.push(`en_ctx:${city}`);
  }

  if (hasKana(t)) found.push("kana");
  if (/(東京都|大阪府|京都府|北海道|\bPrefecture\b|\bChome\b)/i.test(t)) {
    found.push("jp_addr");
  }

  return [...new Set(found)];
}

/**
 * 카카오 전부 실패 후에만 호출.
 * 해외 = 캡션 해외 신호 있음 ∧ 국내 지역 없음 ∧ (호출부에서) 카카오 0건.
 */
function shouldClassifyAsOverseasAfterKakaoMiss(caption: string): {
  overseas: boolean;
  signals: string[];
  hasDomestic: boolean;
} {
  const hasDomestic = hasDomesticRegionInCaption(caption);
  const signals = collectOverseasCaptionSignals(caption);
  if (hasDomestic) {
    return { overseas: false, signals, hasDomestic };
  }
  if (signals.length === 0) {
    return { overseas: false, signals, hasDomestic };
  }
  return { overseas: true, signals, hasDomestic };
}

function formatExtractFailCode(code: string, names: string[]): string {
  const joined = names.slice(0, 8).join(",");
  return joined ? `${code}|${joined}` : code;
}

/** resolved === 0 원인 코드 (+ 카카오 미스 장소명, 분석용) */
function buildZeroResolvedErrorMessage(caption: string, candidateNames: string[]): string {
  if (candidateNames.length === 0) {
    return "no_places_in_caption";
  }
  const verdict = shouldClassifyAsOverseasAfterKakaoMiss(caption);
  console.log("[extract] zero-resolved overseas check", {
    overseas: verdict.overseas,
    hasDomestic: verdict.hasDomestic,
    signals: verdict.signals.slice(0, 8),
    names: candidateNames.slice(0, 8),
  });
  if (verdict.overseas) {
    return formatExtractFailCode("overseas_unsupported", candidateNames);
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
    await updateJobProgress(jobId, "인스타 캡션 가져오는 중");
    const scrapeT0 = Date.now();
    const caption = await scrapeInstagramCaption(job.instagram_url);
    console.log(`[PindMap:perf] extract.process.scrape ${Date.now() - scrapeT0}ms`);
    diagCaption = truncateCaption(caption);
    await saveJobDiagnostics(jobId, { caption: diagCaption });

    await updateJobProgress(jobId, "AI가 장소 분석하는 중");
    const aiT0 = Date.now();
    const rawPlaces = await extractPlacesByClaude(caption);
    console.log(`[PindMap:perf] extract.process.ai ${Date.now() - aiT0}ms`);
    diagClaudePlaces = rawPlaces;
    await saveJobDiagnostics(jobId, { claude_places: diagClaudePlaces });

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

    // 해외 판정은 카카오 전부 실패 후에만 (오탐으로 국내 상호를 막지 않음)
    await updateJobProgress(jobId, "카카오맵에서 좌표 찾는 중");
    const kakaoT0 = Date.now();
    const resolved: ResolvedPlace[] = [];
    for (const item of candidates) {
      const kakaoResult = await searchKakaoPlace(item.name, item.hint, undefined, caption);
      if (kakaoResult) {
        resolved.push({
          name: item.name,
          category: item.category,
          address: kakaoResult.roadAddress || kakaoResult.address,
          lat: kakaoResult.lat,
          lng: kakaoResult.lng,
        });
      }
    }
    console.log(`[PindMap:perf] extract.process.kakao ${Date.now() - kakaoT0}ms`);

    const resolvedNames = new Set(resolved.map((r) => r.name));
    diagKakaoMisses = candidateNames.filter((n) => !resolvedNames.has(n));
    await saveJobDiagnostics(jobId, { kakao_misses: diagKakaoMisses });

    if (resolved.length === 0) {
      throw new Error(buildZeroResolvedErrorMessage(caption, candidateNames));
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
      // 113과 동일 원인 분류(이론상 resolved===0일 때만 도달; 중복은 위에서 completed 처리)
      throw new Error(buildZeroResolvedErrorMessage(caption, candidateNames));
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
