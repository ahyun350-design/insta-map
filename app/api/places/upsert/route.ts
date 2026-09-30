import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { FEED_POST_CATEGORIES, type FeedPostCategory } from "@/lib/feedPost";
import { isSubCategory } from "@/lib/kakaoSubcategory";
import { resolvePlaceViaPoi } from "@/lib/resolvePlaceViaPoi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = new Set<string>(FEED_POST_CATEGORIES);
type PlaceSource = "kakao" | "user" | "poi";
const PLACE_SOURCES = new Set<string>(["kakao", "user", "poi"]);

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: "서버 환경변수가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const jwt = authHeader.slice(7).trim();

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    const authUser = userData?.user;
    if (userErr || !authUser) {
      return NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 401 });
    }

    const body = (await req.json()) as {
      id?: string;
      name?: string;
      address?: string;
      category?: string;
      subcategory?: string | null;
      lat?: number | string | null;
      lng?: number | string | null;
      source?: string | null;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    let address = typeof body.address === "string" ? body.address.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const subcategoryRaw =
      typeof body.subcategory === "string" ? body.subcategory.trim() : "";
    const latRaw = body.lat;
    const lngRaw = body.lng;
    let lat = typeof latRaw === "number" ? latRaw : latRaw != null ? parseFloat(String(latRaw)) : NaN;
    let lng = typeof lngRaw === "number" ? lngRaw : lngRaw != null ? parseFloat(String(lngRaw)) : NaN;
    let hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const sourceRaw = typeof body.source === "string" ? body.source.trim() : "";
    let source: PlaceSource | null =
      sourceRaw && PLACE_SOURCES.has(sourceRaw) ? (sourceRaw as PlaceSource) : null;
    let poiId: number | null = null;

    if (!id || !name || !category) {
      return NextResponse.json({ error: "id, name, category는 필수입니다." }, { status: 400 });
    }
    if (!CATEGORIES.has(category)) {
      return NextResponse.json({ error: "유효하지 않은 카테고리입니다." }, { status: 400 });
    }
    const subcategory =
      subcategoryRaw && isSubCategory(category as FeedPostCategory, subcategoryRaw)
        ? subcategoryRaw
        : null;

    let admin;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      console.error("[places/upsert] admin client", e);
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const { data: existing, error: existingErr } = await admin
      .from("places")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle<{ id: string; user_id: string }>();
    if (existingErr) {
      console.error("[places/upsert] ownership lookup", existingErr);
      return NextResponse.json({ error: "save_failed" }, { status: 500 });
    }
    if (existing && existing.user_id !== authUser.id) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    // Kakao coords → try poi re-resolve (same helper as extract); match → poi, else keep kakao
    if (source === "kakao" && hasCoords) {
      const poiResolved = await resolvePlaceViaPoi(admin, {
        placeName: name,
        originLat: lat,
        originLng: lng,
      });
      if (poiResolved.ok) {
        address = poiResolved.address;
        lat = poiResolved.lat;
        lng = poiResolved.lng;
        hasCoords = true;
        source = "poi";
        poiId = poiResolved.poiId;
      }
    }

    const { error } = await admin.from("places").upsert({
      id,
      user_id: authUser.id,
      name,
      address,
      category,
      subcategory,
      lat: hasCoords ? lat : null,
      lng: hasCoords ? lng : null,
      ...(source ? { source } : {}),
      ...(source === "poi" ? { poi_id: poiId } : source === "kakao" || source === "user" ? { poi_id: null } : {}),
    });

    if (error) {
      console.error("[places/upsert]", error);
      return NextResponse.json(
        { error: "save_failed", code: error.code ?? null },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      source: source ?? null,
      poi_id: poiId,
    });
  } catch (error) {
    console.error("[places/upsert] 예외", error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
