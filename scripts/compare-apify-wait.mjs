/**
 * Live compare: legacy 5s sleep-poll vs waitForFinish chunks.
 * One public Instagram URL, 3 paired runs. No DB writes.
 *
 * Usage: node scripts/compare-apify-wait.mjs [instagramUrl]
 * URL may also come from TEST_INSTAGRAM_URL or first reel_cache row (via env supabase — optional).
 *
 * Report prints timings only — not the URL/caption.
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    /* missing */
  }
}
loadEnv(".env.local");
loadEnv(".env");

const token = process.env.APIFY_API_TOKEN?.trim();
const actorId =
  process.env.APIFY_ACTOR_ID?.trim() || "apify~instagram-post-scraper";
if (!token) {
  console.error("missing APIFY_API_TOKEN");
  process.exit(1);
}

async function resolveUrl() {
  const arg = process.argv[2]?.trim();
  if (arg) return arg;
  if (process.env.TEST_INSTAGRAM_URL?.trim()) {
    return process.env.TEST_INSTAGRAM_URL.trim();
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) {
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await admin
      .from("reel_cache")
      .select("instagram_url")
      .eq("status", "ok")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.instagram_url) return data.instagram_url;
  }
  console.error("need instagram URL arg, TEST_INSTAGRAM_URL, or reel_cache row");
  process.exit(1);
}

async function startRun(instagramUrl) {
  const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${encodeURIComponent(token)}`;
  const runRes = await fetch(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: [instagramUrl],
      resultsType: "posts",
      resultsLimit: 1,
    }),
  });
  if (!runRes.ok) {
    throw new Error(`start failed HTTP ${runRes.status}`);
  }
  const runData = await runRes.json();
  const runId = runData?.data?.id;
  const datasetId = runData?.data?.defaultDatasetId;
  if (!runId) throw new Error("no runId");
  return { runId, datasetId };
}

async function fetchCaption(datasetId) {
  const itemsRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(token)}`,
  );
  const items = await itemsRes.json();
  const post = items?.[0] ?? {};
  const caption = String(post.caption ?? post.text ?? post.description ?? "").trim();
  return {
    captionLen: caption.length,
    hasCaption: caption.length > 0,
    keys: Object.keys(post)
      .filter((k) => ["caption", "text", "description", "id", "type", "url", "shortCode"].includes(k))
      .sort(),
  };
}

/** Legacy: sleep 5s × up to 12, then GET status */
async function waitLegacy(runId, initialDatasetId) {
  let datasetId = initialDatasetId;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
    );
    const statusData = await statusRes.json();
    const status = statusData.data?.status;
    datasetId = statusData.data?.defaultDatasetId ?? datasetId;
    if (status === "SUCCEEDED") return { status, datasetId };
    if (status === "FAILED" || status === "ABORTED") {
      throw new Error("Apify 작업 실패");
    }
  }
  return { status: "UNKNOWN", datasetId };
}

/** New: waitForFinish chunks of 25s, total 60s */
async function waitNew(runId, initialDatasetId) {
  const totalMs = 60_000;
  const chunkSec = 25;
  const deadline = Date.now() + totalMs;
  let datasetId = initialDatasetId;
  let lastStatus = "RUNNING";
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const waitSec = Math.max(1, Math.min(chunkSec, 60, Math.ceil(remainingMs / 1000)));
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}&waitForFinish=${waitSec}`,
    );
    if (!statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
    const statusData = await statusRes.json();
    const status = String(statusData.data?.status ?? "");
    lastStatus = status || lastStatus;
    datasetId = statusData.data?.defaultDatasetId ?? datasetId;
    if (status === "SUCCEEDED") return { status, datasetId };
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error("Apify 작업 실패");
    }
  }
  return { status: lastStatus, datasetId };
}

async function timedWait(label, waitFn, runId, datasetId) {
  const t0 = Date.now();
  const waited = await waitFn(runId, datasetId);
  const waitSec = (Date.now() - t0) / 1000;
  if (!waited.datasetId) throw new Error(`${label}: no datasetId`);
  const shape = await fetchCaption(waited.datasetId);
  return {
    label,
    wait_s: +waitSec.toFixed(2),
    status: waited.status,
    captionLen: shape.captionLen,
    hasCaption: shape.hasCaption,
    keys: shape.keys,
  };
}

const instagramUrl = await resolveUrl();
const results = [];

for (let i = 1; i <= 3; i++) {
  // Legacy path
  const a = await startRun(instagramUrl);
  const legacy = await timedWait("legacy_5s_poll", waitLegacy, a.runId, a.datasetId);
  // New path (separate run — necessary to compare wait styles fairly)
  const b = await startRun(instagramUrl);
  const neu = await timedWait("waitForFinish_25s", waitNew, b.runId, b.datasetId);
  results.push({
    trial: i,
    legacy_wait_s: legacy.wait_s,
    new_wait_s: neu.wait_s,
    delta_s: +(legacy.wait_s - neu.wait_s).toFixed(2),
    shape_match:
      legacy.hasCaption === neu.hasCaption &&
      JSON.stringify(legacy.keys) === JSON.stringify(neu.keys),
    legacy_keys: legacy.keys,
    new_keys: neu.keys,
  });
}

const avgLegacy =
  results.reduce((s, r) => s + r.legacy_wait_s, 0) / results.length;
const avgNew = results.reduce((s, r) => s + r.new_wait_s, 0) / results.length;

console.log(
  JSON.stringify(
    {
      trials: results,
      avg_legacy_wait_s: +avgLegacy.toFixed(2),
      avg_new_wait_s: +avgNew.toFixed(2),
      avg_saved_s: +(avgLegacy - avgNew).toFixed(2),
      note: "Each trial starts 2 Apify runs (legacy vs new wait). Production uses 1 run.",
    },
    null,
    2,
  ),
);
