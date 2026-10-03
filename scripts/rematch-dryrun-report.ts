/**
 * Rematch dry-run report (no places writes).
 * Same gates as /api/admin/rematch after placeCategory + sangga/facility apply filters.
 *
 *   npx tsx scripts/rematch-dryrun-report.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { haversineM } from "../lib/poiMatch";
import { rematchApplyRejectReason } from "../lib/rematchApplyGuards";
import { resolvePlaceViaPoi } from "../lib/resolvePlaceViaPoi";

const ROOT = process.cwd();
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const MAX_MOVE_M = 100;
const BATCH = 100;
/** nearby_poi_batch times out under sangga load — use sequential with small concurrency. */
const CONCURRENCY = 4;

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

async function fetchBySource(
  source: "kakao" | null,
  afterId: string | null,
  limit: number,
): Promise<PlaceRow[]> {
  let q = admin
    .from("places")
    .select("id, name, lat, lng, address, category, source, poi_id")
    .order("id", { ascending: true })
    .limit(limit);
  if (source === "kakao") q = q.eq("source", "kakao");
  else q = q.is("source", null);
  if (afterId) q = q.gt("id", afterId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PlaceRow[];
}

async function main() {
  const bySource: Record<string, number> = {};
  const skipReasons: Record<string, number> = {};
  const samples: Array<Record<string, unknown>> = [];
  let processed = 0;
  let matched = 0;
  let skipped = 0;

  for (const phase of ["kakao", "null"] as const) {
    let afterId: string | null = null;
    for (;;) {
      const places = await fetchBySource(
        phase === "kakao" ? "kakao" : null,
        afterId,
        BATCH,
      );
      if (!places.length) break;

      const work: Array<{
        place: PlaceRow;
        placeName: string;
        lat: number;
        lng: number;
      }> = [];
      for (const place of places) {
        processed += 1;
        const placeName = String(place.name || "")
          .replace(/\|/g, "/")
          .trim();
        const lat = Number(place.lat);
        const lng = Number(place.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !placeName) {
          skipped += 1;
          skipReasons.no_match = (skipReasons.no_match || 0) + 1;
          continue;
        }
        work.push({ place, placeName, lat, lng });
      }

      // Sequential resolve in small parallel chunks (avoids nearby_poi_batch timeout)
      for (let wi = 0; wi < work.length; wi += CONCURRENCY) {
        const chunk = work.slice(wi, wi + CONCURRENCY);
        const resolvedChunk = await Promise.all(
          chunk.map(async (w) => {
            const resolved = await resolvePlaceViaPoi(admin, {
              placeName: w.placeName,
              originLat: w.lat,
              originLng: w.lng,
              placeCategory: w.place.category ?? null,
            });
            return { w, resolved };
          }),
        );

      for (const { w, resolved } of resolvedChunk) {
        if (!resolved?.ok) {
          skipped += 1;
          const reason =
            resolved &&
            (resolved.reason === "all_excluded" ||
              resolved.reason === "no_score")
              ? "low_score"
              : "no_match";
          skipReasons[reason] = (skipReasons[reason] || 0) + 1;
          continue;
        }
        const moveM = haversineM(w.lat, w.lng, resolved.lat, resolved.lng);
        if (moveM >= MAX_MOVE_M) {
          skipped += 1;
          skipReasons.distance = (skipReasons.distance || 0) + 1;
          continue;
        }
        const poi = resolved.match.poi;
        const poiAddress = (poi.road_address || poi.jibun_address || "").trim();
        const reject = rematchApplyRejectReason({
          placeName: w.placeName,
          placeAddress: w.place.address,
          poiName: poi.name,
          poiAddress,
          poiSource: poi.source,
          matchDistM: resolved.match.distM,
        });
        if (reject) {
          skipped += 1;
          skipReasons[reject] = (skipReasons[reject] || 0) + 1;
          continue;
        }
        const poiSource = poi.source || "poi";
        matched += 1;
        bySource[poiSource] = (bySource[poiSource] || 0) + 1;
        if (samples.length < 20) {
          samples.push({
            placeName: w.placeName,
            poiName: poi.name,
            poiSource,
            matchDistM: Math.round(resolved.match.distM * 10) / 10,
            moveM: Math.round(moveM * 10) / 10,
            category: w.place.category,
            placeSource: w.place.source,
          });
        }
      }
      } // concurrency chunks

      afterId = places[places.length - 1]!.id;
      console.log(
        `phase=${phase} processed=${processed} matched=${matched} skipped=${skipped}`,
      );
      if (places.length < BATCH) break;
    }
  }

  const out = {
    processed,
    matched,
    skipped,
    matchedBySource: bySource,
    skipReasons,
    samples,
  };
  const outPath = path.join(
    ROOT,
    "scripts/localdata/out/rematch_dryrun_report.json",
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\n=== REMATCH DRY-RUN ===");
  console.log(
    JSON.stringify(
      { processed, matched, skipped, matchedBySource: bySource, skipReasons },
      null,
      2,
    ),
  );
  console.log("--- samples ---");
  for (const s of samples) {
    console.log(
      `${s.placeSource}|${s.category}|${s.placeName}|${s.poiName}|${s.poiSource}|match=${s.matchDistM}|move=${s.moveM}`,
    );
  }
  console.log("wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
