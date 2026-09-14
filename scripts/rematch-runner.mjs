#!/usr/bin/env node
/**
 * Rematch batch runner (GitHub Actions + local).
 *
 * Env:
 *   APP_URL         — e.g. https://pindmap.com (no trailing slash)
 *   REMATCH_SECRET  — Bearer token
 *   BATCH_SIZE      — optional, default 150
 *
 * Args:
 *   --maxBatches N  — default 130
 *   --dryRun        — pass dryRun:true (no DB writes)
 *
 * Exit 0 on success / done; non-zero on auth or exhausted retries.
 */
import process from "node:process";

const DEFAULT_MAX_BATCHES = 130;
const DEFAULT_BATCH_SIZE = 150;
const MAX_ATTEMPTS = 3;
const RETRY_WAIT_MS = 30_000;

function parseArgs(argv) {
  let maxBatches = DEFAULT_MAX_BATCHES;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dryRun" || a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--maxBatches" || a === "--max-batches") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`invalid --maxBatches value: ${argv[i]}`);
      }
      maxBatches = Math.floor(n);
      continue;
    }
    if (a.startsWith("--maxBatches=")) {
      const n = Number(a.slice("--maxBatches=".length));
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`invalid --maxBatches value: ${a}`);
      }
      maxBatches = Math.floor(n);
      continue;
    }
    // positional maxBatches for convenience: node rematch-runner.mjs 2
    if (/^\d+$/.test(a)) {
      maxBatches = Number(a);
      continue;
    }
    throw new Error(`unknown arg: ${a}`);
  }
  return { maxBatches, dryRun };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @returns {Promise<{ ok: true, status: number, body: object } | { ok: false, status: number, error: string, retryable: boolean }>}
 */
async function postRematch(url, secret, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: `network: ${msg}`, retryable: true };
  }

  const status = res.status;
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (status === 200 && json && typeof json === "object") {
    return { ok: true, status, body: json };
  }

  const retryable = status === 0 || status >= 500;
  const errText =
    json && typeof json === "object" && "error" in json
      ? String(json.error)
      : res.statusText || `HTTP ${status}`;
  return { ok: false, status, error: errText, retryable };
}

async function main() {
  const { maxBatches, dryRun } = parseArgs(process.argv.slice(2));

  const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  const secret = (process.env.REMATCH_SECRET || "").trim();
  const batchSize = Math.min(
    500,
    Math.max(1, Number(process.env.BATCH_SIZE || DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE),
  );

  if (!appUrl) {
    console.error("APP_URL is missing");
    process.exit(1);
  }
  if (!secret) {
    console.error("REMATCH_SECRET is missing");
    process.exit(1);
  }

  const endpoint = `${appUrl}/api/admin/rematch`;
  console.log(
    `=== rematch-runner start: url=${endpoint} batchSize=${batchSize} maxBatches=${maxBatches} dryRun=${dryRun} ===`,
  );

  let cursor = null;
  let totalProcessed = 0;
  let totalMatched = 0;

  for (let n = 1; n <= maxBatches; n++) {
    const body = { batchSize, dryRun };
    if (cursor) body.cursor = cursor;

    let result = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      result = await postRematch(endpoint, secret, body);

      if (result.ok) break;

      // Non-retryable (4xx etc.) — fail immediately
      if (!result.retryable) {
        console.error(
          `batch ${n} failed: status=${result.status} error=${result.error} (non-retryable)`,
        );
        process.exit(1);
      }

      if (attempt < MAX_ATTEMPTS) {
        console.error(
          `batch ${n} attempt ${attempt}/${MAX_ATTEMPTS} status=${result.status} — wait ${RETRY_WAIT_MS / 1000}s`,
        );
        await sleep(RETRY_WAIT_MS);
        continue;
      }

      console.error(
        `batch ${n} failed after ${MAX_ATTEMPTS} attempts: status=${result.status} error=${result.error}`,
      );
      process.exit(1);
    }

    const data = result.body;
    const processed = Number(data.processed ?? 0) || 0;
    const matched = Number(data.matched ?? 0) || 0;
    const done = data.done === true;
    const nextCursor =
      typeof data.nextCursor === "string" && data.nextCursor.trim()
        ? data.nextCursor.trim()
        : null;

    totalProcessed += processed;
    totalMatched += matched;

    console.log(
      `batch ${n} | processed=${processed} | matched=${matched} | done=${done}`,
    );

    if (done || !nextCursor) {
      console.log(
        `finished: total_processed=${totalProcessed} total_matched=${totalMatched}`,
      );
      process.exit(0);
    }

    cursor = nextCursor;
  }

  console.log(
    `stopped after ${maxBatches} batches: total_processed=${totalProcessed} total_matched=${totalMatched}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
