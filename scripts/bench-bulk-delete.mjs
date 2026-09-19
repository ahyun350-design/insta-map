/**
 * Bench bulk-delete chunking (no network).
 * Real API timings: client logs `[places/bulk-delete] elapsedMs=…`
 *
 *   node scripts/bench-bulk-delete.mjs
 */
const MAX = 500;

function chunk(ids, size = MAX) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

function estimateSequentialMs(n, perChunkMs) {
  return Math.ceil(n / MAX) * perChunkMs;
}

for (const n of [100, 500, 1200]) {
  const ids = Array.from({ length: n }, (_, i) => `id-${i}`);
  const t0 = performance.now();
  const chunks = chunk(ids);
  const prepMs = performance.now() - t0;
  console.log(
    `n=${n} chunks=${chunks.length} prepMs=${prepMs.toFixed(3)} ` +
      `est@80ms/chunk=${estimateSequentialMs(n, 80)}ms ` +
      `est@200ms/chunk=${estimateSequentialMs(n, 200)}ms`,
  );
}
