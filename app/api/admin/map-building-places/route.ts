/**
 * Admin MapLibre address card: candidates for "이 건물의 장소".
 * Uses existing sangga_places_near (point gist, ~20m, LIMIT 30). No writes.
 * Road-address filtering happens on the client (see lib/buildingPlaces.ts).
 * Kakao is not queried here — never stored / cached.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminRouteGate";
import {
  BUILDING_PLACES_RADIUS_M,
  type BuildingPlaceCandidate,
} from "@/lib/buildingPlaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { lat?: unknown; lng?: unknown };

type SanggaNearRow = {
  bizes_id?: string;
  name?: string;
  branch?: string | null;
  ind_m_name?: string | null;
  ind_s_name?: string | null;
  poi_class?: string | null;
  road_address?: string | null;
  floor?: string | null;
  lat?: number;
  lng?: number;
  dist_m?: number;
};

function toCandidate(r: SanggaNearRow): BuildingPlaceCandidate | null {
  const id = typeof r.bizes_id === "string" ? r.bizes_id.trim() : "";
  const name = typeof r.name === "string" ? r.name.trim() : "";
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  const distM = Number(r.dist_m);
  if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(distM)) {
    return null;
  }
  const category =
    (typeof r.poi_class === "string" && r.poi_class.trim()) ||
    (typeof r.ind_s_name === "string" && r.ind_s_name.trim()) ||
    (typeof r.ind_m_name === "string" && r.ind_m_name.trim()) ||
    null;
  return {
    id,
    name,
    branch: typeof r.branch === "string" && r.branch.trim() ? r.branch.trim() : null,
    category,
    floor: typeof r.floor === "string" && r.floor.trim() ? r.floor.trim() : null,
    roadAddress:
      typeof r.road_address === "string" && r.road_address.trim()
        ? r.road_address.trim()
        : null,
    lat,
    lng,
    distM,
  };
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
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  const t0 = Date.now();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("sangga_places_near", {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: BUILDING_PLACES_RADIUS_M,
  });

  if (error) {
    return NextResponse.json(
      {
        candidates: [] as BuildingPlaceCandidate[],
        diag: { rpcError: "rpc_failed", ms: Date.now() - t0, radiusM: BUILDING_PLACES_RADIUS_M },
      },
      { status: 200 },
    );
  }

  const candidates = ((data ?? []) as SanggaNearRow[])
    .map(toCandidate)
    .filter((c): c is BuildingPlaceCandidate => c != null);

  return NextResponse.json({
    candidates,
    diag: {
      rpcError: null,
      count: candidates.length,
      ms: Date.now() - t0,
      radiusM: BUILDING_PLACES_RADIUS_M,
    },
  });
}
