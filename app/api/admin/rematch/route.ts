import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { haversineM } from "@/lib/poiMatch";
import { resolvePlaceViaPoi } from "@/lib/resolvePlaceViaPoi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_LIMIT = 500;
/** Existing rematch safety: do not move a pin by 100m or more. */
const MAX_MOVE_M = 100;

type PlaceRow = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  source: string | null;
  poi_id: number | null;
};

function readSecret(req: Request): string | null {
  const dedicated = req.headers.get("x-rematch-secret")?.trim();
  if (dedicated) return dedicated;
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

function safePlaceName(name: string): string {
  return (name || "").replace(/\|/g, "/").trim().slice(0, 80);
}

/**
 * Daily / on-demand rematch for places with source null|kakao.
 * Reuses resolvePlaceViaPoi (= nearby_poi RPC + poiMatch rules).
 * Never overwrites name. Skips moves >= 100m.
 *
 * Auth: Authorization: Bearer $REMATCH_SECRET  (or x-rematch-secret)
 * Query/body: cursor?, dryRun?
 */
export async function POST(req: Request) {
  const expected = process.env.REMATCH_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const provided = readSecret(req);
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    console.error("[admin/rematch] admin client", e);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const url = new URL(req.url);
  let cursor = url.searchParams.get("cursor")?.trim() || null;
  let dryRun =
    url.searchParams.get("dryRun") === "true" ||
    url.searchParams.get("dry_run") === "true";

  try {
    const body = (await req.json()) as { cursor?: unknown; dryRun?: unknown };
    if (typeof body.cursor === "string" && body.cursor.trim()) {
      cursor = body.cursor.trim();
    }
    if (body.dryRun === true) dryRun = true;
  } catch {
    /* empty body is fine */
  }

  let query = admin
    .from("places")
    .select("id, name, lat, lng, address, source, poi_id")
    .or("source.is.null,source.eq.kakao")
    .order("id", { ascending: true })
    .limit(BATCH_LIMIT);

  if (cursor) {
    query = query.gt("id", cursor);
  }

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) {
    console.error("[admin/rematch] fetch failed", fetchErr.message);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  const places = (rows ?? []) as PlaceRow[];
  console.log(
    `rematch_run|start|target=${places.length}${dryRun ? "|dryRun=1" : ""}`,
  );

  let matched = 0;
  let skipped = 0;
  let processed = 0;

  for (const place of places) {
    processed += 1;
    const placeName = safePlaceName(place.name || "");
    const lat = typeof place.lat === "number" ? place.lat : Number(place.lat);
    const lng = typeof place.lng === "number" ? place.lng : Number(place.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !placeName) {
      skipped += 1;
      console.log(`rematch_run|skip|${placeName || "?"}|reason=no_match`);
      continue;
    }

    const resolved = await resolvePlaceViaPoi(admin, {
      placeName,
      originLat: lat,
      originLng: lng,
    });

    if (!resolved.ok) {
      skipped += 1;
      const reason =
        resolved.reason === "all_excluded" || resolved.reason === "no_score"
          ? "low_score"
          : "no_match";
      console.log(`rematch_run|skip|${placeName}|reason=${reason}`);
      continue;
    }

    const moveM = haversineM(lat, lng, resolved.lat, resolved.lng);
    if (moveM >= MAX_MOVE_M) {
      skipped += 1;
      console.log(`rematch_run|skip|${placeName}|reason=distance`);
      continue;
    }

    const poiSource = (resolved.match.poi.source || "poi").replace(/\|/g, "/");
    console.log(
      `rematch_run|matched|${placeName}|source=${poiSource}|dist=${Math.round(moveM)}`,
    );

    if (!dryRun) {
      const { error: updErr } = await admin
        .from("places")
        .update({
          lat: resolved.lat,
          lng: resolved.lng,
          address: resolved.address,
          source: "poi",
          poi_id: resolved.poiId,
        })
        .eq("id", place.id);

      if (updErr) {
        console.error("[admin/rematch] update failed", {
          id: place.id,
          message: updErr.message,
        });
        skipped += 1;
        console.log(`rematch_run|skip|${placeName}|reason=no_match`);
        continue;
      }
    }

    matched += 1;
  }

  const nextCursor =
    places.length > 0 ? places[places.length - 1]!.id : null;
  const done = places.length < BATCH_LIMIT;

  console.log(`rematch_run|done|processed=${processed}|matched=${matched}`);

  return NextResponse.json({
    processed,
    matched,
    skipped,
    nextCursor: done ? null : nextCursor,
    done,
    dryRun,
  });
}
