import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { haversineM } from "@/lib/poiMatch";
import { resolvePlaceViaPoi } from "@/lib/resolvePlaceViaPoi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BATCH_SIZE = 150;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 500;
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

type Phase = "kakao" | "null";

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

function parseBatchSize(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, Math.floor(n)));
}

/** Cursor encodes phase so kakao is fully drained before null. */
function parseCursor(raw: string | null): { phase: Phase; afterId: string | null } {
  if (!raw) return { phase: "kakao", afterId: null };
  if (raw.startsWith("k:")) {
    const id = raw.slice(2).trim();
    return { phase: "kakao", afterId: id || null };
  }
  if (raw.startsWith("n:")) {
    const id = raw.slice(2).trim();
    return { phase: "null", afterId: id || null };
  }
  // Legacy bare uuid → continue kakao phase
  return { phase: "kakao", afterId: raw };
}

function encodeCursor(phase: Phase, id: string): string {
  return `${phase === "kakao" ? "k" : "n"}:${id}`;
}

async function fetchBySource(
  admin: SupabaseClient,
  source: "kakao" | null,
  afterId: string | null,
  limit: number,
): Promise<PlaceRow[]> {
  if (limit <= 0) return [];

  let query = admin
    .from("places")
    .select("id, name, lat, lng, address, source, poi_id")
    .order("id", { ascending: true })
    .limit(limit);

  if (source === "kakao") {
    query = query.eq("source", "kakao");
  } else {
    query = query.is("source", null);
  }
  if (afterId) {
    query = query.gt("id", afterId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as PlaceRow[];
}

/**
 * Priority: kakao first (fresh saves), then source IS NULL (residuals).
 * Fills one batch up to batchLimit, spanning phases if needed.
 */
async function fetchPriorityBatch(
  admin: SupabaseClient,
  cursorRaw: string | null,
  batchLimit: number,
): Promise<{ places: PlaceRow[]; nextCursor: string | null; done: boolean }> {
  const { phase, afterId } = parseCursor(cursorRaw);
  const places: PlaceRow[] = [];

  if (phase === "kakao") {
    const kakao = await fetchBySource(admin, "kakao", afterId, batchLimit);
    places.push(...kakao);
    if (kakao.length === batchLimit) {
      return {
        places,
        nextCursor: encodeCursor("kakao", kakao[kakao.length - 1]!.id),
        done: false,
      };
    }
    // kakao exhausted — fill remainder from null in this same batch
    const remaining = batchLimit - places.length;
    const nulls = await fetchBySource(admin, null, null, remaining);
    places.push(...nulls);
    if (nulls.length === remaining && remaining > 0) {
      return {
        places,
        nextCursor: encodeCursor("null", nulls[nulls.length - 1]!.id),
        done: false,
      };
    }
    return { places, nextCursor: null, done: true };
  }

  // phase === null
  const nulls = await fetchBySource(admin, null, afterId, batchLimit);
  places.push(...nulls);
  if (nulls.length === batchLimit) {
    return {
      places,
      nextCursor: encodeCursor("null", nulls[nulls.length - 1]!.id),
      done: false,
    };
  }
  return { places, nextCursor: null, done: true };
}

/**
 * Daily / on-demand rematch for places with source null|kakao.
 * Reuses resolvePlaceViaPoi (= nearby_poi RPC + poiMatch rules).
 * Never overwrites name. Skips moves >= 100m.
 *
 * Auth: Authorization: Bearer $REMATCH_SECRET  (or x-rematch-secret)
 * Query/body: cursor?, dryRun?, batchSize? (default 150, max 500)
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
  let batchSize = parseBatchSize(url.searchParams.get("batchSize"));

  try {
    const body = (await req.json()) as {
      cursor?: unknown;
      dryRun?: unknown;
      batchSize?: unknown;
    };
    if (typeof body.cursor === "string" && body.cursor.trim()) {
      cursor = body.cursor.trim();
    }
    if (body.dryRun === true) dryRun = true;
    if (body.batchSize !== undefined) {
      batchSize = parseBatchSize(body.batchSize);
    }
  } catch {
    /* empty body is fine */
  }

  const t0 = Date.now();
  let places: PlaceRow[];
  let nextCursor: string | null;
  let done: boolean;
  let fetchMs = 0;
  try {
    const tFetch = Date.now();
    const batch = await fetchPriorityBatch(admin, cursor, batchSize);
    fetchMs = Date.now() - tFetch;
    places = batch.places;
    nextCursor = batch.nextCursor;
    done = batch.done;
  } catch (e) {
    console.error("[admin/rematch] fetch failed", e);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  const phaseInfo = parseCursor(cursor);
  console.log(
    `rematch_run|start|target=${places.length}|batchSize=${batchSize}|phase=${phaseInfo.phase}${dryRun ? "|dryRun=1" : ""}`,
  );

  let matched = 0;
  let skipped = 0;
  let processed = 0;
  let resolveMs = 0;
  let rpcMs = 0;
  let matchMs = 0;
  let updateMs = 0;
  let updateCalls = 0;

  // Sequential on purpose — each place is one nearby_poi RPC.
  // Parallelism (e.g. 10) would multiply DB load; skipped to stay under Supabase limits.
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

    const tResolve = Date.now();
    const resolved = await resolvePlaceViaPoi(admin, {
      placeName,
      originLat: lat,
      originLng: lng,
    });
    const resolveElapsed = Date.now() - tResolve;
    resolveMs += resolveElapsed;
    if (resolved.timing) {
      rpcMs += resolved.timing.rpcMs;
      matchMs += resolved.timing.matchMs;
    }

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
      const tUpd = Date.now();
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
      updateMs += Date.now() - tUpd;
      updateCalls += 1;

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

  const totalMs = Date.now() - t0;
  const n = Math.max(processed, 1);
  const timing = {
    fetchMs,
    resolveMs,
    rpcMs,
    matchMs,
    updateMs,
    updateCalls,
    totalMs,
    perPlaceMs: Math.round(totalMs / n),
    perPlaceResolveMs: Math.round(resolveMs / n),
    perPlaceRpcMs: Math.round(rpcMs / n),
    perPlaceMatchMs: Math.round(matchMs / n),
  };
  console.log(
    `rematch_run|done|processed=${processed}|matched=${matched}|timing=${JSON.stringify(timing)}`,
  );

  return NextResponse.json({
    processed,
    matched,
    skipped,
    batchSize,
    nextCursor: done ? null : nextCursor,
    done,
    dryRun,
    timing,
  });
}
