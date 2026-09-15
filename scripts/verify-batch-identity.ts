/**
 * Direct A/B verify: resolvePlaceViaPoi vs resolvePlacesViaPoiBatch.
 * Same places + 100m rule. dryRun (no DB writes).
 *
 *   npx tsx scripts/verify-batch-identity.ts
 *   BATCH_SIZE=150 npx tsx scripts/verify-batch-identity.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  resolvePlaceViaPoi,
  resolvePlacesViaPoiBatch,
  type ResolveViaPoiResult,
} from "../lib/resolvePlaceViaPoi";
import { haversineM } from "../lib/poiMatch";

function findRoot(): string {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    process.cwd(),
    resolve(process.cwd(), ".."),
    resolve(process.cwd(), "../.."),
  ];
  for (const c of candidates) {
    try {
      readFileSync(resolve(c, ".env.local"), "utf8");
      return c;
    } catch {
      /* try next */
    }
  }
  return process.cwd();
}

const root = findRoot();

function loadEnvLocal() {
  const p = resolve(root, ".env.local");
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2]!;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]!]) process.env[m[1]!] = v;
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("missing supabase env");
  process.exit(2);
}

const BATCH_SIZE = Number(process.env.BATCH_SIZE || 150);
const MAX_MOVE_M = 100;

type PlaceRow = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
};

function safePlaceName(name: string): string {
  return (name || "").replace(/\|/g, "/").trim().slice(0, 80);
}

type Outcome = {
  placeId: string;
  matched: boolean;
  poiId: number | null;
  reason?: string;
};

function applySafety(
  place: PlaceRow,
  resolved: ResolveViaPoiResult | undefined,
): Outcome {
  const placeName = safePlaceName(place.name || "");
  const lat = typeof place.lat === "number" ? place.lat : Number(place.lat);
  const lng = typeof place.lng === "number" ? place.lng : Number(place.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !placeName) {
    return { placeId: place.id, matched: false, poiId: null, reason: "no_match" };
  }
  if (!resolved || !resolved.ok) {
    const reason =
      resolved &&
      (resolved.reason === "all_excluded" || resolved.reason === "no_score")
        ? "low_score"
        : "no_match";
    return { placeId: place.id, matched: false, poiId: null, reason };
  }
  const moveM = haversineM(lat, lng, resolved.lat, resolved.lng);
  if (moveM >= MAX_MOVE_M) {
    return {
      placeId: place.id,
      matched: false,
      poiId: resolved.poiId,
      reason: "distance",
    };
  }
  return { placeId: place.id, matched: true, poiId: resolved.poiId };
}

function fp(r: Outcome): string {
  return r.matched
    ? `M:${r.poiId}`
    : `S:${r.reason || "?"}:${r.poiId ?? ""}`;
}

async function main() {
  const admin = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("places")
    .select("id, name, lat, lng")
    .eq("source", "kakao")
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;
  const places = (data || []) as PlaceRow[];
  console.log(`verify|fetched=${places.length}`);

  const work = places.map((p) => ({
    place: p,
    placeName: safePlaceName(p.name || ""),
    lat: typeof p.lat === "number" ? p.lat : Number(p.lat),
    lng: typeof p.lng === "number" ? p.lng : Number(p.lng),
  }));

  const tSeq = Date.now();
  const seqMap = new Map<string, ResolveViaPoiResult>();
  for (const w of work) {
    if (!Number.isFinite(w.lat) || !Number.isFinite(w.lng) || !w.placeName) {
      seqMap.set(w.place.id, {
        ok: false,
        reason: "empty_name",
        nearbyCount: 0,
      });
      continue;
    }
    seqMap.set(
      w.place.id,
      await resolvePlaceViaPoi(admin, {
        placeName: w.placeName,
        originLat: w.lat,
        originLng: w.lng,
      }),
    );
  }
  const seqWall = Date.now() - tSeq;
  const seqResults = places.map((p) => applySafety(p, seqMap.get(p.id)));

  const tBat = Date.now();
  const batMap = await resolvePlacesViaPoiBatch(
    admin,
    work
      .filter(
        (w) => Number.isFinite(w.lat) && Number.isFinite(w.lng) && w.placeName,
      )
      .map((w) => ({
        id: w.place.id,
        placeName: w.placeName,
        originLat: w.lat,
        originLng: w.lng,
      })),
  );
  for (const w of work) {
    if (!batMap.has(w.place.id)) {
      batMap.set(w.place.id, {
        ok: false,
        reason: "empty_name",
        nearbyCount: 0,
      });
    }
  }
  const batWall = Date.now() - tBat;
  const batResults = places.map((p) => applySafety(p, batMap.get(p.id)));

  const diffs: Array<{
    placeId: string;
    name: string;
    sequential: string;
    batch: string;
  }> = [];
  for (let i = 0; i < places.length; i++) {
    const a = fp(seqResults[i]!);
    const b = fp(batResults[i]!);
    if (a !== b) {
      diffs.push({
        placeId: places[i]!.id,
        name: places[i]!.name,
        sequential: a,
        batch: b,
      });
    }
  }

  const summary = {
    n: places.length,
    seqWallMs: seqWall,
    batWallMs: batWall,
    speedup: Number((seqWall / Math.max(batWall, 1)).toFixed(2)),
    seqMatched: seqResults.filter((r) => r.matched).length,
    batMatched: batResults.filter((r) => r.matched).length,
    diffs: diffs.length,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (diffs.length) {
    console.error("FAIL identity");
    for (const d of diffs.slice(0, 40)) console.error(d);
    process.exit(1);
  }
  console.log("PASS identical");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
