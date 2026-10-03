import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { haversineM } from "@/lib/poiMatch";
import { rematchApplyRejectReason } from "@/lib/rematchApplyGuards";
import {
  resolvePlaceViaPoi,
  resolvePlacesViaPoiBatch,
  type ResolveViaPoiResult,
} from "@/lib/resolvePlaceViaPoi";

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
  category: string | null;
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
  createdSinceIso: string | null,
): Promise<PlaceRow[]> {
  if (limit <= 0) return [];

  let query = admin
    .from("places")
    .select("id, name, lat, lng, address, category, source, poi_id")
    .order("id", { ascending: true })
    .limit(limit);

  if (source === "kakao") {
    query = query.eq("source", "kakao");
  } else {
    query = query.is("source", null);
  }
  if (createdSinceIso) {
    query = query.gte("created_at", createdSinceIso);
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
  createdSinceIso: string | null,
): Promise<{ places: PlaceRow[]; nextCursor: string | null; done: boolean }> {
  const { phase, afterId } = parseCursor(cursorRaw);
  const places: PlaceRow[] = [];

  if (phase === "kakao") {
    const kakao = await fetchBySource(
      admin,
      "kakao",
      afterId,
      batchLimit,
      createdSinceIso,
    );
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
    const nulls = await fetchBySource(
      admin,
      null,
      null,
      remaining,
      createdSinceIso,
    );
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
  const nulls = await fetchBySource(
    admin,
    null,
    afterId,
    batchLimit,
    createdSinceIso,
  );
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

function parseCreatedSinceDays(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === false) return null;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(3650, Math.floor(n));
}

function createdSinceIsoFromDays(days: number | null): string | null {
  if (days == null) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Daily / on-demand rematch for places with source null|kakao.
 * Reuses resolvePlaceViaPoi (= nearby_poi RPC + poiMatch rules).
 * Never overwrites name. Skips moves >= 100m.
 *
 * Auth: Authorization: Bearer $REMATCH_SECRET  (or x-rematch-secret)
 * Query/body: cursor?, dryRun?, batchSize? (default 150, max 500),
 *   createdSinceDays? (e.g. 7), full? (true = ignore createdSinceDays)
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
  // Default sequential nearby_poi — nearby_poi_batch often times out after sangga load.
  // Set useBatchRpc:true to force batch RPC.
  let useBatchRpc = false;
  let includeResults = false;
  // null = full scan (all source null|kakao). Daily runner sends createdSinceDays:7.
  let createdSinceDays: number | null = parseCreatedSinceDays(
    url.searchParams.get("createdSinceDays"),
  );
  if (
    url.searchParams.get("full") === "true" ||
    url.searchParams.get("full") === "1"
  ) {
    createdSinceDays = null;
  }

  try {
    const body = (await req.json()) as {
      cursor?: unknown;
      dryRun?: unknown;
      batchSize?: unknown;
      useBatchRpc?: unknown;
      includeResults?: unknown;
      createdSinceDays?: unknown;
      full?: unknown;
    };
    if (typeof body.cursor === "string" && body.cursor.trim()) {
      cursor = body.cursor.trim();
    }
    if (body.dryRun === true) dryRun = true;
    if (body.batchSize !== undefined) {
      batchSize = parseBatchSize(body.batchSize);
    }
    if (body.useBatchRpc === false) useBatchRpc = false;
    if (body.includeResults === true) includeResults = true;
    if (body.full === true) {
      createdSinceDays = null;
    } else if (body.createdSinceDays !== undefined) {
      createdSinceDays = parseCreatedSinceDays(body.createdSinceDays);
    }
  } catch {
    /* empty body is fine */
  }

  const createdSinceIso = createdSinceIsoFromDays(createdSinceDays);

  const t0 = Date.now();
  let places: PlaceRow[];
  let nextCursor: string | null;
  let done: boolean;
  let fetchMs = 0;
  try {
    const tFetch = Date.now();
    const batch = await fetchPriorityBatch(
      admin,
      cursor,
      batchSize,
      createdSinceIso,
    );
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
    `rematch_run|start|target=${places.length}|batchSize=${batchSize}|phase=${phaseInfo.phase}|batchRpc=${useBatchRpc ? 1 : 0}|sinceDays=${createdSinceDays ?? "full"}${dryRun ? "|dryRun=1" : ""}`,
  );

  let matched = 0;
  let skipped = 0;
  let processed = 0;
  let resolveMs = 0;
  let rpcMs = 0;
  let matchMs = 0;
  let updateMs = 0;
  let updateCalls = 0;
  const resultRows: Array<{
    placeId: string;
    placeName?: string;
    matched: boolean;
    poiId: number | null;
    poiSource?: string | null;
    poiName?: string | null;
    matchDistM?: number | null;
    moveM?: number | null;
    reason?: string;
  }> = [];
  const matchedBySource: Record<string, number> = {};

  type WorkItem = {
    place: PlaceRow;
    placeName: string;
    placeCategory: string | null;
    lat: number;
    lng: number;
  };
  const work: WorkItem[] = [];

  for (const place of places) {
    processed += 1;
    const placeName = safePlaceName(place.name || "");
    const lat = typeof place.lat === "number" ? place.lat : Number(place.lat);
    const lng = typeof place.lng === "number" ? place.lng : Number(place.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !placeName) {
      skipped += 1;
      console.log(`rematch_run|skip|${placeName || "?"}|reason=no_match`);
      if (includeResults) {
        resultRows.push({
          placeId: place.id,
          placeName,
          matched: false,
          poiId: null,
          reason: "no_match",
        });
      }
      continue;
    }
    work.push({
      place,
      placeName,
      placeCategory: place.category ?? null,
      lat,
      lng,
    });
  }

  // Resolve: batch RPC (≤50 origins/call) or legacy sequential nearby_poi.
  const resolvedById = new Map<string, ResolveViaPoiResult>();
  const tResolveAll = Date.now();
  if (useBatchRpc) {
    const batchMap = await resolvePlacesViaPoiBatch(
      admin,
      work.map((w) => ({
        id: w.place.id,
        placeName: w.placeName,
        originLat: w.lat,
        originLng: w.lng,
        placeCategory: w.placeCategory,
      })),
    );
    for (const [id, r] of batchMap) resolvedById.set(id, r);
  } else {
    for (const w of work) {
      const r = await resolvePlaceViaPoi(admin, {
        placeName: w.placeName,
        originLat: w.lat,
        originLng: w.lng,
        placeCategory: w.placeCategory,
      });
      resolvedById.set(w.place.id, r);
    }
  }
  resolveMs = Date.now() - tResolveAll;
  for (const r of resolvedById.values()) {
    if (r.timing) {
      rpcMs += r.timing.rpcMs;
      matchMs += r.timing.matchMs;
    }
  }

  for (const w of work) {
    const resolved = resolvedById.get(w.place.id);
    if (!resolved) {
      skipped += 1;
      if (includeResults) {
        resultRows.push({
          placeId: w.place.id,
          placeName: w.placeName,
          matched: false,
          poiId: null,
          reason: "no_match",
        });
      }
      continue;
    }

    if (!resolved.ok) {
      skipped += 1;
      const reason =
        resolved.reason === "all_excluded" || resolved.reason === "no_score"
          ? "low_score"
          : "no_match";
      console.log(`rematch_run|skip|${w.placeName}|reason=${reason}`);
      if (includeResults) {
        resultRows.push({
          placeId: w.place.id,
          placeName: w.placeName,
          matched: false,
          poiId: null,
          reason,
        });
      }
      continue;
    }

    const moveM = haversineM(w.lat, w.lng, resolved.lat, resolved.lng);
    if (moveM >= MAX_MOVE_M) {
      skipped += 1;
      console.log(`rematch_run|skip|${w.placeName}|reason=distance`);
      if (includeResults) {
        resultRows.push({
          placeId: w.place.id,
          placeName: w.placeName,
          matched: false,
          poiId: resolved.poiId,
          poiSource: resolved.match.poi.source ?? null,
          matchDistM: resolved.match.distM,
          moveM,
          reason: "distance",
        });
      }
      continue;
    }

    const poi = resolved.match.poi;
    const poiSource = (poi.source || "poi").replace(/\|/g, "/");
    const poiAddress = (poi.road_address || poi.jibun_address || "").trim();
    const applyReject = rematchApplyRejectReason({
      placeName: w.placeName,
      placeAddress: w.place.address,
      poiName: poi.name,
      poiAddress,
      poiSource: poi.source,
      matchDistM: resolved.match.distM,
    });
    if (applyReject) {
      skipped += 1;
      console.log(`rematch_run|skip|${w.placeName}|reason=${applyReject}`);
      if (includeResults) {
        resultRows.push({
          placeId: w.place.id,
          placeName: w.placeName,
          matched: false,
          poiId: resolved.poiId,
          poiSource,
          poiName: poi.name,
          matchDistM: resolved.match.distM,
          moveM,
          reason: applyReject,
        });
      }
      continue;
    }

    console.log(
      `rematch_run|matched|${w.placeName}|source=${poiSource}|dist=${Math.round(moveM)}`,
    );

    if (!dryRun) {
      // 변경 전 스냅샷 (테이블 없음 — 구조화 로그로 남김)
      console.log(
        `rematch_run|before|${JSON.stringify({
          id: w.place.id,
          lat: w.lat,
          lng: w.lng,
          address: w.place.address,
          source: w.place.source,
          poi_id: w.place.poi_id,
        })}`,
      );
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
        .eq("id", w.place.id);
      updateMs += Date.now() - tUpd;
      updateCalls += 1;

      if (updErr) {
        console.error("[admin/rematch] update failed", {
          id: w.place.id,
          message: updErr.message,
        });
        skipped += 1;
        console.log(`rematch_run|skip|${w.placeName}|reason=no_match`);
        if (includeResults) {
          resultRows.push({
            placeId: w.place.id,
            placeName: w.placeName,
            matched: false,
            poiId: resolved.poiId,
            reason: "no_match",
          });
        }
        continue;
      }
    }

    matched += 1;
    matchedBySource[poiSource] = (matchedBySource[poiSource] || 0) + 1;
    if (includeResults) {
      resultRows.push({
        placeId: w.place.id,
        placeName: w.placeName,
        matched: true,
        poiId: resolved.poiId,
        poiSource,
        poiName: poi.name,
        matchDistM: resolved.match.distM,
        moveM,
      });
    }
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
    useBatchRpc,
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
    matchedBySource,
    batchSize,
    createdSinceDays,
    nextCursor: done ? null : nextCursor,
    done,
    dryRun,
    useBatchRpc,
    timing,
    ...(includeResults ? { results: resultRows } : {}),
  });
}
