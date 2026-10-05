import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isValidInstagramPostUrl } from "@/app/api/extract/_shared";
import { cleanInstagramUrl } from "@/lib/instagramUrl";
import {
  EXTRACT_PROCESS_TRIGGER_FAILED,
  markExtractJobFailed,
  reclaimStaleExtractJobs,
} from "@/app/api/extract/_reclaim";
import {
  EXTRACT_INTERNAL_HEADER,
  getExtractInternalSecret,
} from "@/app/api/extract/_internalAuth";
import { classifyExtractEntry } from "@/app/api/extract/_entry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const missingEnv: string[] = [];
    if (!supabaseUrl) missingEnv.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!anonKey) missingEnv.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!serviceKey) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return NextResponse.json({ error: `서버 환경변수 미설정: ${missingEnv.join(", ")}` }, { status: 500 });
    }

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const jwt = authHeader.slice(7).trim();
    if (!jwt) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
    const authUser = authData?.user;
    if (authError || !authUser?.id) {
      return NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 401 });
    }
    const userId = authUser.id;

    const adminClient = createClient(
      supabaseUrl,
      serviceKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = (await req.json()) as {
      instagramUrl?: string;
      forceRetry?: boolean;
    };
    const rawUrl = body.instagramUrl?.trim();
    const forceRetry = body.forceRetry === true;

    if (!rawUrl) {
      return NextResponse.json({ error: "instagramUrl이 필요합니다." }, { status: 400 });
    }
    const instagramUrl = cleanInstagramUrl(rawUrl);
    if (!isValidInstagramPostUrl(instagramUrl)) {
      return NextResponse.json({ error: "유효한 Instagram 게시물 URL을 입력해주세요." }, { status: 400 });
    }

    // 신규 추출 전에 이 유저의 오래된 멈춤 job 정리 (크론 대용)
    void reclaimStaleExtractJobs(adminClient, { userId });

    // Same user + same URL already pending/processing → return that job (Share Extension race).
    if (!forceRetry) {
      const { data: existing, error: existingErr } = await adminClient
        .from("extract_jobs")
        .select("id")
        .eq("user_id", userId)
        .eq("instagram_url", instagramUrl)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (existing?.id) {
        return NextResponse.json({ jobId: existing.id, deduped: true });
      }
    }

    if (forceRetry) {
      const { deleteReelCache } = await import("@/lib/reelCache");
      await deleteReelCache(adminClient, instagramUrl);
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
    const internalSecret = getExtractInternalSecret();
    if (!internalSecret) {
      return NextResponse.json({ error: "서버 환경변수 미설정: EXTRACT_INTERNAL_SECRET" }, { status: 500 });
    }

    // Entry for timing only — never log/store User-Agent string
    const entry = classifyExtractEntry(req.headers.get("user-agent"));

    const triggerProcess = async () => {
      const res = await fetch(processUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [EXTRACT_INTERNAL_HEADER]: internalSecret,
        },
        body: JSON.stringify({ jobId, bypassCache: forceRetry, entry }),
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
          await markExtractJobFailed(
            adminClient,
            jobId,
            EXTRACT_PROCESS_TRIGGER_FAILED,
            "처리 시작 실패",
          );
        }
      }
    })();

    return NextResponse.json({ jobId });
  } catch (error) {
    console.error("[extract/start]", error);
    return NextResponse.json({ error: "start_failed" }, { status: 500 });
  }
}
