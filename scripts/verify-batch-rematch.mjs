#!/usr/bin/env node
/**
 * dryRun A/B: sequential nearby_poi vs nearby_poi_batch on the same cursor.
 * Fails if matched place→poi sets differ.
 *
 * Usage:
 *   REMATCH_SECRET=... BASE_URL=http://127.0.0.1:3457 node scripts/verify-batch-rematch.mjs
 *   Optional: BATCH_SIZE=150 CURSOR=
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3457").replace(/\/$/, "");
const SECRET = process.env.REMATCH_SECRET || "local-rematch-test-secret";
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 150);
const CURSOR = process.env.CURSOR || null;

async function rematch(useBatchRpc) {
  const body = {
    dryRun: true,
    batchSize: BATCH_SIZE,
    useBatchRpc,
    includeResults: true,
  };
  if (CURSOR) body.cursor = CURSOR;

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/admin/rematch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(body),
  });
  const wallMs = Date.now() - t0;
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`non-json ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`http ${res.status}: ${JSON.stringify(json)}`);
  }
  return { wallMs, json };
}

function fingerprint(results) {
  const map = new Map();
  for (const r of results || []) {
    const key = r.placeId;
    const val = r.matched
      ? `M:${r.poiId}`
      : `S:${r.reason || "?"}:${r.poiId ?? ""}`;
    map.set(key, val);
  }
  return map;
}

function compare(a, b) {
  const diffs = [];
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const av = a.get(k);
    const bv = b.get(k);
    if (av !== bv) diffs.push({ placeId: k, sequential: av, batch: bv });
  }
  return diffs;
}

async function main() {
  console.log(
    `verify-batch-rematch|base=${BASE}|batchSize=${BATCH_SIZE}|cursor=${CURSOR || "(start)"}`,
  );

  console.log("verify-batch-rematch|run=sequential (useBatchRpc:false) ...");
  const seq = await rematch(false);
  console.log(
    `verify-batch-rematch|sequential|processed=${seq.json.processed}|matched=${seq.json.matched}|skipped=${seq.json.skipped}|wallMs=${seq.wallMs}|timing=${JSON.stringify(seq.json.timing)}`,
  );

  console.log("verify-batch-rematch|run=batch (useBatchRpc:true) ...");
  const bat = await rematch(true);
  console.log(
    `verify-batch-rematch|batch|processed=${bat.json.processed}|matched=${bat.json.matched}|skipped=${bat.json.skipped}|wallMs=${bat.wallMs}|timing=${JSON.stringify(bat.json.timing)}`,
  );

  if (!Array.isArray(seq.json.results) || !Array.isArray(bat.json.results)) {
    console.error("verify-batch-rematch|FAIL|missing results[] — is server on new build?");
    process.exit(2);
  }

  if (seq.json.processed !== bat.json.processed) {
    console.error(
      `verify-batch-rematch|FAIL|processed mismatch seq=${seq.json.processed} bat=${bat.json.processed}`,
    );
    process.exit(2);
  }

  const diffs = compare(
    fingerprint(seq.json.results),
    fingerprint(bat.json.results),
  );

  const speedup =
    seq.wallMs > 0 ? (seq.wallMs / Math.max(bat.wallMs, 1)).toFixed(2) : "?";

  console.log(
    `verify-batch-rematch|timing|seqWallMs=${seq.wallMs}|batWallMs=${bat.wallMs}|speedup=${speedup}x|seqResolveMs=${seq.json.timing?.resolveMs}|batResolveMs=${bat.json.timing?.resolveMs}`,
  );

  if (diffs.length) {
    console.error(`verify-batch-rematch|FAIL|identity diffs=${diffs.length}`);
    for (const d of diffs.slice(0, 30)) {
      console.error(
        `  place=${d.placeId}|seq=${d.sequential}|bat=${d.batch}`,
      );
    }
    process.exit(1);
  }

  console.log(
    `verify-batch-rematch|PASS|identical matched/skipped fingerprints|n=${seq.json.results.length}|matched=${seq.json.matched}`,
  );
}

main().catch((e) => {
  console.error("verify-batch-rematch|ERROR", e);
  process.exit(1);
});
