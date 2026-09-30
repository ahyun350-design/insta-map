/**
 * Mark extract job review as done (reviewed_at = now()).
 * Also strip lat/lng/address from result_places (keep id/name/category/…).
 * requireBearerUser + user_id scoped UPDATE; foreign/missing job → 404.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireBearerUser } from "@/lib/requireBearerUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stripResultPlacesGeo(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw ?? [];
  return raw.map((elem) => {
    if (!elem || typeof elem !== "object" || Array.isArray(elem)) return elem;
    const obj = { ...(elem as Record<string, unknown>) };
    delete obj.lat;
    delete obj.lng;
    delete obj.address;
    return obj;
  });
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "서버 환경변수 미설정" }, { status: 500 });
    }

    const auth = await requireBearerUser(req);
    if ("error" in auth) return auth.error;
    const userId = auth.user.id;

    const body = (await req.json()) as { jobId?: string };
    const jobId = body.jobId?.trim();
    if (!jobId) {
      return NextResponse.json({ error: "jobId가 필요합니다." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existing, error: findError } = await admin
      .from("extract_jobs")
      .select("id, reviewed_at, result_places")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();

    if (findError) throw findError;
    if (!existing) {
      return NextResponse.json({ error: "작업을 찾을 수 없어요." }, { status: 404 });
    }
    if (existing.reviewed_at) {
      return NextResponse.json({ ok: true, updated: false });
    }

    const stripped = stripResultPlacesGeo(existing.result_places);

    const { data, error } = await admin
      .from("extract_jobs")
      .update({
        reviewed_at: new Date().toISOString(),
        result_places: stripped,
      })
      .eq("id", jobId)
      .eq("user_id", userId)
      .is("reviewed_at", null)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ ok: true, updated: !!data?.id });
  } catch (e) {
    console.error("[extract/mark-reviewed]", e);
    return NextResponse.json({ error: "mark_reviewed_failed" }, { status: 500 });
  }
}
