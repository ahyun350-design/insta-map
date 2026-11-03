/**
 * Admin MapLibre place card details for a tapped basemap label.
 * - 상가 row (public data): nearest same-name row via sangga_places_near (RLS: service role only)
 * - Kakao keyword: one call, adopted only for a name match ≤100m. Phone / place_url are
 *   returned for display only — never stored (Kakao terms).
 * - PindMap saves: distinct users with a same-name place ≤100m (read-only count).
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isMapPreviewE2eTokenValid } from "@/lib/mapPreviewAccess";
import {
  countSavedUsers,
  normalizePlaceName,
  pickKakaoDoc,
  pickSanggaRow,
  type KakaoDocLite,
  type SanggaNearRow,
  type SavedPlaceLite,
} from "@/lib/mapPlaceMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_USER_ID = "63772749-e01b-4396-a41c-c17a4d3acfe6";
const KAKAO_TIMEOUT_MS = 3500;
const SAVED_RADIUS_M = 100;

async function requireAdmin(req: Request): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string }
> {
  // Playwright (non-admin e2e account): same server-secret token that opens /map-preview.
  if (isMapPreviewE2eTokenValid(req.headers.get("x-pindmap-e2e"))) return { ok: true };
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: "server_misconfigured" };
  }
  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const jwt = authHeader.slice(7).trim();
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (userData.user.id !== ADMIN_USER_ID) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true };
}

type Body = { name?: unknown; lat?: unknown; lng?: unknown; kind?: unknown };

async function kakaoLookup(
  name: string,
  lat: number,
  lng: number,
  stationOnly: boolean,
): Promise<{ doc: KakaoDocLite | null; called: boolean; error: string | null }> {
  const restKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!restKey) return { doc: null, called: false, error: "no_key" };
  const endpoint = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  endpoint.searchParams.set("query", name);
  endpoint.searchParams.set("x", String(lng));
  endpoint.searchParams.set("y", String(lat));
  endpoint.searchParams.set("radius", String(SAVED_RADIUS_M));
  endpoint.searchParams.set("sort", "distance");
  endpoint.searchParams.set("size", "5");
  try {
    const res = await fetch(endpoint.toString(), {
      headers: { Authorization: `KakaoAK ${restKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
    });
    if (!res.ok) return { doc: null, called: true, error: `http_${res.status}` };
    const data = (await res.json()) as { documents?: KakaoDocLite[] };
    const docs = (data.documents ?? []).filter(
      (d) => !stationOnly || normalizePlaceName(d.place_name).startsWith(normalizePlaceName(name)),
    );
    return { doc: pickKakaoDoc(name, lat, lng, docs), called: true, error: null };
  } catch {
    return { doc: null, called: true, error: "fetch_failed" };
  }
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const t0 = Date.now();
  // Tile points come from the same CSV rows → 5m for 상가 labels; OMT shops 50m.
  // Stations / parks / landmarks are not 상가 rows (a nearby "홍대입구…" shop is not the station).
  const sanggaRadius = kind === "sangga" ? 5 : 50;
  const wantsSangga = kind === "sangga" || kind === "shop";
  const kakaoQuery = kind === "station" && !name.endsWith("역") ? `${name}역` : name;
  const latPad = SAVED_RADIUS_M / 111320;
  const lngPad = SAVED_RADIUS_M / (111320 * Math.cos((lat * Math.PI) / 180));

  const [sanggaRes, kakaoRes, savedRes] = await Promise.all([
    wantsSangga
      ? admin.rpc("sangga_places_near", { p_lat: lat, p_lng: lng, p_radius_m: sanggaRadius })
      : Promise.resolve({ data: [], error: null }),
    kakaoLookup(kakaoQuery, lat, lng, kind === "station"),
    admin
      .from("places")
      .select("user_id,name,lat,lng")
      .gte("lat", lat - latPad)
      .lte("lat", lat + latPad)
      .gte("lng", lng - lngPad)
      .lte("lng", lng + lngPad)
      .limit(500),
  ]);

  const sangga = sanggaRes.error
    ? null
    : pickSanggaRow(name, (sanggaRes.data ?? []) as SanggaNearRow[], sanggaRadius);
  const savedUsers = savedRes.error
    ? null
    : countSavedUsers(name, lat, lng, (savedRes.data ?? []) as SavedPlaceLite[], SAVED_RADIUS_M);
  const doc = kakaoRes.doc;

  return NextResponse.json({
    sangga: sangga
      ? {
          roadAddress: sangga.road_address,
          floor: sangga.floor,
          indM: sangga.ind_m_name,
          indS: sangga.ind_s_name,
          poiClass: sangga.poi_class,
          distM: Math.round(sangga.dist_m * 10) / 10,
        }
      : null,
    kakao: doc
      ? { id: doc.id, phone: doc.phone || null, placeUrl: doc.place_url || null }
      : null,
    savedUsers,
    diag: {
      kakaoCalls: kakaoRes.called ? 1 : 0,
      kakaoError: kakaoRes.error,
      sanggaError: sanggaRes.error ? "rpc_failed" : null,
      savedError: savedRes.error ? "query_failed" : null,
      ms: Date.now() - t0,
    },
  });
}
